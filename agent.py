# -*- coding: utf-8 -*-
"""
Agent Briefing Ekonomi Harian — Kanwil DJPb Provinsi Kepulauan Bangka Belitung

Memanggil Claude API (dengan web search) untuk lima kategori, merangkai
hasilnya jadi satu pesan terstruktur, lalu mengirim ke Telegram.

CARA PAKAI
    1. Salin .env.example menjadi .env dan isi tiga nilai di dalamnya.
    2. pip install -r requirements.txt
    3. python agent.py            # uji manual, kirim sekali
    4. Jadwalkan lewat cron / GitHub Actions (lihat README.md)

ENV VAR YANG DIBUTUHKAN
    ANTHROPIC_API_KEY   - dari console.anthropic.com
    TELEGRAM_BOT_TOKEN  - dari @BotFather di Telegram
    TELEGRAM_CHAT_ID    - id chat/grup tujuan (lihat README.md)
"""
import os
import sys
import datetime

import requests
import anthropic

from categories import CATEGORIES
from netra import assign_tones
from sheet import write_sheet
from thumbnails import fetch_og_image, photos_from_items, send_photos, source_host

# Nama bulan Indonesia dipetakan manual (bukan strftime locale-dependent)
# agar hasilnya konsisten di sistem operasi apa pun.
BULAN_INDONESIA = {
    1: "Januari", 2: "Februari", 3: "Maret", 4: "April",
    5: "Mei", 6: "Juni", 7: "Juli", 8: "Agustus",
    9: "September", 10: "Oktober", 11: "November", 12: "Desember",
}

MODEL = "claude-sonnet-5"
MAX_TOKENS_PER_KATEGORI = 700
TELEGRAM_CHUNK_SIZE = 3800  # di bawah batas 4096 karakter Telegram, beri margin


# Cache link pendek supaya URL yang sama tidak dipendekkan berulang kali
# dalam satu kali jalan.
_URL_SHORTEN_CACHE = {}


def shorten_url(url: str) -> str:
    """Pendekkan URL pakai TinyURL (tanpa API key, GET sederhana).

    Fallback ke URL asli jika layanan shortener gagal/timeout.
    """
    if url in _URL_SHORTEN_CACHE:
        return _URL_SHORTEN_CACHE[url]
    short = url
    try:
        resp = requests.get(
            "https://tinyurl.com/api-create.php",
            params={"url": url},
            timeout=10,
        )
        if resp.ok and resp.text.strip().startswith("http"):
            short = resp.text.strip()
    except requests.RequestException:
        pass
    _URL_SHORTEN_CACHE[url] = short
    return short


def annotate_with_inline_sources(response, max_links_per_line: int = 2, items: list = None) -> str:
    """Sisipkan link pendek tepat di akhir baris berita yang didukungnya.

    Setara dengan versi Gemini (lihat agent_gemini.py), tapi memakai
    struktur citations Claude: setiap citation punya `cited_text` (teks
    asli yang dikutip) dan `url`. Dicocokkan sebagai substring ke tiap
    baris hasil - baris tanpa citation yang cocok dibiarkan tanpa link.
    """
    text_parts = [block.text for block in response.content if getattr(block, "type", None) == "text"]
    hasil = "\n".join(part.strip() for part in text_parts if part.strip())
    if not hasil:
        return hasil

    citation_pairs = []  # (cited_text, url)
    for block in response.content:
        if getattr(block, "type", None) != "text":
            continue
        for citation in getattr(block, "citations", None) or []:
            cited_text = (getattr(citation, "cited_text", None) or "").strip()
            url = getattr(citation, "url", None)
            if cited_text and url:
                citation_pairs.append((cited_text, url))

    if not citation_pairs:
        return hasil

    lines = hasil.split("\n")
    line_urls = [[] for _ in lines]
    line_urls_seen = [set() for _ in lines]
    for cited_text, url in citation_pairs:
        for i, line in enumerate(lines):
            if cited_text in line and url not in line_urls_seen[i]:
                line_urls_seen[i].add(url)
                line_urls[i].append(url)

    new_lines = []
    for i, line in enumerate(lines):
        urls = line_urls[i][:max_links_per_line]
        if urls:
            shorts = " ".join(shorten_url(u) for u in urls)
            if items is not None:
                items.append({"teks": line, "link": shorten_url(urls[0]), "gambar": fetch_og_image(urls[0]), "sumber": source_host(urls[0])})
            line = f"{line} {shorts}"
        new_lines.append(line)
    return "\n".join(new_lines)


def run_category(client: anthropic.Anthropic, cat: dict, tanggal: str, bulan_tahun: str, items: list = None) -> str:
    """Panggil Claude API dengan web search untuk satu kategori."""
    user_prompt = cat["user_prompt"].format(tanggal=tanggal, bulan_tahun=bulan_tahun)
    system_prompt = cat["system_prompt"].format(bulan_tahun=bulan_tahun)
    max_tokens = cat.get("max_tokens", MAX_TOKENS_PER_KATEGORI)
    response = client.messages.create(
        model=MODEL,
        max_tokens=max_tokens,
        system=system_prompt,
        messages=[{"role": "user", "content": user_prompt}],
        tools=[{"type": "web_search_20250305", "name": "web_search", "max_uses": 4}],
    )
    hasil = annotate_with_inline_sources(response, items=items)
    return hasil or "_Tidak ada hasil pencarian yang dapat dirangkum._"


def ask_model(client: anthropic.Anthropic, prompt: str) -> str:
    """Satu panggilan tanpa tool, dipakai untuk menilai tone semua berita sekaligus."""
    resp = client.messages.create(model=MODEL, max_tokens=1000, messages=[{"role": "user", "content": prompt}])
    return resp.content[0].text


def build_message(results: dict, tanggal_tampil: str) -> str:
    """Susun seluruh hasil kategori menjadi satu pesan Telegram (Markdown)."""
    lines = [f"*Briefing Ekonomi — {tanggal_tampil}*", ""]
    for key, cat in CATEGORIES.items():
        if key not in results:  # kategori yang tidak dipilih saat tarik manual
            continue
        lines.append(f"{cat['emoji']} *{cat['title']}*")
        lines.append(results.get(key, "_Data tidak tersedia._"))
        lines.append("")
    lines.append(
        "_Ringkasan otomatis hasil pencarian web. Perlu verifikasi manusia "
        "sebelum dikutip dalam produk resmi (KFR/ALCo/policy brief)._"
    )
    return "\n".join(lines)


def chunk_text(text: str, size: int) -> list:
    """Pecah teks panjang menjadi beberapa pesan agar tidak melewati batas Telegram."""
    return [text[i:i + size] for i in range(0, len(text), size)] or [text]


def send_telegram(token: str, chat_id: str, text: str) -> None:
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    for chunk in chunk_text(text, TELEGRAM_CHUNK_SIZE):
        resp = requests.post(
            url,
            data={
                "chat_id": chat_id,
                "text": chunk,
                "parse_mode": "Markdown",
                "disable_web_page_preview": True,
            },
            timeout=30,
        )
        if not resp.ok:
            print(f"Gagal kirim ke Telegram: {resp.status_code} {resp.text}", file=sys.stderr)
            resp.raise_for_status()


def load_env_or_exit(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        print(f"Env var '{name}' belum diset. Lihat README.md untuk cara mengisinya.",
              file=sys.stderr)
        sys.exit(1)
    return value


def main() -> None:
    anthropic_key = load_env_or_exit("ANTHROPIC_API_KEY")
    tg_token = load_env_or_exit("TELEGRAM_BOT_TOKEN")
    tg_chat_id = load_env_or_exit("TELEGRAM_CHAT_ID")

    client = anthropic.Anthropic(api_key=anthropic_key)

    hari_ini = datetime.date.today()
    nama_bulan = BULAN_INDONESIA[hari_ini.month]
    tanggal_query = f"{hari_ini.day} {nama_bulan} {hari_ini.year}"
    bulan_tahun = f"{nama_bulan} {hari_ini.year}"
    tanggal_tampil = tanggal_query

    print(f"Menjalankan briefing untuk bulan berjalan: {bulan_tahun}")

    results = {}
    only = {k.strip() for k in os.environ.get("KATEGORI", "").split(",") if k.strip()}  # kosong = semua kategori
    cats = {k: v for k, v in CATEGORIES.items() if not only or k in only}
    if not cats:
        print(f"Tidak ada kategori yang cocok dengan KATEGORI={sorted(only)}", file=sys.stderr)
        sys.exit(1)
    items = {key: [] for key in cats}  # per kategori: berita bertautan {teks, link, gambar}
    for key, cat in cats.items():
        print(f"[{key}] Memproses kategori: {cat['title']} ...")
        try:
            results[key] = run_category(client, cat, tanggal_query, bulan_tahun, items[key])
        except Exception as exc:  # noqa: BLE001 - agent harus tetap jalan walau 1 kategori gagal
            print(f"[{key}] Error: {exc}", file=sys.stderr)
            results[key] = "_Gagal memuat kategori ini - lihat log agent untuk detail._"

    assign_tones(items, lambda prompt: ask_model(client, prompt))
    message = build_message(results, tanggal_tampil)
    if os.environ.get("KIRIM_TELEGRAM", "true").lower() != "false":
        send_telegram(tg_token, tg_chat_id, message)
        send_photos(tg_token, tg_chat_id, photos_from_items(items, CATEGORIES))
    write_sheet(items, CATEGORIES, hari_ini)
    print("Briefing selesai.")


if __name__ == "__main__":
    main()
