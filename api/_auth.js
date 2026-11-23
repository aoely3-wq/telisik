// Sesi tanpa penyimpanan server: cookie HttpOnly berisi {u, pv, exp} bertanda tangan HMAC.
// pv = sidik jari hash password saat ini, jadi mengganti password langsung mencabut sesi lama
// (paling lambat 30 detik di instance lain, sesuai cache _users.js).
// Env wajib: SESSION_SECRET (minimal 32 karakter acak).
const crypto = require("crypto");
const { getUser } = require("./_users");

const TTL = 12 * 3600; // detik
const b64 = (s) => Buffer.from(s).toString("base64url");

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET belum diset atau kurang dari 32 karakter");
  return s;
}
const mac = (data) => crypto.createHmac("sha256", secret()).update(data).digest("base64url");
const pvOf = (user) => crypto.createHash("sha256").update(user.hash).digest("hex").slice(0, 12);

function makeToken(user) {
  const body = b64(JSON.stringify({ u: user.u, pv: pvOf(user), exp: Math.floor(Date.now() / 1000) + TTL }));
  return `${body}.${mac(body)}`;
}
const cookieHeader = (token, maxAge) => `sess=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAge}`;

async function session(req) {
  const m = /(?:^|;\s*)sess=([^;]+)/.exec(req.headers.cookie || "");
  const [body, sig] = (m ? m[1] : "").split(".");
  if (!body || !sig) return null;
  const want = Buffer.from(mac(body));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return null;
  let c;
  try { c = JSON.parse(Buffer.from(body, "base64url").toString()); } catch { return null; }
  if (!c.exp || c.exp < Date.now() / 1000) return null;
  const user = await getUser(c.u);
  return user && pvOf(user) === c.pv ? user : null;
}

// Mengembalikan user, atau mengirim 401/403/503 lalu mengembalikan null.
async function requireRole(req, res, role) {
  let user;
  try { user = await session(req); } catch (e) { res.status(503).json({ error: "Server belum siap, coba lagi" }); return null; }
  if (!user) { res.status(401).json({ error: "Belum masuk" }); return null; }
  if (role === "admin" && user.role !== "admin") { res.status(403).json({ error: "Hanya admin" }); return null; }
  return user;
}

// Perlindungan tambahan di luar SameSite=Strict: tolak permintaan tulis dari asal lain.
function sameOrigin(req) {
  const o = req.headers.origin;
  if (!o) return true;
  try { return new URL(o).host === req.headers.host; } catch { return false; }
}

// shortcut: pembatas percobaan login ada di memori per instance (reset saat instance baru), sebagai
// pengaman tambahan di atas biaya scrypt; untuk batas yang ketat pakai Vercel Firewall rate limit.
const fails = new Map();
const WINDOW = 10 * 60 * 1000;
const limited = (ip) => { const f = fails.get(ip); return !!f && f.n >= 5 && Date.now() - f.t < WINDOW; };
const noteFail = (ip) => { const f = fails.get(ip); if (!f || Date.now() - f.t >= WINDOW) fails.set(ip, { n: 1, t: Date.now() }); else f.n++; };
const clearFail = (ip) => fails.delete(ip);
const clientIp = (req) => String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "?";

module.exports = { TTL, makeToken, cookieHeader, requireRole, sameOrigin, limited, noteFail, clearFail, clientIp };
