// Penyimpanan akun: tab "pengguna" di Google Sheet (kolom username, hash, role, diubah).
// Hanya dua akun: "admin" (boleh tarik berita dan ganti password) dan "tamu" (hanya melihat).
// Sebelum password sebuah akun pernah diganti lewat aplikasi, nilai awalnya dibaca dari env:
// ADMIN_PASSWORD (wajib agar admin bisa masuk) dan TAMU_PASSWORD (default "tamu").
// Disarankan memakai file Sheet terpisah (USERS_SHEET_ID) agar hash tidak terlihat analis.
const crypto = require("crypto");
const { sheetsFetch, sheetId } = require("./_sheet");

const TAB = "pengguna";
const HEADER = ["username", "hash", "role", "diubah"];
const ROLES = { admin: "admin", tamu: "user" };
const SCRYPT = { N: 16384, r: 8, p: 1 };
const sid = () => process.env.USERS_SHEET_ID || sheetId();

function hashPw(pw, salt = crypto.randomBytes(16)) {
  const h = crypto.scryptSync(pw, salt, 32, SCRYPT);
  return `s1$${salt.toString("base64")}$${h.toString("base64")}`;
}
function checkPw(pw, stored) {
  const [v, s, h] = String(stored).split("$");
  if (v !== "s1" || !s || !h) return false;
  const want = Buffer.from(h, "base64");
  const got = crypto.scryptSync(pw, Buffer.from(s, "base64"), want.length, SCRYPT);
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}
const DUMMY = hashPw("tidak-dipakai"); // dipakai agar waktu respons sama untuk akun yang tidak ada

// Akun bawaan dari env. Salt-nya deterministik (turunan SESSION_SECRET) supaya hash, dan
// karenanya sesi, sama di semua instance serverless.
const fb = {};
function fallback(u) {
  const pass = u === "tamu" ? process.env.TAMU_PASSWORD || "tamu" : u === "admin" ? process.env.ADMIN_PASSWORD : null;
  if (!pass) return null;
  if (!fb[u] || fb[u].pass !== pass) {
    const salt = crypto.createHmac("sha256", process.env.SESSION_SECRET || "").update("fb:" + u).digest().subarray(0, 16);
    fb[u] = { pass, hash: hashPw(pass, salt) };
  }
  return { u, role: ROLES[u], hash: fb[u].hash };
}

let cache = null;
async function load() {
  if (cache && cache.exp > Date.now()) return cache.map;
  const map = new Map();
  const r = await sheetsFetch(sid(), `/values/${TAB}!A:D`);
  if (r.ok) {
    const vals = (await r.json()).values || [];
    const start = vals[0] && vals[0][0] === HEADER[0] ? 1 : 0;
    vals.slice(start).forEach((v, i) => {
      if (ROLES[v[0]] && v[1]) map.set(v[0], { u: v[0], role: ROLES[v[0]], hash: v[1], row: i + start + 1 });
    });
  } else if (r.status !== 400) {
    throw new Error(`users ${r.status}`); // 400 = tab belum dibuat, dianggap belum ada akun tersimpan
  }
  cache = { map, exp: Date.now() + 30000 };
  return map;
}

async function getUser(u) {
  return (await load()).get(u) || fallback(u);
}

// user boleh null (akun tidak ada); tetap menghitung hash agar waktunya tidak membedakan.
async function verify(user, pw) {
  return checkPw(pw, user ? user.hash : DUMMY) && !!user;
}

async function write(path, method, body) {
  const go = () => sheetsFetch(sid(), path, { method, body, write: true });
  let r = await go();
  if (r.status === 400) { // tab belum ada: buat beserta header, lalu ulangi
    const a = await sheetsFetch(sid(), ":batchUpdate", { method: "POST", write: true, body: { requests: [{ addSheet: { properties: { title: TAB, hidden: true } } }] } });
    if (!a.ok) throw new Error(`users tab ${a.status}`);
    const h = await sheetsFetch(sid(), `/values/${TAB}!A1:D1?valueInputOption=RAW`, { method: "PUT", write: true, body: { values: [HEADER] } });
    if (!h.ok) throw new Error(`users header ${h.status}`);
    r = await go();
  }
  if (!r.ok) throw new Error(`users write ${r.status}`);
}

async function setPassword(u, pw) {
  if (!ROLES[u]) throw new Error("akun tidak dikenal");
  const old = (await load()).get(u);
  const hash = hashPw(pw);
  const row = [u, hash, ROLES[u], new Date().toISOString()];
  if (old) await write(`/values/${TAB}!A${old.row}:D${old.row}?valueInputOption=RAW`, "PUT", { values: [row] });
  else await write(`/values/${TAB}!A:D:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, "POST", { values: [row] });
  cache = null;
  return { u, role: ROLES[u], hash };
}

module.exports = { getUser, verify, setPassword };
