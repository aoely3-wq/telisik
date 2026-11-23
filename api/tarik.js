// POST /api/tarik  { kategori?: ["fiskal_moneter", ...], telegram?: boolean }   (hanya admin)
// Memicu workflow GitHub Actions. Batas satu kali per 30 menit dihitung dari run manual terakhir,
// jadi tidak butuh penyimpanan sendiri.
const { gh, WORKFLOW, REF } = require("./_gh");
const { requireRole, sameOrigin } = require("./_auth");

const COOLDOWN_MS = 30 * 60 * 1000;

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "Gunakan POST" });
  if (!sameOrigin(req)) return res.status(403).json({ error: "Asal permintaan ditolak" });
  if (!(await requireRole(req, res, "admin"))) return;

  const body = req.body && typeof req.body === "object" ? req.body : {};
  // hanya kunci berpola aman yang diteruskan ke workflow; kunci tak dikenal diabaikan oleh agent
  const kategori = (Array.isArray(body.kategori) ? body.kategori : []).filter((k) => /^[\w-]{1,40}$/.test(k));
  const telegram = body.telegram === false ? "false" : "true";

  try {
    const { workflow_runs: runs = [] } = await gh(`/actions/workflows/${WORKFLOW}/runs?per_page=10`);
    if (runs.some((r) => r.status !== "completed")) {
      return res.status(409).json({ error: "Masih ada proses yang berjalan" });
    }
    const manual = runs.find((r) => r.event === "workflow_dispatch");
    const retryAt = manual ? Date.parse(manual.created_at) + COOLDOWN_MS : 0;
    if (retryAt > Date.now()) {
      return res.status(429).json({ error: "Tarik berita dibatasi sekali per 30 menit", retryAt: new Date(retryAt).toISOString() });
    }
    await gh(`/actions/workflows/${WORKFLOW}/dispatches`, {
      method: "POST",
      body: { ref: REF, inputs: { kategori: kategori.join(","), telegram } },
    });
    return res.status(202).json({ ok: true });
  } catch (e) {
    return res.status(502).json({ error: "Gagal menghubungi GitHub" });
  }
};
