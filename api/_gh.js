// Pembantu GitHub untuk /api/tarik dan /api/status (berawalan "_" supaya tidak jadi route).
// Env (diset di Vercel): GH_TOKEN (fine-grained PAT, hanya repo ini, izin Actions: read & write),
// GH_REPO ("pemilik/repo"), GH_WORKFLOW, GH_REF. Autentikasi pengguna ada di _auth.js.
const REPO = process.env.GH_REPO;
const WORKFLOW = process.env.GH_WORKFLOW || "briefing-harian.yml";
const REF = process.env.GH_REF || "main";

async function gh(path, init = {}) {
  const r = await fetch(`https://api.github.com/repos/${REPO}${path}`, {
    method: init.method || "GET",
    headers: {
      Authorization: `Bearer ${process.env.GH_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "telisik-endpoint",
      "Content-Type": "application/json",
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  if (!r.ok) throw new Error(`GitHub ${r.status}`); // isi error tidak diteruskan ke klien
  return r.status === 204 ? null : r.json();
}

module.exports = { gh, WORKFLOW, REF };
