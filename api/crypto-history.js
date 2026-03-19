// api/crypto-history.js — Histórico de cripto via Binance API (gratuita, sin key)
// Binance tiene velas diarias para todos los pares principales
export const config = { maxDuration: 20 };

const CACHE = new Map();
const CACHE_TTL = 60 * 60 * 1000; // 1 hora

// Mapa cgId → símbolo Binance (intenta EUR primero, fallback USDT)
const CG_TO_BINANCE = {
  'bitcoin':        { sym: 'BTCEUR',   fb: 'BTCUSDT' },
  'solana':         { sym: 'SOLEUR',   fb: 'SOLUSDT' },
  'ripple':         { sym: 'XRPEUR',   fb: 'XRPUSDT' },
  'sui':            { sym: 'SUIUSDT',  fb: 'SUIUSDT' },
  'kaspa':          { sym: 'KASUSDT',  fb: 'KASUSDT' },
  'pudgy-penguins': { sym: 'PENGUUSDT',fb: 'PENGUUSDT' },
  'pump-fun':       { sym: 'PUMPUSDT', fb: 'PUMPUSDT' },
  'linea':          { sym: 'LINEAUSDT',fb: 'LINEAUSDT' },
};

// Tipos de cambio EUR/USDT aproximados (se actualiza con cada llamada)
let EUR_RATE = 1.08; // 1 EUR ≈ 1.08 USD por defecto

async function getEurRate() {
  try {
    const r = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=EURUSDT');
    if (r.ok) { const d = await r.json(); EUR_RATE = parseFloat(d.price) || EUR_RATE; }
  } catch(e) {}
  return EUR_RATE;
}

async function fetchKlines(symbol, limit = 500) {
  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1d&limit=${limit}`;
  const r = await fetch(url, { headers: { 'Accept': 'application/json' } });
  if (!r.ok) throw new Error(`Binance ${symbol}: ${r.status}`);
  const data = await r.json();
  // Kline: [openTime, open, high, low, close, ...]
  return data.map(k => ({
    date: new Date(k[0]).toISOString().slice(0, 10),
    nav: parseFloat(k[4]), // precio de cierre
  }));
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'Falta parámetro id (cgId)' });

  const mapping = CG_TO_BINANCE[id];
  if (!mapping) return res.status(404).json({ error: `No hay mapeo Binance para: ${id}` });

  const cKey = id;
  const cached = CACHE.get(cKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return res.status(200).json(cached.data);
  }

  try {
    let history;
    const needsConversion = mapping.sym.endsWith('USDT') || mapping.fb.endsWith('USDT');

    // Intentar símbolo principal, si falla usar fallback
    try {
      history = await fetchKlines(mapping.sym, 500);
    } catch(e) {
      if (mapping.fb !== mapping.sym) {
        history = await fetchKlines(mapping.fb, 500);
      } else {
        throw e;
      }
    }

    // Si el par es USDT, convertir a EUR
    if (needsConversion && !mapping.sym.endsWith('EUR')) {
      await getEurRate();
      history = history.map(h => ({ ...h, nav: h.nav / EUR_RATE }));
    }

    const data = { history };
    CACHE.set(cKey, { ts: Date.now(), data });
    return res.status(200).json(data);

  } catch(err) {
    console.error('[crypto-history]', id, err.message);
    return res.status(500).json({ error: err.message });
  }
}
