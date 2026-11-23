// POST /api/login  { username, password }  ->  cookie sesi HttpOnly
const { TTL, makeToken, cookieHeader, sameOrigin, limited, noteFail, clearFail, clientIp } = require("./_auth");
const { getUser, verify } = require("./_users");

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Gunakan POST" });
  if (!sameOrigin(req)) return res.status(403).json({ error: "Asal permintaan ditolak" });
  const ip = clientIp(req);
  if (limited(ip)) return res.status(429).json({ error: "Terlalu banyak percobaan, coba lagi 10 menit lagi" });
  const b = req.body && typeof req.body === "object" ? req.body : {};
  const u = String(b.username || "").trim().toLowerCase();
  const p = String(b.password || "");
  try {
    const user = /^[a-z0-9_]{1,32}$/.test(u) && p.length <= 128 ? await getUser(u) : null;
    if (!(await verify(user, p))) {
      noteFail(ip);
      return res.status(401).json({ error: "Username atau password salah" });
    }
    clearFail(ip);
    res.setHeader("Set-Cookie", cookieHeader(makeToken(user), TTL));
    return res.status(200).json({ ok: true, username: user.u, role: user.role });
  } catch (e) {
    return res.status(500).json({ error: "Gagal masuk, coba lagi" });
  }
};
