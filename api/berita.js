// GET /api/berita?days=7   (semua pengguna yang sudah masuk)
// Baris Google Sheet untuk N tanggal terakhir yang ada datanya (bukan N hari kalender),
// supaya UI tetap terisi saat agent belum jalan hari ini. Maksimal 30.
const { requireRole } = require("./_auth");
const { rows } = require("./_sheet");

module.exports = async (req, res) => {
  if (req.method !== "GET") return res.status(405).json({ error: "Gunakan GET" });
  if (!(await requireRole(req, res, "user"))) return;
  const days = Math.min(30, Math.max(1, parseInt((req.query || {}).days, 10) || 7));
  try {
    const all = await rows((req.query || {}).fresh === "1"); // fresh=1: lewati cache 60 detik (setelah tarik berita)
    const keep = new Set([...new Set(all.map((r) => r.tanggal))].sort().reverse().slice(0, days));
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ rows: all.filter((r) => keep.has(r.tanggal)) });
  } catch (e) {
    return res.status(502).json({ error: "Gagal membaca Google Sheet" });
  }
};
