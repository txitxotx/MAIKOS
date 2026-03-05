// api/morningstar.js — Vercel Serverless Function
// Endpoint: tools.morningstar.co.uk — ID simple sin sufijos

export const config = { maxDuration: 30 };

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'es-ES,es;q=0.9',
  'Referer': 'https://www.morningstar.es/',
};

// performanceId por ISIN — ID simple, sin sufijos
const ISIN_TO_PID = {
  'ES0157640006': 'F00001AXNF',  // RF Horizonte 2027
  'ES0157639008': 'F00000Z653',  // RF Flexible A
  'ES0121776035': 'F0GBR04DNI',  // Constantfons
  'ES0164839005': 'F00001GJDK',  // Zebra US Small Caps A
  'ES0164838007': 'F0000173VQ',  // Value Minus Growth A
  'ES0157642002': '0P0001TFN9',  // V.I.F. A
  'ES0113319034': 'F0GBR04DOJ',  // Small Caps A
  'ES0141113037': 'F0GBR06FL7',  // Japón A
  'ES0143597005': 'F00001DJ06',  // Global Equity DS A
  'ES0140628035': 'F0GBR04DOB',  // Emergentfond
  'ES0157638000': 'F00000SRXI',  // 300 Places Worldwide A
  'LU0625737910': '0P0000TOUY',  // Pictet China Index P EUR
  'IE00BYX5MX67': '0P0001CLDM',  // Fidelity S&P 500 Index P-EUR
  'IE00BYX5NX33': '0P0001CLDK',  // Fidelity MSCI World Index P-EUR
  '0P0001L8YR':   '0P0001L8YR',  // Baskepensiones RF Corto (EPSV)
  '0P0001L8YS':   '0P0001L8YS',  // Baskepensiones Bolsa Euro (EPSV)
};

const NAV_CACHE = new Map();

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action, isin, id, from } = req.query;

  try {
    if (action === 'nav') {
      const pid = id || ISIN_TO_PID[isin];
      if (!pid) return res.status(404).json({ error: `ISIN no mapeado: ${isin}` });

      const cKey = 'nav:' + pid;
      if (NAV_CACHE.has(cKey)) {
        const c = NAV_CACHE.get(cKey);
        if (Date.now() - c.ts < 3600000) return res.json({ isin, performanceId: pid, ...c.data });
      }

      const navData = await fetchNav(pid);
      NAV_CACHE.set(cKey, { ts: Date.now(), data: navData });
      return res.json({ isin, performanceId: pid, ...navData });
    }

    if (action === 'history') {
      const pid = id || ISIN_TO_PID[isin];
      if (!pid) return res.status(404).json({ error: `ISIN no mapeado: ${isin}` });
      const history = await fetchHistory(pid, from || '2021-01-01');
      return res.json({ isin, performanceId: pid, history });
    }

    if (action === 'resolve') {
      return res.json({ isin, performanceId: ISIN_TO_PID[isin] || null });
    }

    return res.status(400).json({ error: 'action inválida. Usa: nav, history, resolve' });

  } catch (err) {
    console.error('[ms-proxy]', action, isin, err.message);
    return res.status(500).json({ error: err.message });
  }
}

async function fetchNav(pid) {
  const url = `https://tools.morningstar.co.uk/api/rest.svc/timeseries_price/t92wz0sj7c?currencyId=EUR&idtype=Morningstar&frequency=daily&outputType=COMPACTJSON&startDate=${daysAgo(10)}&endDate=${today()}&id=${pid}`;
  const r = await fetch(url, { headers: HEADERS });
  if (!r.ok) throw new Error(`Morningstar HTTP ${r.status}`);
  const data = await r.json();

  // Respuesta: [[timestamp_ms, price], ...]  (array plano)
  if (Array.isArray(data) && data.length > 0) {
    const last = data[data.length - 1];
    const prev = data.length > 1 ? data[data.length - 2] : last;
    return {
      nav: last[1],
      change1d: prev[1] ? ((last[1] - prev[1]) / prev[1]) * 100 : 0,
      date: msToDate(last[0]),
    };
  }

  // Respuesta alternativa: objeto con clave = pid
  const series = extractSeries(data);
  if (series?.length) {
    const last = series[series.length - 1];
    const prev = series.length > 1 ? series[series.length - 2] : last;
    return {
      nav: last[1],
      change1d: prev[1] ? ((last[1] - prev[1]) / prev[1]) * 100 : 0,
      date: msToDate(last[0]),
    };
  }

  throw new Error(`Sin datos NAV para ${pid}`);
}

async function fetchHistory(pid, startDate) {
  const url = `https://tools.morningstar.co.uk/api/rest.svc/timeseries_price/t92wz0sj7c?currencyId=EUR&idtype=Morningstar&frequency=daily&outputType=COMPACTJSON&startDate=${startDate}&endDate=${today()}&id=${pid}`;
  const r = await fetch(url, { headers: HEADERS });
  if (!r.ok) throw new Error(`Morningstar history HTTP ${r.status}`);
  const data = await r.json();

  // Array plano [[ms, price], ...]
  if (Array.isArray(data) && data.length > 0) {
    return data.map(([ms, price]) => ({ date: msToDate(ms), nav: price }));
  }

  // Objeto con clave
  const series = extractSeries(data);
  if (series?.length) {
    return series.map(([ms, price]) => ({ date: msToDate(ms), nav: price }));
  }

  throw new Error(`Sin histórico para ${pid}`);
}

function extractSeries(data) {
  if (!data || typeof data !== 'object') return null;
  for (const key of Object.keys(data)) {
    const arr = data[key];
    if (Array.isArray(arr) && arr[0]?.HistoricalPrices?.length) return arr[0].HistoricalPrices;
    if (Array.isArray(arr) && Array.isArray(arr[0])) return arr; // ya es array de arrays
  }
  return null;
}

const today = () => new Date().toISOString().slice(0, 10);
function daysAgo(n) { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); }
const msToDate = ms => new Date(ms).toISOString().slice(0, 10);
