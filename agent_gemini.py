# -*- coding: utf-8 -*-
"""
Agent Briefing Ekonomi Harian — VERSI GEMINI API (Google AI Studio)
Kanwil DJPb Provinsi Kepulauan Bangka Belitung

Fungsinya identik dengan agent.py (versi Claude), hanya penyedia model dan
tool pencarian yang diganti: Claude web_search -> Gemini google_search
grounding. Susunan pesan dan logika kirim ke Telegram tidak berubah.

CARA PAKAI
    1. Salin .env.example menjadi .env, isi GEMINI_API_KEY (dari
       aistudio.google.com/apikey) plus dua nilai Telegram seperti biasa.
    2. pip install -r requirements-gemini.txt
    3. python agent_gemini.py

ENV VAR YANG DIBUTUHKAN
    GEMINI_API_KEY      - dari Google AI Studio (aistudio.google.com/apikey)
    TELEGRAM_BOT_TOKEN  - dari @BotFather di Telegram
    TELEGRAM_CHAT_ID    - id chat/grup tujuan

CATATAN MODEL & BIAYA
    gemini-3.6-flash dipakai (bukan 3.7-flash, yang sempat mengembalikan
    error 503 "high demand" secara terus-menerus pada percobaan
    sebelumnya - kemungkinan karena baru dirilis dan kapasitas server
    Google belum mengejar permintaan). 3.6-flash adalah generasi tepat
    di bawahnya, sudah lebih matang dari sisi ketersediaan, dan tetap
    lebih taat instruksi format dibanding tier flash-lite. Jika Google
    merilis tier lebih baru/stabil, cek ai.google.dev/gemini-api/docs/pricing
    dan ganti nilai MODEL. Semua tier "flash" mendukung Google Search
    grounding; varian *-lite generasi lama kadang tidak.
"""
import os
import sys
import time
import datetime

import requests
from google import genai
from google.genai import types, errors

from categories_gemini import CATEGORIES
from netra import assign_tones
from sheet import write_sheet
from thumbnails import fetch_og_image, photos_from_items, send_photos, source_host

# Nama bulan Indonesia dipetakan manual (bukan strftime locale-dependent)
# agar hasilnya konsisten di sistem operasi apa pun, terlepas locale
# terpasang atau tidak.
BULAN_INDONESIA = {
    1: "Januari", 2: "Februari", 3: "Maret", 4: "April",
    5: "Mei", 6: "Juni", 7: "Juli", 8: "Agustus",
    9: "September", 10: "Oktober", 11: "November", 12: "Desember",
}

# Model bisa diganti sesuai preferensi biaya/kualitas - cek daftar dan
# harga terbaru di ai.google.dev/gemini-api/docs/pricing.
MODEL = "gemini-3.6-flash"

# CATATAN PENTING soal max_output_tokens dan "thinking":
# Model Gemini 3.x menghabiskan sebagian dari max_output_tokens untuk
# proses penalaran internal (thinking) SEBELUM menulis jawaban yang
# terlihat - token thinking ini tidak tampil di teks jawaban, tapi tetap
# memotong dari jatah yang sama. Jika jatahnya terlalu pas, jawaban bisa
# terpotong di tengah kalimat (persis gejala yang terjadi sebelumnya).
# Jatah di bawah dinaikkan cukup besar sebagai pengaman, DI LUAR
# pengurangan thinking_level ke LOW pada konfigurasi permintaan.
MAX_OUTPUT_TOKENS_PER_KATEGORI = 2400
TELEGRAM_CHUNK_SIZE = 3800

# Kode status yang layak di-retry: 429 (rate limit), 500/502/503/504
# (masalah sementara di sisi server Google, termasuk "high demand" pada
# model yang baru dirilis). Kode 4xx lain (401/403/404) TIDAK di-retry
# karena itu masalah konfigurasi (API key/model salah), bukan sesaat.
RETRYABLE_STATUS = {429, 500, 502, 503, 504}
MAX_RETRIES = 3
RETRY_BASE_DELAY_SECONDS = 8  # 8s, lalu 16s, lalu 32s (exponential backoff)


# Cache link pendek supaya URL yang sama tidak dipendekkan berulang kali
# dalam satu kali jalan (7 kategori bisa saja memakai sumber yang sama).
_URL_SHORTEN_CACHE = {}


def shorten_url(url: str) -> str:
    """Pendekkan URL pakai TinyURL (tanpa API key, GET sederhana).

    Jika layanan shortener gagal/timeout, kembalikan URL asli apa adanya
    (fallback aman) - lebih baik link panjang yang tetap berfungsi
    daripada skrip berhenti karena satu layanan eksternal down.
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
        pass  # biarkan short = url (fallback)
    _URL_SHORTEN_CACHE[url] = short
    return short


def annotate_with_inline_sources(response, max_links_per_line: int = 2, items: list = None) -> str:
    """Sisipkan link pendek tepat di akhir baris berita yang didukungnya.

    Berbeda dari pendekatan sebelumnya (kumpulkan semua sumber lalu
    taruh di bawah kategori), fungsi ini memakai grounding_supports dari
    API - yang memetakan setiap SEGMEN TEKS ke indeks grounding_chunks
    (sumber) yang mendukungnya. Pemetaan dilakukan dengan mencocokkan
    `segment.text` (potongan teks asli dari API) sebagai substring pada
    tiap baris hasil - ini menghindari risiko meleset dibanding
    menghitung index karakter/byte secara manual.

    Baris yang tidak punya segmen yang cocok (misalnya baris "Belum ada
    perkembangan terbaru.") dibiarkan tanpa link - itu memang seharusnya
    tidak punya sumber.
    """
    text = (response.text or "").strip()
    if not text:
        return text

    candidates = getattr(response, "candidates", None) or []
    if not candidates:
        return text
    gm = getattr(candidates[0], "grounding_metadata", None)
    chunks = getattr(gm, "grounding_chunks", None) if gm else None
    supports = getattr(gm, "grounding_supports", None) if gm else None
    if not chunks or not supports:
        return text  # tidak ada data grounding - kembalikan teks apa adanya

    chunk_uris = []
    for chunk in chunks:
        web = getattr(chunk, "web", None)
        chunk_uris.append(getattr(web, "uri", None) if web else None)

    lines = text.split("\n")
    line_uris = [[] for _ in lines]  # list (bukan set) - urutan kemunculan dipertahankan
    line_uris_seen = [set() for _ in lines]

    for support in supports:
        seg = getattr(support, "segment", None)
        seg_text = (getattr(seg, "text", None) or "").strip() if seg else ""
        if not seg_text:
            continue
        indices = getattr(support, "grounding_chunk_indices", None) or []
        uris = [chunk_uris[i] for i in indices if 0 <= i < len(chunk_uris) and chunk_uris[i]]
        if not uris:
            continue
        for i, line in enumerate(lines):
            if seg_text in line:
                for uri in uris:
                    if uri not in line_uris_seen[i]:
                        line_uris_seen[i].add(uri)
                        line_uris[i].append(uri)

    new_lines = []
    for i, line in enumerate(lines):
        uris = line_uris[i][:max_links_per_line]
        if uris:
            shorts = " ".join(shorten_url(u) for u in uris)
            if items is not None:  # redirect grounding diikuti sampai halaman asli oleh fetch_og_image
                items.append({"teks": line, "link": shorten_url(uris[0]), "gambar": fetch_og_image(uris[0]), "sumber": source_host(uris[0])})
            line = f"{line} {shorts}"
        new_lines.append(line)
    return "\n".join(new_lines)


def run_category(client: genai.Client, cat: dict, tanggal: str, bulan_tahun: str, items: list = None) -> str:
    """Panggil Gemini API dengan Google Search grounding untuk satu kategori.

    Otomatis mencoba ulang (retry) hingga MAX_RETRIES kali dengan jeda
    yang membesar (exponential backoff) jika Google mengembalikan error
    yang bersifat sementara (429/5xx) - misalnya error 503 "high demand"
    yang umum terjadi pada model yang baru dirilis.

    thinking_level diset ke LOW: tugas kategori-kategori ini adalah
    meringkas hasil pencarian secara terstruktur, bukan penalaran rumit -
    thinking rendah cukup, dan menyisakan lebih banyak jatah token untuk
    jawaban yang benar-benar terlihat (mencegah jawaban terpotong).
    """
    user_prompt = cat["user_prompt"].format(tanggal=tanggal, bulan_tahun=bulan_tahun)
    system_prompt = cat["system_prompt"].format(bulan_tahun=bulan_tahun)
    max_tokens = cat.get("max_output_tokens", MAX_OUTPUT_TOKENS_PER_KATEGORI)

    last_error = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            response = client.models.generate_content(
                model=MODEL,
                contents=user_prompt,
                config=types.GenerateContentConfig(
                    system_instruction=system_prompt,
                    max_output_tokens=max_tokens,
                    thinking_config=types.ThinkingConfig(
                        thinking_level=types.ThinkingLevel.LOW,
                    ),
                    tools=[types.Tool(google_search=types.GoogleSearch())],
                ),
            )
            hasil = (response.text or "").strip()
            if not hasil:
                return "_Tidak ada hasil pencarian yang dapat dirangkum._"
            return annotate_with_inline_sources(response, items=items)

        except errors.APIError as exc:
            last_error = exc
            status_code = getattr(exc, "code", None)
            if status_code not in RETRYABLE_STATUS or attempt == MAX_RETRIES:
                raise  # bukan error sementara, atau percobaan sudah habis - lempar ke pemanggil
            delay = RETRY_BASE_DELAY_SECONDS * (2 ** (attempt - 1))
            print(
                f"  -> Percobaan {attempt}/{MAX_RETRIES} gagal (kode {status_code}: "
                f"{exc.status}). Menunggu {delay}s sebelum mencoba lagi...",
                file=sys.stderr,
            )
            time.sleep(delay)

    # Baris ini seharusnya tidak pernah tercapai (loop di atas selalu return atau raise),
    # tapi disertakan untuk kelengkapan/keamanan tipe.
    raise last_error


def ask_model(client: genai.Client, prompt: str) -> str:
    """Satu panggilan tanpa tool, dipakai untuk menilai tone semua berita sekaligus."""
    response = client.models.generate_content(
        model=MODEL,
        contents=prompt,
        config=types.GenerateContentConfig(
            max_output_tokens=MAX_OUTPUT_TOKENS_PER_KATEGORI,
            thinking_config=types.ThinkingConfig(thinking_level=types.ThinkingLevel.LOW),
        ),
    )
    return response.text or ""


def build_message(results: dict, tanggal_tampil: str) -> str:
    lines = [f"*Briefing Ekonomi — {tanggal_tampil}*", ""]
    for key, cat in CATEGORIES.items():
        if key not in results:  # kategori yang tidak dipilih saat tarik manual
            continue
        lines.append(f"{cat['emoji']} *{cat['title']}*")
        lines.append(results.get(key, "_Data tidak tersedia._"))
        lines.append("")
    lines.append(
        "_Ringkasan otomatis dibantu Google Search grounding (Gemini API). "
        "Perlu verifikasi manusia sebelum dikutip dalam produk resmi "
        "(KFR/ALCo/policy brief)._"
    )
    return "\n".join(lines)


def chunk_text(text: str, size: int) -> list:
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
        print(f"Env var '{name}' belum diset. Lihat README.md bagian Gemini.", file=sys.stderr)
        sys.exit(1)
    return value


def main() -> None:
    gemini_key = load_env_or_exit("GEMINI_API_KEY")
    tg_token = load_env_or_exit("TELEGRAM_BOT_TOKEN")
    tg_chat_id = load_env_or_exit("TELEGRAM_CHAT_ID")

    client = genai.Client(api_key=gemini_key)

    hari_ini = datetime.date.today()
    nama_bulan = BULAN_INDONESIA[hari_ini.month]
    tanggal_query = f"{hari_ini.day} {nama_bulan} {hari_ini.year}"
    bulan_tahun = f"{nama_bulan} {hari_ini.year}"
    tanggal_tampil = tanggal_query  # dipakai sebagai judul pesan Telegram

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
        except Exception as exc:  # noqa: BLE001
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
