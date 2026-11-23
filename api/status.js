// GET /api/status   (hanya admin)
// Status run terakhir: { status: queued|in_progress|completed|none, conclusion, event, created_at, updated_at }.
// UI memanggil ini tiap beberapa detik setelah /api/tarik untuk menampilkan progres.
const { gh, WORKFLOW } = require("./_gh");
const { requireRole } = require("./_auth");

module.exports = async (req, res) => {
  if (req.method !== "GET") return res.status(405).json({ error: "Gunakan GET" });
  if (!(await requireRole(req, res, "admin"))) return;
  try {
    const { workflow_runs: runs = [] } = await gh(`/actions/workflows/${WORKFLOW}/runs?per_page=1`);
    const r = runs[0];
    if (!r) return res.status(200).json({ status: "none" });
    const { status, conclusion, event, created_at, updated_at } = r;
    return res.status(200).json({ status, conclusion, event, created_at, updated_at });
  } catch (e) {
    return res.status(502).json({ error: "Gagal menghubungi GitHub" });
  }
};
