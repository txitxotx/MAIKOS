// api/morningstar.js — Vercel Serverless Function
// performanceIds hardcodeados (Morningstar bloquea búsqueda dinámica desde servidores)

export const config = { maxDuration: 30 };

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'es-ES,es;q=0.9',
  'Referer': 'https://www.morningstar.es/',
};

// ── performanceId verificados para cada ISIN ─────────────────────────────────
// Formato ID para la API: {performanceId}]2]0]FO{PAIS}$$ALL
const ISIN_TO_PID = {
  // Renta Fija
  'ES0157640006': 'F00001AXNF',   // RF Horizonte 2027
  'ES0157639008': 'F00000Z653',   // RF Flexible A
  'ES0121776035': 'F0GBR04DNI',   // Constantfons
  // Renta Variable GVC Gaesco
  'ES0164839005': 'F00001GJDK',   // Zebra US Small Caps A
  'ES0164838007': 'F0000173VQ',   // Value Minus Growth A
  'ES0157642002': '0P0001TFN9',   // V.I.F. A
  'ES0113319034': 'F0GBR04DOJ',   // Small Caps A
  'ES0141113037': 'F0GBR06FL7',   // Japón A
  'ES0143597005': 'F00001DJ06',   // Global Equity DS A
  'ES0140628035': 'F0GBR04DOB',   // Emergentfond
  'ES0157638000': 'F00000SRXI',   // 300 Places Worldwide A
  // Fidelity
  'IE00BYX5MX67': '0P0001CLDM',   // Fidelity S&P 500 Index P-EUR
  'IE00BYX5NX33': '0P0001CLDK',   // Fidelity MSCI World Index P-EUR
  // Pictet
  'LU0625737910': '0P0000TOUY',   // Pictet China Index P EUR
  // EPSV (performanceId directo, sin ISIN estándar)
  '0P0001L8YR':   '0P0001L8YR',   // Baskepensiones RF Corto
  '0P0001L8YS':   '0P0001L8YS',   // Baskepensiones Bolsa Euro
};

// Sufijo según país de domicilio (primeras 2 letras del ISIN)
function suffix(isin) {
  const map = {
    ES: 'FOESP$$ALL', IE: 'FOIRL$$ALL', LU: 'FOLUX$$ALL',
    GB: 'FOGBR$$ALL', FR: 'FOFRA$$ALL', DE: 'FODEU$$ALL',
  };
  return map[(isin||'').slice(0,2).toUpperCase()] || 'FOESP$$ALL';
}

// Para performanceIds que empiezan por 0P (no tienen país en ISIN propio)
// usamos el ISIN del fondo para determinar el sufijo
const PID_TO_ISIN_SUFFIX = {
  '0P0001TFN9': 'FOESP$$ALL',  // VIF es español
  '0P0001CLDM': 'FOIRL$$ALL',  // Fidelity IE
  '0P0001CLDK': 'FOIRL$$ALL',  // Fidelity IE
  '0P0000TOUY': 'FOLUX$$ALL',  // Pictet LU
  '0P0001L8YR': 'FOESP$$ALL',  // EPSV español
  '0P0001L8YS': 'FOESP$$ALL',  // EPSV español
};

function buildMsId(pid, isin) {
  let sfx;
  if (PID_TO_ISIN_SUFFIX[pid]) {
    sfx = PID_TO_ISIN_SUFFIX[pid];
  } else {
    sfx = suffix(isin);
  }
  return `${pid}]2]0]${sfx}`;
}

const NAV_CACHE = new Map();

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action, isin, id, from } = req.query;

  try {
    // ── action=nav&isin=ES0157639008  ────────────────────────────────────────
    if (action === 'nav') {
      const pid = id || ISIN_TO_PID[isin];
      if (!pid) return res.status(404).json({ error: `ISIN no encontrado: ${isin}` });

      const cKey = 'nav:' + pid;
      if (NAV_CACHE.has(cKey)) {
        const c = NAV_CACHE.get(cKey);
        if (Date.now() - c.ts < 3600000) return res.json({ isin, performanceId: pid, ...c.data });
      }

      const navData = await fetchNav(pid, isin || pid);
      NAV_CACHE.set(cKey, { ts: Date.now(), data: navData });
      return res.json({ isin, performanceId: pid, ...navData });
    }

    // ── action=history&isin=ES0157639008&from=2021-01-01  ────────────────────
    if (action === 'history') {
      const pid = id || ISIN_TO_PID[isin];
      if (!pid) return res.status(404).json({ error: `ISIN no encontrado: ${isin}` });

      const history = await fetchHistory(pid, isin || pid, from || '2021-01-01');
      return res.json({ isin, performanceId: pid, history });
    }

    // ── action=resolve  (debug) ───────────────────────────────────────────────
    if (action === 'resolve') {
      const pid = ISIN_TO_PID[isin] || null;
      return res.json({ isin, performanceId: pid });
    }

    return res.status(400).json({ error: 'action inválida. Usa: nav, history, resolve' });

  } catch (err) {
    console.error('[ms-proxy]', action, isin, err.message);
    return res.status(500).json({ error: err.message });
  }
}

async function fetchNav(pid, isin) {
  const msId = buildMsId(pid, isin);
  const url = `https://tools.morningstar.co.uk/api/rest.svc/timeseries_price/t92wz0sj7c?currencyId=EUR&idtype=Morningstar&frequency=daily&outputType=COMPACTJSON&startDate=${daysAgo(10)}&endDate=${today()}&id=${encodeURIComponent(msId)}`;

  const r = await fetch(url, { headers: HEADERS });
  if (!r.ok) throw new Error(`Morningstar HTTP ${r.status}`);
  const data = await r.json();
  const series = extractSeries(data);
  if (!series?.length) throw new Error(`Sin datos para ${pid} (msId=${msId})`);

  const last = series[series.length - 1];
  const prev = series.length > 1 ? series[series.length - 2] : last;
  return {
    nav: last[1],
    change1d: prev[1] ? ((last[1] - prev[1]) / prev[1]) * 100 : 0,
    date: msToDate(last[0]),
  };
}

async function fetchHistory(pid, isin, startDate) {
  const msId = buildMsId(pid, isin);
  const url = `https://tools.morningstar.co.uk/api/rest.svc/timeseries_price/t92wz0sj7c?currencyId=EUR&idtype=Morningstar&frequency=daily&outputType=COMPACTJSON&startDate=${startDate}&endDate=${today()}&id=${encodeURIComponent(msId)}`;

  const r = await fetch(url, { headers: HEADERS });
  if (!r.ok) throw new Error(`Morningstar history HTTP ${r.status}`);
  const data = await r.json();
  const series = extractSeries(data);
  if (!series?.length) throw new Error(`Sin histórico para ${pid}`);

  return series.map(([ms, price]) => ({ date: msToDate(ms), nav: price }));
}

function extractSeries(data) {
  for (const key of Object.keys(data)) {
    const arr = data[key];
    if (Array.isArray(arr) && arr[0]?.HistoricalPrices?.length) {
      return arr[0].HistoricalPrices;
    }
  }
  return null;
}

const today = () => new Date().toISOString().slice(0, 10);
function daysAgo(n) { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); }
const msToDate = ms => new Date(ms).toISOString().slice(0, 10);
