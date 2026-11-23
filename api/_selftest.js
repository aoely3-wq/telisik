// Jalankan: node api/_selftest.js  (Google Sheets, bot Render, dan situs berita ditiru; tidak ada panggilan jaringan)
const crypto = require("crypto");
const assert = require("assert");

const { privateKey } = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
Object.assign(process.env, {
  GOOGLE_SHEET_ID: "sheet1",
  GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({ client_email: "sa@x.iam.gserviceaccount.com", private_key: privateKey }),
  SESSION_SECRET: crypto.randomBytes(32).toString("hex"),
  ADMIN_PASSWORD: "Admin-Uji-123456",
  BOT_URL: "https://bot.example.onrender.com/",
  CRON_SECRET: "rahasia-cron-1234567890",
});

// ---- Google Sheets tiruan: tab "Berita" dalam format bot lama, dan tab tersembunyi "pengguna" ----
const HEAD = ["Nomor", "Tanggal Berita", "Waktu Eksekusi", "Kategori", "Uraian Singkat", "Sumber Berita", "Link berita", "Tone Berita", "Rekomendasi ke NETRA"];
const store = {
  berita: [
    HEAD,
    ["1", "23/11/2026", "06:10", "Regional Babel - Ekonomi dan Fiskal", "Penyaluran KUR untuk UMKM di Babel naik", "babelpos.example", "https://babelpos.example/a", "Positif", "Direkomendasikan"],
    ["2", "23/11/2026", "06:10", "PKPN (8 Program Prioritas) - Provinsi Kep. Bangka Belitung - Hilirisasi dan Industrialisasi", "Pemerintah dorong hilirisasi timah", "babelpos.example", "https://babelpos.example/b", "Positif", "Dipertimbangkan"],
    ["3", "22/11/2026", "06:09", "Harga Komoditas Strategis", "Harga timah melemah tipis", "pasar.example", "https://pasar.example/c", "Negatif", "Bisa diabaikan"],
    ["4", "21/11/2026", "06:11", "Geopolitik dan Ekonomi Global", "Bank sentral mempertahankan suku bunga", "dunia.example", "https://dunia.example/d", "Netral", "Bisa diabaikan"],
    ["", "", "", "", "catatan analis tanpa tanggal", "", "", "", ""],
  ],
  pengguna: null, // null = tab belum dibuat
  hiddenAtCreate: null,
};
let sheetReads = 0;
let botCalls = [];
let botReply = () => ({ status: 202, text: "dimulai" });
const reply = (j, s = 200) => ({ ok: s < 300, status: s, json: async () => j });

global.fetch = async (url, init = {}) => {
  const u = String(url);
  const method = init.method || "GET";
  const body = init.body && typeof init.body === "string" && init.body[0] === "{" ? JSON.parse(init.body) : null;
  if (u.includes("oauth2.googleapis.com")) return reply({ access_token: "tok", expires_in: 3600 });
  if (u.startsWith("https://bot.example.onrender.com")) {
    botCalls.push({ url: u, secret: init.headers && init.headers["X-Cron-Secret"] });
    const r = botReply();
    return { ok: r.status < 400, status: r.status, text: async () => r.text };
  }
  if (u.includes("sheets.googleapis.com")) {
    const rest = decodeURIComponent(/spreadsheets\/[^/:]+(.*)$/.exec(u)[1]);
    if (rest === ":batchUpdate") { store.pengguna = []; store.hiddenAtCreate = body.requests[0].addSheet.properties.hidden; return reply({}); }
    const [p] = rest.split("?");
    if (p === "/values/'Berita'!A:Z") { sheetReads++; return reply({ values: store.berita }); }
    if (p.startsWith("/values/pengguna!")) {
      if (store.pengguna === null) return reply({ error: "tab tidak ada" }, 400);
      const range = p.slice("/values/pengguna!".length);
      if (method === "GET") return reply({ values: store.pengguna });
      if (range.endsWith(":append")) { store.pengguna.push(...body.values); return reply({}); }
      store.pengguna[parseInt(/^A(\d+):D\d+$/.exec(range)[1], 10) - 1] = body.values[0];
      return reply({});
    }
  }
  if (u.startsWith("https://babelpos.example/")) {
    if (u.endsWith("/b")) return { ok: true, status: 200, url: u, headers: { get: () => "text/html" }, text: async () => '<head><meta content="/img/b.jpg" property="og:image"></head>' };
    return { ok: true, status: 200, url: u, headers: { get: () => "text/html" }, text: async () => "<head><title>tanpa gambar</title></head>" };
  }
  throw new Error("fetch tak terduga: " + u);
};

const h = {
  login: require("./login"), logout: require("./logout"), me: require("./me"), ganti: require("./ganti-password"),
  berita: require("./berita"), tarik: require("./tarik"), gambar: require("./gambar"),
};
const { normalizeRow, parseDate, splitKategori, kelompok } = require("./_berita");
const { ogImage } = require("./_og");

const mk = () => ({ code: 200, body: null, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, end() { return this; } });
const call = async (fn, { method = "GET", body, cookie, headers = {}, query = {} } = {}) => {
  const res = mk();
  await fn({ method, body, query, headers: { host: "app.test", "x-forwarded-for": "1.1.1.1", ...(cookie ? { cookie: "sess=" + cookie } : {}), ...headers } }, res);
  const sc = res.headers["Set-Cookie"];
  if (sc) { res.cookie = /sess=([^;]*)/.exec(sc)[1]; res.setCookie = sc; }
  return res;
};
const login = (username, password, extra) => call(h.login, { method: "POST", body: { username, password }, ...extra });

(async () => {
  // --- normalisasi baris bot lama (fungsi murni) ---
  assert.equal(parseDate("23/11/2026"), "2026-11-23");
  assert.equal(parseDate("3/1/2026"), "2026-01-03");
  assert.equal(parseDate("2026-11-23"), "2026-11-23");
  assert.equal(parseDate("46349"), "2026-11-23", "tanggal serial Sheets");
  assert.equal(parseDate("bukan tanggal"), "");
  const sp = splitKategori(HEAD && store.berita[2][3]);
  assert.equal(sp.dasar, "PKPN (8 Program Prioritas) - Provinsi Kep. Bangka Belitung");
  assert.equal(sp.no, 5);
  assert.equal(splitKategori("Regional Babel - Ekonomi dan Fiskal").no, 0, "kategori biasa tidak dipecah");
  assert.equal(splitKategori("PKPN (8 Program Prioritas) - Tingkat Nasional").no, 0, "tanpa nama program tidak dipecah");
  assert.equal(kelompok("Regional Babel - Ekonomi dan Fiskal").nama, "Ekonomi Babel");
  assert.equal(kelompok("Regional Babel - Sosial, Pendidikan, Kesehatan dan Lingkungan").nama, "Sosial Babel");
  assert.equal(kelompok("PKPN (8 Program Prioritas) - Tingkat Nasional").pkpn, "nas");
  assert.equal(kelompok("Kegiatan Kementerian Keuangan (Kemenkeu Satu) di Bangka Belitung").nama, "Kemenkeu Satu");
  const raw = Object.fromEntries(HEAD.map((k, i) => [k, store.berita[1][i]]));
  const n = normalizeRow(raw);
  assert.equal(n.tanggal, "2026-11-23");
  assert.equal(n.tone, "positif");
  assert.equal(n.netra, "Direkomendasikan");
  assert.equal(normalizeRow(Object.fromEntries(HEAD.map((k, i) => [k, store.berita[5][i]]))), null, "baris tanpa tanggal dibuang");
  assert.equal(normalizeRow({ ...raw, "Tone Berita": "aneh" }).tone, "netral", "tone tak dikenal jadi netral");
  assert.equal(normalizeRow({ ...raw, Verifikasi: "ya", "Diteruskan ke NETRA": "ya" }).verifikasi, "ya", "kolom opsional terbaca");

  // --- og:image ---
  assert.equal(ogImage('<meta property="og:image" content="https://cdn.example/x.jpg">', "https://s.example/a"), "https://cdn.example/x.jpg");
  assert.equal(ogImage('<meta content="/img/y.jpg?a=1&amp;b=2" property="og:image">', "https://s.example/a/b"), "https://s.example/img/y.jpg?a=1&b=2");
  assert.equal(ogImage('<meta name="twitter:image" content="//cdn.example/z.png">', "https://s.example/a"), "https://cdn.example/z.png");
  assert.equal(ogImage('<meta property="og:image" content="javascript:alert(1)">', "https://s.example/"), "");
  assert.equal(ogImage("<title>x</title>", "https://s.example/"), "");

  // --- login dan peran ---
  assert.equal((await login("tamu", "salah")).code, 401);
  assert.equal((await login("admin", "tamu")).code, 401);
  const t = await login("tamu", "tamu");
  assert.equal(t.body.role, "user");
  for (const f of ["HttpOnly", "Secure", "SameSite=Strict"]) assert.ok(t.setCookie.includes(f), f);
  const a = await login("admin", "Admin-Uji-123456");
  assert.equal(a.body.role, "admin");

  // --- berita: membaca tab bot lama ---
  assert.equal((await call(h.berita)).code, 401);
  const b = await call(h.berita, { cookie: t.cookie, query: { days: "2" } });
  assert.equal(b.code, 200);
  assert.deepEqual(b.body.rows.map((r) => r.nomor), [1, 2, 3], "2 tanggal terbaru, urut Nomor");
  assert.equal(b.body.rows[1].program_no, 5);
  assert.equal(b.body.rows[1].kategori_nama, "PKPN Babel");
  assert.equal(b.body.meta.maxNomor, 4);
  assert.equal(b.body.meta.lastRun, "2026-11-21 06:11");
  assert.equal((await call(h.berita, { cookie: t.cookie, query: { days: "7" } })).body.rows.length, 4);
  const semua = await call(h.berita, { cookie: t.cookie, query: { days: "all" } });
  assert.equal(semua.body.rows.length, 4, "days=all memuat seluruh riwayat");
  assert.equal(semua.body.meta.total, 5, "baris Sheet yang berisi");
  assert.equal(semua.body.meta.dilewati, 1, "baris tanpa tanggal dihitung sebagai dilewati");
  assert.equal(semua.body.meta.tanggalAwal, "2026-11-21");
  assert.equal(semua.body.meta.tanggalAkhir, "2026-11-23");
  assert.equal((await call(h.berita, { cookie: t.cookie, query: { days: "1" } })).body.rows.length, 2, "days=1 = tanggal terakhir saja");
  assert.equal(sheetReads, 1, "dibaca sekali, sisanya dari cache");
  await call(h.berita, { cookie: t.cookie, query: { fresh: "1" } });
  assert.equal(sheetReads, 2, "fresh=1 melewati cache");

  // --- gambar: hanya untuk link yang ada di Sheet ---
  assert.equal((await call(h.gambar, { query: { u: "https://babelpos.example/b" } })).code, 401);
  assert.equal((await call(h.gambar, { cookie: t.cookie, query: { u: "file:///etc/passwd" } })).code, 400);
  assert.equal((await call(h.gambar, { cookie: t.cookie, query: { u: "http://169.254.169.254/latest/meta-data" } })).code, 404, "bukan link dari Sheet ditolak");
  assert.equal((await call(h.gambar, { cookie: t.cookie, query: { u: "https://babelpos.example/b" } })).body.gambar, "https://babelpos.example/img/b.jpg");
  assert.equal((await call(h.gambar, { cookie: t.cookie, query: { u: "https://babelpos.example/a" } })).body.gambar, "", "tanpa og:image -> kosong");

  // --- tarik: hanya admin, memicu /cron di Render ---
  assert.equal((await call(h.tarik, { method: "POST", cookie: t.cookie, body: {} })).code, 403);
  assert.equal((await call(h.tarik, { method: "POST", body: {} })).code, 401);
  assert.equal((await call(h.tarik, { method: "POST", cookie: a.cookie, body: {}, headers: { origin: "https://jahat.example" } })).code, 403);
  botReply = () => ({ status: 503, text: "<html>wake</html>" });
  assert.equal((await call(h.tarik, { method: "POST", cookie: a.cookie, body: {} })).body.state, "bangun", "server tidur -> UI mengulang");
  botReply = () => ({ status: 404, text: "not found" });
  assert.equal((await call(h.tarik, { method: "POST", cookie: a.cookie, body: {} })).code, 502, "CRON_SECRET belum diisi di Render");
  botReply = () => ({ status: 202, text: "sudah-berjalan" });
  assert.equal((await call(h.tarik, { method: "POST", cookie: a.cookie, body: {} })).body.state, "sudah-berjalan");
  botReply = () => ({ status: 202, text: "dimulai" });
  botCalls = [];
  const ok = await call(h.tarik, { method: "POST", cookie: a.cookie, body: {} });
  assert.equal(ok.code, 202);
  assert.equal(ok.body.state, "dimulai");
  assert.deepEqual(botCalls, [{ url: "https://bot.example.onrender.com/cron", secret: "rahasia-cron-1234567890" }]);
  const cd = await call(h.tarik, { method: "POST", cookie: a.cookie, body: {} });
  assert.equal(cd.code, 429, "batas 30 menit setelah run dimulai");
  assert.ok(Date.parse(cd.body.retryAt) > Date.now());

  // --- ganti password ---
  assert.equal((await call(h.ganti, { method: "POST", cookie: t.cookie, body: { target: "tamu", current: "tamu", baru: "tamu2" } })).code, 403, "tamu tidak boleh");
  assert.equal((await call(h.ganti, { method: "POST", cookie: a.cookie, body: { target: "tamu", current: "salah", baru: "tamu2" } })).code, 403);
  assert.equal((await call(h.ganti, { method: "POST", cookie: a.cookie, body: { target: "tamu", current: "Admin-Uji-123456", baru: "abc" } })).code, 400);
  assert.equal((await call(h.ganti, { method: "POST", cookie: a.cookie, body: { target: "admin", current: "Admin-Uji-123456", baru: "pendek" } })).code, 400);
  assert.equal(store.pengguna, null);
  assert.equal((await call(h.ganti, { method: "POST", cookie: a.cookie, body: { target: "tamu", current: "Admin-Uji-123456", baru: "tamu2" } })).code, 200);
  assert.equal(store.hiddenAtCreate, true, "tab pengguna dibuat tersembunyi");
  assert.deepEqual(store.pengguna[0], ["username", "hash", "role", "diubah"]);
  assert.ok(store.pengguna[1][1].startsWith("s1$"));
  assert.ok(!JSON.stringify(store.pengguna).includes("tamu2"), "tidak ada password teks biasa");
  assert.equal((await call(h.berita, { cookie: t.cookie, query: {} })).code, 401, "sesi tamu lama dicabut");
  assert.equal((await login("tamu", "tamu")).code, 401);
  assert.equal((await login("tamu", "tamu2")).code, 200);
  assert.equal((await call(h.me, { cookie: a.cookie })).body.role, "admin", "sesi admin tidak ikut tercabut");
  const g2 = await call(h.ganti, { method: "POST", cookie: a.cookie, body: { target: "admin", current: "Admin-Uji-123456", baru: "Admin-Baru-98765!" } });
  assert.equal(g2.code, 200);
  assert.equal((await call(h.me, { cookie: a.cookie })).code, 401, "sesi admin lama dicabut");
  assert.equal((await call(h.me, { cookie: g2.cookie })).body.role, "admin", "sesi admin baru diterbitkan");
  assert.equal((await login("admin", "Admin-Uji-123456")).code, 401);
  assert.equal(store.pengguna.length, 3);

  // --- logout, pembatas login, konfigurasi ---
  assert.ok((await call(h.logout, { method: "POST", cookie: g2.cookie })).setCookie.includes("Max-Age=0"));
  assert.equal((await login("tamu", "tamu2", { headers: { origin: "https://jahat.example" } })).code, 403);
  for (let i = 0; i < 5; i++) assert.equal((await login("tamu", "salah", { headers: { "x-forwarded-for": "9.9.9.9" } })).code, 401);
  assert.equal((await login("tamu", "tamu2", { headers: { "x-forwarded-for": "9.9.9.9" } })).code, 429);
  const secret = process.env.SESSION_SECRET;
  delete process.env.SESSION_SECRET;
  assert.equal((await login("tamu", "tamu2")).code, 500, "tanpa SESSION_SECRET gagal tertutup");
  process.env.SESSION_SECRET = secret;
  const cron = process.env.CRON_SECRET;
  delete process.env.CRON_SECRET;
  const a2 = await login("admin", "Admin-Baru-98765!");
  assert.equal((await call(h.tarik, { method: "POST", cookie: a2.cookie, body: {} })).code, 503, "tanpa CRON_SECRET di server");
  process.env.CRON_SECRET = cron;

  console.log("OK: format bot lama, og:image, login, peran, tarik, dan ganti password lolos semua pemeriksaan");
})().catch((e) => { console.error(e); process.exit(1); });
