// Jalankan: node api/_selftest.js  (Google Sheets dan GitHub ditiru, tidak ada panggilan jaringan)
const crypto = require("crypto");
const assert = require("assert");

const { privateKey } = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
Object.assign(process.env, {
  GH_REPO: "x/y",
  GH_TOKEN: "t",
  SHEET_ID: "sheet1",
  GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({ client_email: "sa@x.iam.gserviceaccount.com", private_key: privateKey }),
  SESSION_SECRET: crypto.randomBytes(32).toString("hex"),
  ADMIN_PASSWORD: "Admin-Uji-123456",
});

// ---- Google Sheets tiruan ----
const store = {
  berita: [
    ["tanggal", "kategori_key", "teks", "tone"],
    ["2026-11-23", "komoditas", "A", "positif"],
    ["2026-11-22", "geopolitik", "B", "netral"],
    ["2026-11-21", "geopolitik", "C", "negatif"],
  ],
  pengguna: null, // null = tab belum dibuat
};
let sheetReads = 0;
let runs = [];
let dispatched = null;
const reply = (j, s = 200) => ({ ok: s < 300, status: s, json: async () => j });

global.fetch = async (url, init = {}) => {
  const u = String(url);
  const method = init.method || "GET";
  const body = init.body && !String(init.body).startsWith("grant_type") && !(init.body instanceof URLSearchParams) ? JSON.parse(init.body) : null;
  if (u.includes("oauth2.googleapis.com")) return reply({ access_token: "tok", expires_in: 3600 });
  if (u.includes("api.github.com")) {
    if (method === "POST") { dispatched = body; return reply(null, 204); }
    return reply({ workflow_runs: runs });
  }
  if (u.includes("sheets.googleapis.com")) {
    const rest = /spreadsheets\/[^/:]+(.*)$/.exec(u)[1];
    if (rest === ":batchUpdate") { store.pengguna = []; return reply({}); }
    const [p] = rest.split("?");
    if (p === "/values/A:Z") { sheetReads++; return reply({ values: store.berita }); }
    if (p.startsWith("/values/pengguna!")) {
      if (store.pengguna === null) return reply({ error: "tab tidak ada" }, 400);
      const range = p.slice("/values/pengguna!".length);
      if (method === "GET") return reply({ values: store.pengguna });
      if (range.endsWith(":append")) { store.pengguna.push(...body.values); return reply({}); }
      const n = parseInt(/^A(\d+):D\d+$/.exec(range)[1], 10);
      store.pengguna[n - 1] = body.values[0];
      return reply({});
    }
  }
  throw new Error("fetch tak terduga: " + u);
};

const h = {
  login: require("./login"), logout: require("./logout"), me: require("./me"),
  ganti: require("./ganti-password"), berita: require("./berita"), tarik: require("./tarik"), status: require("./status"),
};
const mk = () => ({ code: 200, body: null, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, end() { return this; } });
const call = async (fn, { method = "GET", body, cookie, headers = {}, query = {} } = {}) => {
  const res = mk();
  await fn({ method, body, query, headers: { host: "app.test", "x-forwarded-for": "1.1.1.1", ...(cookie ? { cookie: "sess=" + cookie } : {}), ...headers } }, res);
  const sc = res.headers["Set-Cookie"];
  if (sc) { res.cookie = /sess=([^;]*)/.exec(sc)[1]; res.setCookie = sc; }
  return res;
};
const login = (username, password, extra) => call(h.login, { method: "POST", body: { username, password }, ...extra });
const ago = (min) => new Date(Date.now() - min * 60000).toISOString();

(async () => {
  // --- login ---
  assert.equal((await login("tamu", "salah")).code, 401);
  assert.equal((await login("hantu", "tamu")).code, 401);
  assert.equal((await login("admin", "tamu")).code, 401);
  const t = await login("tamu", "tamu");
  assert.equal(t.code, 200);
  assert.equal(t.body.role, "user");
  for (const flag of ["HttpOnly", "Secure", "SameSite=Strict"]) assert.ok(t.setCookie.includes(flag), flag);
  const a = await login("admin", "Admin-Uji-123456");
  assert.equal(a.body.role, "admin");

  // --- me / berita: semua yang sudah masuk; tanpa sesi ditolak ---
  assert.equal((await call(h.me)).code, 401);
  assert.equal((await call(h.me, { cookie: t.cookie })).body.username, "tamu");
  assert.equal((await call(h.berita, { cookie: t.cookie, query: { days: "2" } })).body.rows.length, 2);
  assert.equal((await call(h.berita, { query: { days: "2" } })).code, 401);
  assert.equal((await call(h.berita, { cookie: t.cookie + "x", query: {} })).code, 401); // tanda tangan rusak
  assert.equal(sheetReads, 1, "berita dibaca sekali, sisanya dari cache");

  // --- tarik dan status: hanya admin ---
  runs = [{ status: "completed", event: "schedule", created_at: ago(5) }];
  assert.equal((await call(h.tarik, { method: "POST", cookie: t.cookie, body: {} })).code, 403);
  assert.equal((await call(h.status, { cookie: t.cookie })).code, 403);
  assert.equal((await call(h.tarik, { method: "POST", body: {} })).code, 401);
  const ok = await call(h.tarik, { method: "POST", cookie: a.cookie, body: { kategori: ["fiskal_moneter", "../x"], telegram: false } });
  assert.equal(ok.code, 202);
  assert.deepEqual(dispatched.inputs, { kategori: "fiskal_moneter", telegram: "false" });
  runs = [{ status: "in_progress", event: "schedule", created_at: ago(1) }];
  assert.equal((await call(h.tarik, { method: "POST", cookie: a.cookie, body: {} })).code, 409);
  runs = [{ status: "completed", event: "workflow_dispatch", created_at: ago(10) }];
  const cd = await call(h.tarik, { method: "POST", cookie: a.cookie, body: {} });
  assert.equal(cd.code, 429);
  assert.ok(Date.parse(cd.body.retryAt) > Date.now());
  runs = [{ status: "completed", conclusion: "success", event: "workflow_dispatch", created_at: ago(1), updated_at: ago(0), id: 9 }];
  assert.deepEqual(Object.keys((await call(h.status, { cookie: a.cookie })).body).sort(), ["conclusion", "created_at", "event", "status", "updated_at"]);

  // --- ganti password ---
  assert.equal((await call(h.ganti, { method: "POST", cookie: t.cookie, body: { target: "tamu", current: "tamu", baru: "tamu2" } })).code, 403, "tamu tidak boleh");
  assert.equal((await call(h.ganti, { method: "POST", cookie: a.cookie, body: { target: "tamu", current: "salah", baru: "tamu2" } })).code, 403, "password admin saat ini salah");
  assert.equal((await call(h.ganti, { method: "POST", cookie: a.cookie, body: { target: "tamu", current: "Admin-Uji-123456", baru: "abc" } })).code, 400, "tamu min 4");
  assert.equal((await call(h.ganti, { method: "POST", cookie: a.cookie, body: { target: "admin", current: "Admin-Uji-123456", baru: "pendek" } })).code, 400, "admin min 12");
  assert.equal((await call(h.ganti, { method: "POST", cookie: a.cookie, body: { target: "root", current: "Admin-Uji-123456", baru: "x".repeat(20) } })).code, 400);
  assert.equal(store.pengguna, null, "belum ada yang tersimpan");

  const g1 = await call(h.ganti, { method: "POST", cookie: a.cookie, body: { target: "tamu", current: "Admin-Uji-123456", baru: "tamu2" } });
  assert.equal(g1.code, 200);
  assert.deepEqual(store.pengguna[0], ["username", "hash", "role", "diubah"], "tab dan header dibuat otomatis");
  assert.equal(store.pengguna[1][0], "tamu");
  assert.ok(store.pengguna[1][1].startsWith("s1$"), "disimpan sebagai hash");
  assert.ok(!JSON.stringify(store.pengguna).includes("tamu2"), "password tidak disimpan sebagai teks");
  assert.equal((await call(h.berita, { cookie: t.cookie, query: {} })).code, 401, "sesi tamu lama dicabut");
  assert.equal((await login("tamu", "tamu")).code, 401, "password lama tidak berlaku");
  const t2 = await login("tamu", "tamu2");
  assert.equal(t2.code, 200);
  assert.equal((await call(h.berita, { cookie: t2.cookie, query: {} })).code, 200);
  assert.equal((await call(h.me, { cookie: a.cookie })).body.role, "admin", "sesi admin tidak ikut tercabut");

  const newAdmin = "Admin-Baru-98765!";
  const g2 = await call(h.ganti, { method: "POST", cookie: a.cookie, body: { target: "admin", current: "Admin-Uji-123456", baru: newAdmin } });
  assert.equal(g2.code, 200);
  assert.ok(g2.cookie && g2.cookie !== a.cookie, "sesi admin diterbitkan ulang");
  assert.equal((await call(h.me, { cookie: a.cookie })).code, 401, "sesi admin lama dicabut");
  assert.equal((await call(h.me, { cookie: g2.cookie })).body.role, "admin");
  assert.equal((await login("admin", "Admin-Uji-123456")).code, 401, "password env tidak berlaku setelah diganti");
  assert.equal((await login("admin", newAdmin)).code, 200);
  assert.equal(store.pengguna.length, 3, "satu baris per akun");
  const g3 = await call(h.ganti, { method: "POST", cookie: g2.cookie, body: { target: "tamu", current: newAdmin, baru: "tamu3" } });
  assert.equal(g3.code, 200);
  assert.equal(store.pengguna.length, 3, "mengganti password akun yang sudah ada memperbarui baris, bukan menambah");

  // --- logout, asal permintaan, pembatas, konfigurasi ---
  assert.ok((await call(h.logout, { method: "POST", cookie: g2.cookie })).setCookie.includes("Max-Age=0"));
  assert.equal((await login("tamu", "tamu3", { headers: { origin: "https://jahat.example" } })).code, 403);
  assert.equal((await call(h.tarik, { method: "POST", cookie: g2.cookie, body: {}, headers: { origin: "https://jahat.example" } })).code, 403);
  for (let i = 0; i < 5; i++) assert.equal((await login("tamu", "salah", { headers: { "x-forwarded-for": "9.9.9.9" } })).code, 401);
  assert.equal((await login("tamu", "tamu3", { headers: { "x-forwarded-for": "9.9.9.9" } })).code, 429, "IP terkunci setelah 5 kegagalan");
  const secret = process.env.SESSION_SECRET;
  delete process.env.SESSION_SECRET;
  assert.equal((await login("tamu", "tamu3")).code, 500, "tanpa SESSION_SECRET login gagal tertutup");
  process.env.SESSION_SECRET = secret;

  console.log("OK: autentikasi, peran, ganti password, dan endpoint lolos semua pemeriksaan");
})().catch((e) => { console.error(e); process.exit(1); });
