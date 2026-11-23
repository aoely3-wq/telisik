// GET /api/gambar?u=<link berita>   (semua pengguna yang sudah masuk)  ->  { gambar: "https://..." | "" }
// Sheet bot tidak punya kolom gambar, jadi og:image diambil saat dibutuhkan. Hanya link yang tercatat di Sheet
// yang boleh diambil (mencegah endpoint dipakai untuk mengakses alamat sembarang), hasilnya di-cache per instance.
const { requireRole } = require("./_auth");
const { rows } = require("./_sheet");
const { normalizeRow } = require("./_berita");
const { fetchOg } = require("./_og");

const cache = new Map(); // link -> { v, exp }

module.exports = async (req, res) => {
  if (req.method !== "GET") return res.status(405).json({ error: "Gunakan GET" });
  if (!(await requireRole(req, res, "user"))) return;
  const u = String((req.query || {}).u || "");
  if (!/^https?:\/\//i.test(u) || u.length > 2000) return res.status(400).json({ error: "Link tidak valid" });
  const hit = cache.get(u);
  if (hit && hit.exp > Date.now()) return res.status(200).json({ gambar: hit.v });
  try {
    const known = (await rows()).some((r) => (normalizeRow(r) || {}).link === u);
    if (!known) return res.status(404).json({ error: "Link tidak ada di Sheet" });
    const v = await fetchOg(u);
    cache.set(u, { v, exp: Date.now() + (v ? 24 : 1) * 3600000 }); // yang gagal dicoba lagi 1 jam kemudian
    res.setHeader("Cache-Control", "private, max-age=3600");
    return res.status(200).json({ gambar: v });
  } catch (e) {
    return res.status(502).json({ error: "Gagal mengambil gambar" });
  }
};
