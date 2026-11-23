// GET /api/me  ->  { username, role } untuk sesi yang sedang masuk, atau 401
const { requireRole } = require("./_auth");

module.exports = async (req, res) => {
  if (req.method !== "GET") return res.status(405).json({ error: "Gunakan GET" });
  const user = await requireRole(req, res, "user");
  if (!user) return;
  res.setHeader("Cache-Control", "no-store");
  return res.status(200).json({ username: user.u, role: user.role });
};
