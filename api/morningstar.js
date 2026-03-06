// api/morningstar.js — Vercel Serverless Function
// ID formato: {performanceId}]2]0]FO{PAIS}$$ALL — NO encodeURIComponent

export const config = { maxDuration: 30 };

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'es-ES,es;q=0.9',
  'Referer': 'https://www.morningstar.es/',
};

// performanceId + sufijo de país por ISIN
const FUNDS = {
  'ES0157640006': { pid: 'F00001AXNF', sfx: 'FOESP$$ALL' }, // RF Horizonte 2027
  'ES0157639008': { pid: 'F00000Z653',  sfx: 'FOESP$$ALL' }, // RF Flexible A
  'ES0121776035': { pid: 'F0GBR04DNI', sfx: 'FOESP$$ALL' }, // Constantfons
  'ES0164839005': { pid: 'F00001GJDK', sfx: 'FOESP$$ALL' }, // Zebra US Small Caps A
  'ES0164838007': { pid: 'F0000173VQ', sfx: 'FOESP$$ALL' }, // Value Minus Growth A
  'ES0157642002': { pid: '0P0001TFN9', sfx: 'FOESP$$ALL' }, // V.I.F. A
  'ES0113319034': { pid: 'F0GBR04DOJ', sfx: 'FOESP$$ALL' }, // Small Caps A
  'ES0141113037': { pid: 'F0GBR06FL7', sfx: 'FOESP$$ALL' }, // Japón A
  'ES0143597005': { pid: 'F00001DJ06', sfx: 'FOESP$$ALL' }, // Global Equity DS A
  'ES0140628035': { pid: 'F0GBR04DOB', sfx: 'FOESP$$ALL' }, // Emergentfond
  'ES0157638000': { pid: 'F00000SRXI', sfx: 'FOESP$$ALL' }, // 300 Places Worldwide A
  'LU0625737910': { pid: '0P0000TOUY', sfx: 'FOLUX$$ALL' }, // Pictet China Index P EUR
  'IE00BYX5MX67': { pid: '0P0001CLDM', sfx: 'FOIRL$$ALL' }, // Fidelity S&P 500 P-EUR
  'IE00BYX5NX33': { pid: '0P0001CLDK', sfx: 'FOIRL$$ALL' }, // Fidelity MSCI World P-EUR
  '0P0001L8YR':   { pid: '0P0001L8YR', sfx: 'FOESP$$ALL' }, // Baskepensiones RF Corto
  '0P0001L8YS':   { pid: '0P0001L8YS', sfx: 'FOESP$$ALL' }, // Baskepensiones Bolsa Euro
};

const NAV_CACHE = new Map();

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action, isin, from } = req.query;

  try {
    if (action === 'nav') {
      const fund = FUNDS[isin];
      if (!fund) return res.status(404).json({ error: `ISIN no mapeado: ${isin}` });

      const cKey = 'nav:' + fund.pid;
      if (NAV_CACHE.has(cKey)) {
        const c = NAV_CACHE.get(cKey);
        if (Date.now() - c.ts < 3600000) return res.json({ isin, ...c.data });
      }

      const navData = await fetchMs(fund.pid, fund.sfx, daysAgo(10), today());
      NAV_CACHE.set(cKey, { ts: Date.now(), data: navData });
      return res.json({ isin, performanceId: fund.pid, ...navData });
    }

    if (action === 'history') {
      const fund = FUNDS[isin];
      if (!fund) return res.status(404).json({ error: `ISIN no mapeado: ${isin}` });
      const history = await fetchMs(fund.pid, fund.sfx, from || '2021-01-01', today(), true);
      return res.json({ isin, performanceId: fund.pid, history });
    }

    if (action === 'resolve') {
      const fund = FUNDS[isin];
      return res.json({ isin, performanceId: fund?.pid || null, sfx: fund?.sfx || null });
    }

    return res.status(400).json({ error: 'action inválida. Usa: nav, history, resolve' });

  } catch (err) {
    console.error('[ms-proxy]', action, isin, err.message);
    return res.status(500).json({ error: err.message });
  }
}

async function fetchMs(pid, sfx, startDate, endDate, returnHistory = false) {
  // El ID debe ir SIN encodeURIComponent — los ] y $ van literales en la query string
  const msId = `${pid}]2]0]${sfx}`;
  const url = `https://tools.morningstar.co.uk/api/rest.svc/timeseries_price/t92wz0sj7c?currencyId=EUR&idtype=Morningstar&frequency=daily&outputType=COMPACTJSON&startDate=${startDate}&endDate=${endDate}&id=${msId}`;

  const r = await fetch(url, { headers: HEADERS });
  if (!r.ok) throw new Error(`Morningstar HTTP ${r.status}`);
  const data = await r.json();

  // La respuesta es un array plano: [[timestamp_ms, precio], ...]
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error(`Sin datos para ${pid} (${sfx})`);
  }

  if (returnHistory) {
    return data.map(([ms, price]) => ({ date: msToDate(ms), nav: price }));
  }

  const last = data[data.length - 1];
  const prev = data.length > 1 ? data[data.length - 2] : last;
  return {
    nav: last[1],
    change1d: prev[1] ? ((last[1] - prev[1]) / prev[1]) * 100 : 0,
    date: msToDate(last[0]),
  };
}

const today = () => new Date().toISOString().slice(0, 10);
function daysAgo(n) { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); }
const msToDate = ms => new Date(ms).toISOString().slice(0, 10);
