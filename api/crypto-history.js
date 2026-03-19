// api/crypto-history.js — Histórico de cripto via Kraken API (gratuita, sin key, sin geo-blocks)
export const config = { maxDuration: 20 };

const CACHE = new Map();
const CACHE_TTL = 60 * 60 * 1000; // 1 hora

// Mapa cgId → par Kraken
const CG_TO_KRAKEN = {
  'bitcoin':        { pair: 'XXBTZEUR', inEur: true },
  'solana':         { pair: 'SOLEUR',   inEur: true },
  'ripple':         { pair: 'XXRPZEUR', inEur: true },
  'sui':            { pair: 'SUIUSD',   inEur: false },
  'kaspa':          { pair: 'KASUSD',   inEur: false },
  'pudgy-penguins': { pair: 'PENGUUSD', inEur: false },
  'pump-fun':       { pair: 'PUMPUSD',  inEur: false },
  'linea':          { pair: 'LINEAUSD', inEur: false },
};

async function getEurUsdRate() {
  try {
    const r = await fetch('https://api.kraken.com/0/public/Ticker?pair=EURUSD');
    if (r.ok) {
      const d = await r.json();
      const ticker = Object.values(d.result || {})[0];
      if (ticker?.c?.[0]) return parseFloat(ticker.c[0]);
    }
  } catch(e) {}
  return 1.08;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'Falta parámetro id' });

  const mapping = CG_TO_KRAKEN[id];
  if (!mapping) return res.status(404).json({ error: `Sin mapeo para: ${id}` });

  const cached = CACHE.get(id);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return res.status(200).json(cached.data);
  }

  try {
    const since = Math.floor(Date.now() / 1000) - 365 * 2 * 24 * 3600;
    const url = `https://api.kraken.com/0/public/OHLC?pair=${mapping.pair}&interval=1440&since=${since}`;
    const r = await fetch(url, { headers: { 'Accept': 'application/json' } });

    if (!r.ok) throw new Error(`Kraken ${mapping.pair}: ${r.status}`);

    const raw = await r.json();
    if (raw.error?.length) throw new Error(raw.error[0]);

    const pairData = Object.values(raw.result || {}).find(v => Array.isArray(v));
    if (!pairData?.length) throw new Error('Sin datos Kraken');

    let eurRate = 1;
    if (!mapping.inEur) eurRate = await getEurUsdRate();

    const history = pairData.map(k => ({
      date: new Date(k[0] * 1000).toISOString().slice(0, 10),
      nav:  parseFloat(k[4]) / (mapping.inEur ? 1 : eurRate),
    }));

    const data = { history };
    CACHE.set(id, { ts: Date.now(), data });
    return res.status(200).json(data);

  } catch(err) {
    console.error('[crypto-history]', id, err.message);
    return res.status(500).json({ error: err.message });
  }
}
