// api/morningstar.js — Vercel Serverless Function
// Endpoint REAL: tools.morningstar.co.uk (verificado y funcional)
// Formato ID: {performanceId}]2]0]FO{COUNTRY}$$ALL

export const config = { maxDuration: 30 };

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'es-ES,es;q=0.9',
  'Referer': 'https://www.morningstar.es/',
};

const PID_CACHE = new Map();
const NAV_CACHE = new Map();

function msCountrySuffix(isin) {
  const map = { ES:'FOESP$$ALL', IE:'FOIRL$$ALL', LU:'FOLUX$$ALL', GB:'FOGBR$$ALL', FR:'FOFRA$$ALL', DE:'FODEU$$ALL', US:'FOUSA$$ALL' };
  return map[(isin||'').slice(0,2).toUpperCase()] || 'FOGBR$$ALL';
}

function buildMsId(pid, isin) {
  return `${pid}]2]0]${msCountrySuffix(isin)}`;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action, isin, id, from } = req.query;

  try {
    if (action === 'nav') {
      const pid = id || await resolvePerformanceId(isin || '');
      if (!pid) return res.status(404).json({ error: `No performanceId para: ${isin}` });
      const cKey = 'nav:' + pid;
      if (NAV_CACHE.has(cKey)) {
        const c = NAV_CACHE.get(cKey);
        if (Date.now() - c.ts < 3600000) return res.json({ isin, pid, ...c.data });
      }
      const navData = await fetchNav(pid, isin || '');
      NAV_CACHE.set(cKey, { ts: Date.now(), data: navData });
      return res.json({ isin, performanceId: pid, ...navData });
    }

    if (action === 'history') {
      const pid = id || await resolvePerformanceId(isin || '');
      if (!pid) return res.status(404).json({ error: `No performanceId para: ${isin}` });
      const history = await fetchHistory(pid, isin || '', from || '2021-01-01');
      return res.json({ isin, performanceId: pid, history });
    }

    if (action === 'resolve') {
      const pid = await resolvePerformanceId(isin || '');
      return res.json({ isin, performanceId: pid });
    }

    return res.status(400).json({ error: 'action inválida. Usa: nav, history, resolve' });
  } catch (err) {
    console.error('[ms-proxy]', err.message);
    return res.status(500).json({ error: err.message });
  }
}

async function resolvePerformanceId(isin) {
  if (!isin) return null;
  if (PID_CACHE.has(isin)) return PID_CACHE.get(isin);
  // Si ya es un performanceId directo (0P... o F0...)
  if (/^(0P|F0)/i.test(isin) && isin.length <= 12) { PID_CACHE.set(isin, isin); return isin; }

  // Búsqueda en Morningstar.es SecuritySearch
  try {
    const r = await fetch(`https://www.morningstar.es/es/util/SecuritySearch.ashx?moduleId=6&SearchTerm=${encodeURIComponent(isin)}&ifIncludeAds=False&usrtType=v&langId=es-ES&Site=es`, { headers: HEADERS });
    const text = await r.text();
    if (text && text.trim().length > 2 && text.trim() !== '[]') {
      const results = JSON.parse(text.trim());
      if (Array.isArray(results) && results.length > 0) {
        const pid = results[0].i || results[0].id || results[0].secId;
        if (pid) { PID_CACHE.set(isin, pid); return pid; }
      }
    }
  } catch(e) { console.warn('[resolve search]', e.message); }

  // Fallback: página snapshot con redirect
  try {
    const r2 = await fetch(`https://www.morningstar.es/es/funds/snapshot/snapshot.aspx?isin=${isin}`, { headers: HEADERS, redirect: 'follow' });
    const finalUrl = r2.url;
    const m = finalUrl.match(/[?&]id=([F0][0-9A-Za-z]{8,12})/i);
    if (m) { PID_CACHE.set(isin, m[1]); return m[1]; }
    const html = await r2.text();
    const hm = html.match(/[?&]id=([F0][0-9A-Za-z]{8,12})/i);
    if (hm) { PID_CACHE.set(isin, hm[1]); return hm[1]; }
  } catch(e) { console.warn('[resolve snap]', e.message); }

  return null;
}

async function fetchNav(pid, isin) {
  const msId = encodeURIComponent(buildMsId(pid, isin));
  const url = `https://tools.morningstar.co.uk/api/rest.svc/timeseries_price/t92wz0sj7c?currencyId=EUR&idtype=Morningstar&frequency=daily&outputType=COMPACTJSON&startDate=${daysAgo(10)}&endDate=${today()}&id=${msId}`;
  const r = await fetch(url, { headers: HEADERS });
  if (!r.ok) throw new Error(`MS HTTP ${r.status}`);
  const data = await r.json();
  const series = extractSeries(data);
  if (!series?.length) throw new Error(`Sin datos NAV para ${pid}`);
  const last = series[series.length - 1];
  const prev = series.length > 1 ? series[series.length - 2] : last;
  return { nav: last[1], change1d: prev[1] ? ((last[1]-prev[1])/prev[1])*100 : 0, date: msToDate(last[0]) };
}

async function fetchHistory(pid, isin, startDate) {
  const msId = encodeURIComponent(buildMsId(pid, isin));
  const url = `https://tools.morningstar.co.uk/api/rest.svc/timeseries_price/t92wz0sj7c?currencyId=EUR&idtype=Morningstar&frequency=daily&outputType=COMPACTJSON&startDate=${startDate}&endDate=${today()}&id=${msId}`;
  const r = await fetch(url, { headers: HEADERS });
  if (!r.ok) throw new Error(`MS history HTTP ${r.status}`);
  const data = await r.json();
  const series = extractSeries(data);
  if (!series?.length) throw new Error(`Sin histórico para ${pid}`);
  return series.map(([ms, price]) => ({ date: msToDate(ms), nav: price }));
}

function extractSeries(data) {
  for (const key of Object.keys(data)) {
    const arr = data[key];
    if (Array.isArray(arr) && arr[0]?.HistoricalPrices?.length) return arr[0].HistoricalPrices;
  }
  return null;
}

const today = () => new Date().toISOString().slice(0,10);
function daysAgo(n) { const d=new Date(); d.setDate(d.getDate()-n); return d.toISOString().slice(0,10); }
const msToDate = ms => new Date(ms).toISOString().slice(0,10);
