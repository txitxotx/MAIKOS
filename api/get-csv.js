// api/get-csv.js — Lee portfolio.csv directamente desde GitHub (siempre fresco)
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
    const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/portfolio.csv?ref=${GITHUB_BRANCH}`;
    const r = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });

    if (!r.ok) {
      if (r.status === 404) return res.status(404).json({ error: 'portfolio.csv no encontrado' });
      throw new Error(`GitHub API ${r.status}`);
    }

    const data = await r.json();
    const content = Buffer.from(data.content, 'base64').toString('utf-8');
    return res.status(200).send(content);

  } catch(err) {
    console.error('[get-csv]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
