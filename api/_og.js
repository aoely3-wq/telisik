// Mengambil gambar utama (og:image) dari halaman berita, tanpa dependensi npm.
// shortcut: hanya membaca 300 KB pertama dan tidak menjalankan JavaScript; situs yang gambarnya dirender JS
// atau memblokir bot menghasilkan "" (UI memakai ilustrasi cadangan).
const META = /<meta\b[^>]*\b(?:property|name)=["'](?:og:image(?::secure_url)?|twitter:image)["'][^>]*>/gi;
const CONTENT = /\bcontent=["']([^"']+)["']/i;
const decode = (s) => s.replace(/&amp;/g, "&").replace(/&#39;|&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">");

// URL gambar absolut (http/https) dari html, atau "".
function ogImage(html, base) {
  for (const tag of html.match(META) || []) {
    const m = CONTENT.exec(tag);
    if (!m) continue;
    try {
      const u = new URL(decode(m[1].trim()), base);
      if (u.protocol === "http:" || u.protocol === "https:") return u.href;
    } catch { /* URL rusak: coba tag berikutnya */ }
  }
  return "";
}

async function readLimited(r, max) {
  if (!r.body || !r.body.getReader) return (await r.text()).slice(0, max);
  const rd = r.body.getReader();
  const dec = new TextDecoder();
  let out = "", n = 0;
  while (n < max) {
    const { done, value } = await rd.read();
    if (done) break;
    n += value.length;
    out += dec.decode(value, { stream: true });
  }
  try { await rd.cancel(); } catch { /* sudah selesai */ }
  return out;
}

async function fetchOg(url) {
  try {
    const r = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(6000), headers: { "User-Agent": "Mozilla/5.0 (compatible; telisik-bot)", Accept: "text/html" } });
    if (!r.ok || !/html/i.test(r.headers.get("content-type") || "")) return "";
    return ogImage(await readLimited(r, 300000), r.url || url);
  } catch {
    return "";
  }
}

module.exports = { ogImage, fetchOg };
