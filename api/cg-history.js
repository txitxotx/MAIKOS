// api/cg-history.js — Proxy para histórico de CoinGecko
// Evita el rate limiting que ocurre al llamar directamente desde el navegador
export const config = { maxDuration: 20 };

const CACHE = new Map();
const CACHE_TTL = 60 * 60 * 1000; // 1 hora

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { id, days = '1460' } = req.query;
  if (!id) return res.status(400).json({ error: 'Falta el parámetro id' });

  // Caché en memoria para no saturar CoinGecko
  const cKey = `${id}:${days}`;
  const cached = CACHE.get(cKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return res.status(200).json(cached.data);
  }

  try {
    const url = `https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=eur&days=${days}&interval=daily`;
    const r = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0',
      },
    });

    if (!r.ok) {
      const msg = r.status === 429 ? 'Rate limit de CoinGecko alcanzado, intenta en unos minutos' : `CoinGecko error ${r.status}`;
      return res.status(r.status).json({ error: msg });
    }

    const raw = await r.json();
    const history = (raw.prices || []).map(([ms, p]) => ({
      date: new Date(ms).toISOString().slice(0, 10),
      nav: p,
    }));

    const data = { history };
    CACHE.set(cKey, { ts: Date.now(), data });
    return res.status(200).json(data);

  } catch(err) {
    console.error('[cg-history]', id, err.message);
    return res.status(500).json({ error: err.message });
  }
}
