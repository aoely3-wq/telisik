// POST /api/logout  ->  hapus cookie sesi
const { cookieHeader, sameOrigin } = require("./_auth");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Gunakan POST" });
  if (!sameOrigin(req)) return res.status(403).json({ error: "Asal permintaan ditolak" });
  res.setHeader("Set-Cookie", cookieHeader("", 0));
  return res.status(200).json({ ok: true });
};
