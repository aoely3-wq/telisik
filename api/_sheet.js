// Akses Google Sheets lewat REST dengan service account (tanpa dependensi npm).
// Env: GOOGLE_SERVICE_ACCOUNT_JSON (isi file kunci) dan SHEET_ID, sama dengan yang dipakai agent.
// Pembacaan berita memakai token read-only; token tulis hanya diminta untuk menyimpan password (_users.js).
const crypto = require("crypto");

const SCOPE_READ = "https://www.googleapis.com/auth/spreadsheets.readonly";
const SCOPE_WRITE = "https://www.googleapis.com/auth/spreadsheets";
const toks = {};
let cache = null;
const b64 = (s) => Buffer.from(s).toString("base64url");

async function token(write = false) {
  const scope = write ? SCOPE_WRITE : SCOPE_READ;
  const t = toks[scope];
  if (t && t.exp > Date.now() + 60000) return t.value;
  const sa = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const now = Math.floor(Date.now() / 1000);
  const unsigned =
    b64(JSON.stringify({ alg: "RS256", typ: "JWT" })) + "." +
    b64(JSON.stringify({ iss: sa.client_email, scope, aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }));
  const sig = crypto.createSign("RSA-SHA256").update(unsigned).sign(sa.private_key).toString("base64url");
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${sig}` }),
  });
  if (!r.ok) throw new Error(`token ${r.status}`);
  const j = await r.json();
  toks[scope] = { value: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return toks[scope].value;
}

// path diawali "/values/..." atau ":batchUpdate" (relatif terhadap spreadsheet).
async function sheetsFetch(sheetId, path, { method = "GET", body, write = false } = {}) {
  return fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}${path}`, {
    method,
    headers: { Authorization: `Bearer ${await token(write)}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
}

// Semua baris sheet pertama sebagai objek {kolom: nilai}. Di-cache 60 detik per instance.
// shortcut: membaca seluruh sheet tiap 60 detik; jika baris sudah puluhan ribu, pindah ke
// pembacaan rentang tanggal terakhir saja atau arsipkan baris lama ke sheet lain.
async function rows(fresh = false) {
  if (!fresh && cache && cache.exp > Date.now()) return cache.rows;
  const r = await sheetsFetch(process.env.SHEET_ID, "/values/A:Z");
  if (!r.ok) throw new Error(`sheets ${r.status}`);
  const [head = [], ...body] = (await r.json()).values || [];
  const out = body.map((v) => Object.fromEntries(head.map((h, i) => [h, v[i] || ""])));
  cache = { rows: out, exp: Date.now() + 60000 };
  return out;
}

module.exports = { rows, sheetsFetch };
