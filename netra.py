# -*- coding: utf-8 -*-
"""Penilaian tone dan filter rekomendasi NETRA.

NETRA (kantor pusat) menerima link berita regional pilihan dari tiap Kanwil. Berita layak
direkomendasikan hanya jika tone-nya positif DAN lolos salah satu query boolean di bawah
(tiap grup = OR antar kata, antar grup = AND). Dipakai bersama oleh agent.py dan agent_gemini.py.

shortcut: pencocokan dilakukan pada baris ringkasan yang dibuat agent, bukan teks penuh artikel,
jadi berita yang kata kuncinya tidak muncul di ringkasan tidak lolos; perluas jika perlu.
"""
import json
import re
import sys

# no = nomor kategori NETRA; urutan list = urutan prioritas saat lebih dari satu query cocok.
QN = [
    {"no": 1, "kat": "Ekonomi & fiskal regional", "tag": "#FiskalRegional #KawalAPBN",
     "g": [["ALCo", "Kajian Fiskal Regional", "APBN", "APBD", "TKD", "Dana Desa"],
           ["Kemenkeu", "DJPb", "KPPN", "Pemerintah Provinsi", "Bangka Belitung", "Babel"]]},
    {"no": 2, "kat": "PKPN & kesejahteraan", "tag": "#ProgramPrioritas #APBNUntukRakyat",
     "g": [["Stunting", "Kemiskinan Ekstrem", "Bansos", "BLT", "Hilirisasi", "Ketahanan Pangan"],
           ["Anggaran", "Realisasi", "Pemerintah", "APBN", "APBD"],
           ["Bangka Belitung", "Babel"]]},
    {"no": 4, "kat": "BLU & SMV Kemenkeu", "tag": "#UMiKemenkeu #UMKMNaikKelas",
     "g": [["Desa Devisa", "Pembiayaan UMi", "PIP", "BPDPKS", "Peremajaan Sawit", "BPDLH", "PT SMI", "KUR"],
           ["UMKM", "Ekspor", "Petani", "Bangka Belitung", "Babel"]]},
    {"no": 3, "kat": "Kemenkeu Satu di daerah", "tag": "#KemenkeuSatu #DJPbHadir",
     "g": [["Bea Cukai", "KPP Pratama", "KPKNL", "Pajak", "Barang Bukti", "Lelang BMN", "Kemenkeu Mengajar"],
           ["Pangkalpinang", "Tanjung Pandan", "Bangka Belitung", "Babel"]]},
]
TONES = ("positif", "netral", "negatif")


def _has(text: str, word: str) -> bool:
    # kata utuh, tidak peduli huruf besar/kecil: "KUR" tidak cocok dengan "kurang"
    return re.search(r"(?<!\w)" + re.escape(word) + r"(?!\w)", text, re.I) is not None


def match_netra(text: str):
    """Kembalikan {no, kat, tag, kata} untuk query pertama yang lolos, atau None."""
    for q in QN:
        hits = [[w for w in grup if _has(text, w)] for grup in q["g"]]
        if all(hits):
            return {"no": q["no"], "kat": q["kat"], "tag": q["tag"], "kata": [w for h in hits for w in h]}
    return None


def build_tone_prompt(lines: list) -> str:
    daftar = "\n".join(f"{i + 1}. {t}" for i, t in enumerate(lines))
    return (
        "Nilai tone setiap berita ekonomi regional berikut dari sudut pandang pemerintah daerah.\n"
        "- positif: kabar baik, kemajuan, capaian, atau dampak menguntungkan.\n"
        "- negatif: masalah, risiko, penurunan, keterlambatan, atau kegagalan.\n"
        "- netral: informasi tanpa muatan baik atau buruk yang jelas.\n"
        f"Jawab HANYA dengan JSON array berisi {len(lines)} string "
        '("positif", "netral", atau "negatif") sesuai urutan nomor, tanpa teks lain.\n\n'
        f"{daftar}"
    )


def parse_tones(raw: str, n: int) -> list:
    """Ambil JSON array dari jawaban model. Panjang/nilai tidak valid -> 'netral' (aman: tidak direkomendasikan)."""
    m = re.search(r"\[.*\]", raw or "", re.S)
    data = json.loads(m.group(0)) if m else []
    out = [t if t in TONES else "netral" for t in data[:n]]
    return out + ["netral"] * (n - len(out))


def assign_tones(items: dict, ask) -> None:
    """Isi item["tone"] dan item["netra"] untuk semua berita dalam satu panggilan model.

    ask(prompt) -> teks jawaban model. Gagal apa pun -> semua 'netral', briefing tetap jalan.
    """
    flat = [i for rows in items.values() for i in rows]
    if not flat:
        return
    try:
        tones = parse_tones(ask(build_tone_prompt([i["teks"] for i in flat])), len(flat))
    except Exception as exc:  # noqa: BLE001 - penilaian tone tidak boleh menggagalkan briefing
        print(f"Penilaian tone gagal, semua dianggap netral: {exc}", file=sys.stderr)
        tones = ["netral"] * len(flat)
    for item, tone in zip(flat, tones):
        item["tone"] = tone
        item["netra"] = match_netra(item["teks"]) if tone == "positif" else None


if __name__ == "__main__":
    m = match_netra("Pemerintah dorong hilirisasi timah di Bangka Belitung, pelaku usaha optimistis")
    assert m and m["no"] == 2 and "Hilirisasi" in m["kata"], m
    assert match_netra("Realisasi APBD Bangka Belitung untuk fasilitas program prioritas")["no"] == 1
    assert match_netra("Penyaluran KUR dan Pembiayaan UMi untuk UMKM di Babel naik")["no"] == 4
    assert match_netra("Kemenkeu Mengajar hadir di sekolah Pangkalpinang bersama Bea Cukai")["no"] == 3
    assert match_netra("Pemerintah tegaskan program ketahanan pangan di sejumlah daerah sentra") is None  # tanpa lokasi
    assert match_netra("Anggaran kurang untuk program di Babel") is None  # "KUR" bukan bagian kata "kurang"
    assert parse_tones('Ini: ["positif","buruk","negatif"]', 4) == ["positif", "netral", "negatif", "netral"]
    assert parse_tones("tidak ada json", 2) == ["netral", "netral"]
    items = {"a": [{"teks": "Pemerintah dorong hilirisasi timah di Bangka Belitung"}, {"teks": "Harga timah turun"}]}
    assign_tones(items, lambda p: '["positif","negatif"]')
    assert items["a"][0]["netra"]["no"] == 2 and items["a"][1]["netra"] is None
    assign_tones(items, lambda p: 1 / 0)  # model gagal -> netral, tidak melempar error
    assert items["a"][0]["tone"] == "netral" and items["a"][0]["netra"] is None
    print("OK: netra.py lolos semua pemeriksaan")
