// POST /api/ganti-password  { target: "admin"|"tamu", current, baru }   (hanya admin)
// current = password admin saat ini (verifikasi ulang), baru = password baru untuk akun target.
const { TTL, makeToken, cookieHeader, requireRole, sameOrigin } = require("./_auth");
const { verify, setPassword } = require("./_users");

const MIN = { admin: 12, tamu: 4 };

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Gunakan POST" });
  if (!sameOrigin(req)) return res.status(403).json({ error: "Asal permintaan ditolak" });
  const me = await requireRole(req, res, "admin");
  if (!me) return;
  const b = req.body && typeof req.body === "object" ? req.body : {};
  const target = b.target === "tamu" || b.target === "admin" ? b.target : null;
  const current = String(b.current || "");
  const baru = String(b.baru || "");
  if (!target) return res.status(400).json({ error: "Akun tidak dikenal" });
  if (baru.length < MIN[target] || baru.length > 128) {
    return res.status(400).json({ error: `Password baru ${MIN[target]} sampai 128 karakter` });
  }
  if (!(await verify(me, current))) return res.status(403).json({ error: "Password admin saat ini salah" });
  try {
    const rec = await setPassword(target, baru);
    // sidik jari password berubah, jadi sesi admin yang sedang dipakai perlu diterbitkan ulang
    if (target === "admin") res.setHeader("Set-Cookie", cookieHeader(makeToken(rec), TTL));
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(502).json({ error: "Gagal menyimpan ke Google Sheet" });
  }
};
