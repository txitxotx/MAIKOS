// api/yahoo.js — Vercel Serverless Function
// Proxy para Yahoo Finance (evita bloqueos CORS en el navegador)
export const config = { maxDuration: 15 };

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://finance.yahoo.com/',
  'Origin': 'https://finance.yahoo.com',
};

// Cache en memoria (vive mientras el serverless esté caliente, ~15-30min)
const CACHE = new Map();
const CACHE_TTL = 15 * 60 * 1000; // 15 minutos

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=1800');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { ticker, action } = req.query;
  if (!ticker) return res.status(400).json({ error: 'ticker requerido' });

  const sym = ticker.toUpperCase();
  const act = action || 'summary'; // 'summary' | 'chart'

  const cKey = `${act}:${sym}`;
  if (CACHE.has(cKey)) {
    const c = CACHE.get(cKey);
    if (Date.now() - c.ts < CACHE_TTL) return res.json(c.data);
  }

  try {
    let result;
    if (act === 'chart') {
      result = await fetchChart(sym);
    } else {
      result = await fetchSummary(sym);
    }
    CACHE.set(cKey, { ts: Date.now(), data: result });
    return res.json(result);
  } catch (err) {
    console.error('[yahoo proxy]', sym, err.message);
    return res.status(500).json({ error: err.message });
  }
}

// ── Precio + cambio 1D desde chart ────────────────────────────
async function fetchChart(sym) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1d&range=5d`;
  const r = await fetch(url, { headers: YF_HEADERS });
  if (!r.ok) throw new Error(`Yahoo chart HTTP ${r.status}`);
  const d = await r.json();
  const q = d?.chart?.result?.[0];
  if (!q) throw new Error('Sin datos de chart');
  const closes = (q.indicators?.quote?.[0]?.close || []).filter(v => v != null);
  const price = closes[closes.length - 1];
  const prev  = closes.length > 1 ? closes[closes.length - 2] : price;
  const d1    = prev > 0 ? ((price - prev) / prev) * 100 : 0;
  return { price, d1, longName: q.meta?.longName || sym };
}

// ── Datos fundamentales desde quoteSummary ────────────────────
async function fetchSummary(sym) {
  const modules = 'summaryDetail,financialData,defaultKeyStatistics,assetProfile,price';
  const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${sym}?modules=${modules}`;
  const r = await fetch(url, { headers: YF_HEADERS });
  if (!r.ok) throw new Error(`Yahoo summary HTTP ${r.status}`);
  const root = await r.json();
  const res = root?.quoteSummary?.result?.[0];
  if (!res) throw new Error('Sin datos de summary');

  const sd = res.summaryDetail        || {};
  const fd = res.financialData        || {};
  const ks = res.defaultKeyStatistics || {};
  const ap = res.assetProfile         || {};
  const pr = res.price                || {};

  const price = pr.regularMarketPrice?.raw ?? sd.previousClose?.raw ?? null;
  const d1    = pr.regularMarketChangePercent?.raw != null
                  ? pr.regularMarketChangePercent.raw * 100 : 0;

  // PER trailing: preferimos el de summaryDetail, fallback calculado
  const trailingEps = ks.trailingEps?.raw;
  const per = sd.trailingPE?.raw
    ?? (price && trailingEps && trailingEps > 0 ? price / trailingEps : null);

  return {
    price,
    d1,
    longName:      pr.longName || pr.shortName || sym,
    per:           per,
    forwardPer:    sd.forwardPE?.raw ?? null,
    peg:           ks.pegRatio?.raw ?? null,
    pb:            ks.priceToBook?.raw ?? null,
    ps:            ks.priceToSalesTrailing12Months?.raw ?? null,
    evEbitda:      ks.enterpriseToEbitda?.raw ?? null,
    divYield:      sd.dividendYield?.raw != null ? sd.dividendYield.raw * 100 : null,
    profitMargin:  fd.profitMargins?.raw != null ? fd.profitMargins.raw * 100 : null,
    roe:           fd.returnOnEquity?.raw != null ? fd.returnOnEquity.raw * 100 : null,
    debtEq:        fd.debtToEquity?.raw != null ? fd.debtToEquity.raw / 100 : null,
    low52:         sd['fiftyTwoWeekLow']?.raw ?? null,
    high52:        sd['fiftyTwoWeekHigh']?.raw ?? null,
    mktCap:        pr.marketCap?.raw ?? ks.marketCap?.raw ?? null,
    beta:          sd.beta?.raw ?? null,
    sector:        ap.sector ?? null,
    industry:      ap.industry ?? null,
    summary:       ap.longBusinessSummary
                     ? ap.longBusinessSummary.slice(0, 260) + '…'
                     : null,
  };
}
