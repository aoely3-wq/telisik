// GET /api/berita?days=7   (semua pengguna yang sudah masuk)
// Baris tab "Berita" untuk N tanggal terakhir yang ada datanya (bukan N hari kalender), supaya UI tetap
// terisi saat bot belum jalan hari ini. Maksimal 30. fresh=1 melewati cache 60 detik.
// meta.maxNomor naik setiap bot menambah berita, dipakai UI untuk mengetahui "tarik berita" sudah selesai.
const { requireRole } = require("./_auth");
const { rows } = require("./_sheet");
const { normalizeRow } = require("./_berita");

module.exports = async (req, res) => {
  if (req.method !== "GET") return res.status(405).json({ error: "Gunakan GET" });
  if (!(await requireRole(req, res, "user"))) return;
  const q = req.query || {};
  const days = Math.min(30, Math.max(1, parseInt(q.days, 10) || 7));
  try {
    const all = (await rows(q.fresh === "1")).map(normalizeRow).filter(Boolean);
    const keep = new Set([...new Set(all.map((r) => r.tanggal))].sort().reverse().slice(0, days));
    const last = all.reduce((m, r) => (r.nomor > m.nomor ? r : m), { nomor: 0, tanggal: "", waktu: "" });
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({
      rows: all.filter((r) => keep.has(r.tanggal)).sort((a, b) => a.nomor - b.nomor),
      // Waktu Eksekusi dari bot sudah memuat tanggal ("19/11/2026 12:14 - Percobaan 2"); jika hanya jam, tambahkan tanggal berita
      meta: { maxNomor: last.nomor, lastRun: /\d{1,2}\/\d{1,2}\/\d{4}/.test(last.waktu) ? last.waktu : last.tanggal ? `${last.tanggal} ${last.waktu}`.trim() : "" },
    });
  } catch (e) {
    return res.status(502).json({ error: "Gagal membaca Google Sheet" });
  }
};
