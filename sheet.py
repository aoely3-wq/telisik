# -*- coding: utf-8 -*-
"""Tulis hasil briefing ke Google Sheet (database untuk web UI telisik).

Satu baris per berita bertautan. Dilewati dengan pesan jika GOOGLE_SERVICE_ACCOUNT_JSON atau
SHEET_ID belum diset, jadi alur Telegram tetap jalan tanpa Sheet.

Siapkan sekali: buat service account di Google Cloud, aktifkan Google Sheets API, bagikan Sheet
ke email service account (peran Editor), simpan isi JSON-nya di secret GOOGLE_SERVICE_ACCOUNT_JSON.
"""
import json
import os
import sys

HEADER = ["tanggal", "kategori_key", "kategori", "teks", "link", "gambar", "verifikasi",
          "tone", "netra_kategori", "netra_hashtag", "netra_kata", "status_netra", "sumber"]


def build_rows(items: dict, categories: dict, tanggal) -> list:
    """items: {key: [{"teks", "link", "gambar"}]} -> baris Sheet (tanpa header)."""
    def row(key, i):
        n = i.get("netra") or {}  # kosong jika tone bukan positif atau tidak lolos query NETRA
        return [tanggal.isoformat(), key, categories[key]["title"], i["teks"], i["link"], i["gambar"] or "", "",
                i.get("tone", ""), n.get("no", ""), n.get("tag", ""), ", ".join(n.get("kata", [])), "", i.get("sumber", "")]
    return [row(key, i) for key, rows in items.items() for i in rows]


def write_sheet(items: dict, categories: dict, tanggal) -> None:
    sa, sheet_id = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON"), os.environ.get("SHEET_ID")
    if not (sa and sheet_id):
        print("Google Sheet dilewati: GOOGLE_SERVICE_ACCOUNT_JSON / SHEET_ID belum diset.")
        return
    rows = build_rows(items, categories, tanggal)
    if not rows:
        return
    try:
        import gspread  # impor di sini agar self-check jalan tanpa gspread terpasang

        ws = gspread.service_account_from_dict(json.loads(sa)).open_by_key(sheet_id).sheet1
        if not ws.get_values("A1"):
            ws.append_row(HEADER)
        # RAW: teks dari web yang diawali "=" tidak dievaluasi sebagai rumus.
        # shortcut: tidak ada deduplikasi, menjalankan agent dua kali sehari menambah baris dobel.
        ws.append_rows(rows, value_input_option="RAW")
        print(f"{len(rows)} baris ditulis ke Google Sheet.")
    except Exception as exc:  # noqa: BLE001 - kegagalan Sheet tidak boleh menggagalkan briefing
        print(f"Gagal menulis ke Google Sheet: {exc}", file=sys.stderr)


if __name__ == "__main__":
    import datetime

    cats = {"fiskal": {"title": "Fiskal & Moneter"}, "global": {"title": "Global"}}
    items = {
        "fiskal": [{"teks": "=HYPERLINK(1)", "link": "https://tinyurl.com/x", "gambar": "https://cdn.example/a.jpg"},
                   {"teks": "Berita B", "link": "https://tinyurl.com/y", "gambar": None}],
        "global": [],
    }
    rows = build_rows(items, cats, datetime.date(2026, 11, 23))
    assert len(rows) == 2 and len(rows[0]) == len(HEADER)
    assert rows[0][:3] == ["2026-11-23", "fiskal", "Fiskal & Moneter"]
    assert rows[1][5] == "", "gambar None harus jadi string kosong"
    print("OK: build_rows lolos")
