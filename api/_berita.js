// Mengubah baris mentah tab "Berita" (format bot lama) menjadi baris yang dipakai UI.
// Kolom bot: Nomor | Tanggal Berita (dd/mm/yyyy) | Waktu Eksekusi | Kategori | Uraian Singkat |
// Sumber Berita | Link berita | Tone Berita | Rekomendasi ke NETRA.
// Kolom opsional yang boleh ditambahkan analis di sebelah kanan: "Verifikasi" dan "Diteruskan ke NETRA".

const PROGRAMS = [/pangan/i, /energi|\bair\b/i, /pendidikan/i, /kesehatan/i, /hilirisasi|industri/i, /infrastruktur|perumahan|bencana/i, /kerakyatan|\bdesa\b/i, /kemiskinan/i];
const programNo = (nama) => PROGRAMS.findIndex((r) => r.test(nama)) + 1; // 0 = bukan program

function parseDate(v) {
  const s = String(v || "").trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  if (/^\d{4,6}$/.test(s)) return new Date(Date.UTC(1899, 11, 30) + Number(s) * 86400000).toISOString().slice(0, 10); // tanggal serial Sheets
  return "";
}

// Kategori PKPN dari bot berbentuk "<judul kategori> - <nama program>"; yang lain apa adanya.
function splitKategori(k) {
  const i = k.lastIndexOf(" - ");
  if (/^PKPN/i.test(k) && i > 0) {
    const program = k.slice(i + 3), no = programNo(program);
    if (no) return { dasar: k.slice(0, i), program, no };
  }
  return { dasar: k, program: "", no: 0 };
}

// Nama pendek dan adegan ilustrasi cadangan untuk tiap jenis kategori.
function kelompok(d) {
  if (/PKPN/i.test(d)) { const babel = /bangka|babel/i.test(d); return { nama: babel ? "PKPN Babel" : "PKPN nasional", adegan: babel ? "pkpnBabel" : "pkpnNas", pkpn: babel ? "babel" : "nas" }; }
  if (/Kemenkeu/i.test(d)) return { nama: "Kemenkeu Satu", adegan: "fiskal", pkpn: "" };
  if (/Kesejahteraan/i.test(d)) return { nama: "Kesejahteraan Babel", adegan: "sosial", pkpn: "" };
  if (/Ekonomi/i.test(d) && /Babel|Bangka/i.test(d)) return { nama: "Ekonomi Babel", adegan: "ekoBabel", pkpn: "" };
  if (/Sosial/i.test(d)) return { nama: "Sosial Babel", adegan: "sosial", pkpn: "" };
  if (/Fiskal|Moneter/i.test(d)) return { nama: "Fiskal & moneter", adegan: "fiskal", pkpn: "" };
  if (/Komoditas/i.test(d)) return { nama: "Komoditas", adegan: "komoditas", pkpn: "" };
  if (/Geopolitik|Global/i.test(d)) return { nama: "Geopolitik", adegan: "global", pkpn: "" };
  return { nama: d.length > 28 ? d.slice(0, 26) + "…" : d, adegan: "fiskal", pkpn: "" };
}

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// Nilai kolom dengan nama header yang tidak peka huruf besar/kecil; kosong jika tidak ada.
function pick(raw, ...names) {
  for (const n of names) {
    const key = Object.keys(raw).find((x) => x.trim().toLowerCase() === n.toLowerCase());
    if (key && String(raw[key]).trim()) return String(raw[key]).trim();
  }
  return "";
}

// Mengembalikan null untuk baris tanpa tanggal atau uraian (baris kosong, catatan, dsb).
function normalizeRow(raw) {
  const tanggal = parseDate(pick(raw, "Tanggal Berita"));
  const teks = pick(raw, "Uraian Singkat");
  if (!tanggal || !teks) return null;
  const kat = pick(raw, "Kategori");
  const { dasar, program, no } = splitKategori(kat);
  const g = kelompok(dasar);
  const tone = pick(raw, "Tone Berita").toLowerCase();
  return {
    nomor: parseInt(pick(raw, "Nomor"), 10) || 0,
    tanggal,
    waktu: pick(raw, "Waktu Eksekusi"),
    kategori: kat,
    kategori_key: slug(dasar),
    kategori_nama: g.nama,
    adegan: g.adegan,
    pkpn: g.pkpn,
    program,
    program_no: no,
    teks,
    sumber: pick(raw, "Sumber Berita"),
    link: pick(raw, "Link berita"),
    tone: ["positif", "negatif", "netral"].includes(tone) ? tone : "netral",
    netra: pick(raw, "Rekomendasi ke NETRA"),
    verifikasi: pick(raw, "Verifikasi"),
    diteruskan: pick(raw, "Diteruskan ke NETRA"),
  };
}

module.exports = { normalizeRow, parseDate, splitKategori, kelompok };
