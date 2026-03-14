// api/get-txn.js — Lee transacciones.json directamente desde GitHub (siempre fresco)
export const config = { maxDuration: 15 };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { GITHUB_TOKEN, GITHUB_REPO, GITHUB_BRANCH = 'main' } = process.env;

  if (!GITHUB_TOKEN || !GITHUB_REPO) {
    return res.status(500).json({ error: 'Faltan variables GITHUB_TOKEN / GITHUB_REPO' });
  }

  try {
    const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/transacciones.json?ref=${GITHUB_BRANCH}`;
    const r = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });

    if (!r.ok) {
      if (r.status === 404) return res.status(404).json({ error: 'transacciones.json no encontrado en el repo' });
      throw new Error(`GitHub API ${r.status}`);
    }

    const data = await r.json();
    // El contenido viene en base64
    const content = Buffer.from(data.content, 'base64').toString('utf-8');
    const json = JSON.parse(content);

    return res.status(200).json(json);

  } catch(err) {
    console.error('[get-txn]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
