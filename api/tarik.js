// POST /api/tarik   (hanya admin)  ->  { state: "dimulai" | "sudah-berjalan" | "bangun" }
// Memicu bot di Render lewat POST /cron (header X-Cron-Secret). Bot menjalankan briefing penuh dan mengirimnya ke admin di Telegram,
// lalu menambah baris ke Sheet. Env: BOT_URL (mis. https://briefing-babel-bot.onrender.com) dan CRON_SECRET (harus sama dengan di Render).
// "bangun" = server gratis Render sedang tidur; UI mengulang permintaan sampai server menjawab.
const { requireRole, sameOrigin } = require("./_auth");

const COOLDOWN_MS = 30 * 60 * 1000;
// shortcut: batas 30 menit dihitung per instance (memori), jadi tidak mutlak. Batas yang tegas ada di bot:
// isi USER_DAILY_RUNS dan GLOBAL_DAILY_RUNS di Render, dan bot menolak run bertumpuk lewat "sudah-berjalan".
let lastStart = 0;

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Gunakan POST" });
  if (!sameOrigin(req)) return res.status(403).json({ error: "Asal permintaan ditolak" });
  if (!(await requireRole(req, res, "admin"))) return;
  const base = (process.env.BOT_URL || "").replace(/\/+$/, "");
  const secret = process.env.CRON_SECRET;
  if (!base || !secret) return res.status(503).json({ error: "BOT_URL atau CRON_SECRET belum diisi di server" });
  if (Date.now() - lastStart < COOLDOWN_MS) {
    return res.status(429).json({ error: "Tarik berita dibatasi sekali per 30 menit", retryAt: new Date(lastStart + COOLDOWN_MS).toISOString() });
  }
  try {
    const r = await fetch(`${base}/cron`, { method: "POST", headers: { "X-Cron-Secret": secret }, signal: AbortSignal.timeout(8000) });
    const body = (await r.text()).trim();
    if (r.status === 202) {
      if (body === "dimulai") lastStart = Date.now();
      return res.status(202).json({ state: body === "sudah-berjalan" ? "sudah-berjalan" : "dimulai" });
    }
    if (r.status === 403 || r.status === 404) {
      return res.status(502).json({ error: "Bot menolak pemicu: samakan CRON_SECRET dengan Render (di Render CRON_SECRET harus terisi, minimal 16 karakter)" });
    }
    return res.status(202).json({ state: "bangun" }); // 5xx dari proxy Render saat server masih bangun
  } catch (e) {
    return res.status(202).json({ state: "bangun" }); // timeout: server tidur
  }
};
