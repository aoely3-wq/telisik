// GET /api/berita?days=7|N|all   (semua pengguna yang sudah masuk)
// days = N tanggal terakhir yang ada datanya (bukan N hari kalender), supaya UI tetap terisi saat bot belum jalan
// hari ini; "all" = seluruh riwayat Sheet. fresh=1 melewati cache 60 detik.
// meta.maxNomor naik setiap bot menambah berita, dipakai UI untuk mengetahui "tarik berita" sudah selesai.
// meta.dilewati = baris Sheet yang tidak dikirim karena tanggal atau uraiannya tidak terbaca.
// shortcut: satu respons memuat seluruh riwayat (batas Vercel 4,5 MB; sekitar 900 baris = 0,4 MB). Jika Sheet
// melewati ~8000 baris, tambahkan parameter from/to dan muat per rentang.
const { requireRole } = require("./_auth");
const { rows } = require("./_sheet");
const { normalizeRow } = require("./_berita");

module.exports = async (req, res) => {
  if (req.method !== "GET") return res.status(405).json({ error: "Gunakan GET" });
  if (!(await requireRole(req, res, "user"))) return;
  const q = req.query || {};
  const days = q.days === "all" ? Infinity : Math.min(3650, Math.max(1, parseInt(q.days, 10) || 7));
  try {
    const raw = (await rows(q.fresh === "1")).filter((r) => Object.values(r).some((v) => String(v).trim()));
    const all = raw.map(normalizeRow).filter(Boolean);
    const dates = [...new Set(all.map((r) => r.tanggal))].sort().reverse();
    const keep = new Set(dates.slice(0, days));
    const last = all.reduce((m, r) => (r.nomor > m.nomor ? r : m), { nomor: 0, tanggal: "", waktu: "" });
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({
      rows: all.filter((r) => keep.has(r.tanggal)).sort((a, b) => a.nomor - b.nomor),
      meta: {
        maxNomor: last.nomor,
        // Waktu Eksekusi dari bot sudah memuat tanggal ("19/11/2026 12:14 - Percobaan 2"); jika hanya jam, tambahkan tanggal berita
        lastRun: /\d{1,2}\/\d{1,2}\/\d{4}/.test(last.waktu) ? last.waktu : last.tanggal ? `${last.tanggal} ${last.waktu}`.trim() : "",
        total: raw.length,
        dilewati: raw.length - all.length,
        tanggalAwal: dates[dates.length - 1] || "",
        tanggalAkhir: dates[0] || "",
      },
    });
  } catch (e) {
    return res.status(502).json({ error: "Gagal membaca Google Sheet" });
  }
};
