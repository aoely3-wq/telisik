# -*- coding: utf-8 -*-
"""Thumbnail berita untuk briefing: ambil og:image dari halaman sumber, kirim sebagai foto Telegram.

Dipakai bersama oleh agent.py (Claude) dan agent_gemini.py (Gemini).
Link grounding Gemini berupa redirect vertexaisearch; requests mengikuti redirect itu
sampai halaman berita asli, jadi og:image dibaca dari halaman asli.
"""
import html
import re
import sys
from urllib.parse import urljoin, urlparse

import requests

# shortcut: hanya membaca 300 KB pertama dan tidak menjalankan JavaScript;
# situs yang og:image-nya dirender JS atau memblokir bot akan tanpa thumbnail (aman, bukan error).
MAX_BYTES = 300_000
_META = re.compile(r'<meta\b[^>]*\b(?:property|name)=["\'](?:og:image(?::secure_url)?|twitter:image)["\'][^>]*>', re.I)
_CONTENT = re.compile(r'\bcontent=["\']([^"\']+)["\']', re.I)
_cache = {}
_host = {}  # url asal -> domain halaman akhir setelah redirect, diisi fetch_og_image


def parse_og_image(page: str, base_url: str):
    """Kembalikan URL gambar absolut (http/https) dari tag og:image/twitter:image, atau None."""
    for tag in _META.findall(page):
        m = _CONTENT.search(tag)
        if m:
            img = urljoin(base_url, html.unescape(m.group(1).strip()))
            if img.startswith(("http://", "https://")):
                return img
    return None


def fetch_og_image(url: str):
    """Ambil URL thumbnail dari halaman berita. Gagal apa pun -> None (briefing tetap jalan)."""
    if url in _cache:
        return _cache[url]
    img = None
    try:
        with requests.get(
            url, timeout=8, stream=True,
            headers={"User-Agent": "Mozilla/5.0 (compatible; telisik-bot)"},
        ) as r:
            _host[url] = (urlparse(r.url).hostname or "").removeprefix("www.")
            if r.ok and "html" in r.headers.get("content-type", ""):
                page = r.raw.read(MAX_BYTES, decode_content=True).decode(r.encoding or "utf-8", "ignore")
                img = parse_og_image(page, r.url)
    except requests.RequestException:
        pass
    _cache[url] = img
    return img


def source_host(url: str) -> str:
    """Domain sumber asli (setelah redirect) untuk url yang sudah diproses fetch_og_image, atau ''."""
    return _host.get(url, "")


def send_photos(token: str, chat_id: str, items: list) -> None:
    """Kirim tiap (caption, image_url) sebagai foto. Satu foto gagal -> dilewati, bukan menghentikan agent."""
    for caption, img in items:
        try:
            resp = requests.post(
                f"https://api.telegram.org/bot{token}/sendPhoto",
                data={"chat_id": chat_id, "photo": img, "caption": caption.replace("*", "")[:1000]},
                timeout=30,
            )
            if not resp.ok:
                print(f"Thumbnail dilewati ({resp.status_code}): {img}", file=sys.stderr)
        except requests.RequestException as exc:
            print(f"Thumbnail dilewati ({exc}): {img}", file=sys.stderr)


def photos_from_items(items: dict, categories: dict) -> list:
    """Satu foto per kategori: berita pertama yang punya gambar -> [(caption, image_url)]."""
    out = []
    for key, rows in items.items():
        first = next((i for i in rows if i["gambar"]), None)
        if first:
            out.append((f"{categories[key]['title']}\n{first['teks']}", first["gambar"]))
    return out


if __name__ == "__main__":
    base = "https://contoh.example/a/b"
    cases = [
        ('<meta property="og:image" content="https://cdn.example/x.jpg">', "https://cdn.example/x.jpg"),
        ('<meta content="/img/y.jpg?a=1&amp;b=2" property="og:image">', "https://contoh.example/img/y.jpg?a=1&b=2"),
        ('<meta name="twitter:image" content="//cdn.example/z.png">', "https://cdn.example/z.png"),
        ('<meta property="og:image" content="javascript:alert(1)">', None),
        ('<meta property="og:title" content="tanpa gambar">', None),
    ]
    for page, want in cases:
        got = parse_og_image(page, base)
        assert got == want, (page, got, want)
    print("OK: parse_og_image lolos", len(cases), "kasus")
