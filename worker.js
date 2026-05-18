// ============================================================
// Net Worth Tracker — Cloudflare Worker v1.4.0
// Deploy: dash.cloudflare.com → Workers → Edit Code
// Endpoints: / | /price | /fx | /gold | /crumb-test | /stats
// Cron: nightly sector auto-fill for unknown tickers
// ============================================================

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// ── Crumb cache (in-memory, resets on cold start) ────────────
let cachedCrumb = null, cachedCookie = null, crumbFetchedAt = 0;
const CRUMB_TTL = 55 * 60 * 1000;

async function getCrumb() {
  const now = Date.now();
  if (cachedCrumb && cachedCookie && (now - crumbFetchedAt) < CRUMB_TTL) {
    return { crumb: cachedCrumb, cookie: cachedCookie };
  }
  const pageRes = await fetch('https://finance.yahoo.com/quote/AAPL', {
    headers: { 'User-Agent': UA, 'Accept': 'text/html', 'Accept-Language': 'en-US,en;q=0.9' },
    redirect: 'follow',
  });
  const cookie = (pageRes.headers.get('set-cookie') || '')
    .split(',').map(c => c.split(';')[0].trim()).join('; ');
  const crumbRes = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', {
    headers: { 'User-Agent': UA, 'Cookie': cookie },
  });
  const crumb = (await crumbRes.text()).trim();
  if (!crumb || crumb.includes('<!DOCTYPE')) throw new Error('Failed to get crumb');
  cachedCrumb = crumb; cachedCookie = cookie; crumbFetchedAt = now;
  return { crumb, cookie };
}

// ── Fetch raw chart data ──────────────────────────────────────
async function fetchChart(symbol, range, interval, events, crumb, cookie) {
  let url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}&crumb=${encodeURIComponent(crumb)}`;
  if (events) url += `&events=${events}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, 'Cookie': cookie, 'Accept': 'application/json' },
  });
  if (!res.ok) throw new Error(`Yahoo ${res.status} for ${symbol}`);
  const data = await res.json();
  const result = data?.chart?.result?.[0];
  if (!result) throw new Error(`No result for ${symbol}`);
  return result;
}

// ── IDX sector fallback map (Yahoo assetProfile unreliable for .JK) ──
const IDX_SECTORS = {
  // Banking / Finance
  BBCA:'Financial Services', BBRI:'Financial Services', BMRI:'Financial Services',
  BNGA:'Financial Services', BJBR:'Financial Services', BJTM:'Financial Services',
  BTPS:'Financial Services', BBTN:'Financial Services', NISP:'Financial Services',
  PNBN:'Financial Services', MEGA:'Financial Services', ARTO:'Financial Services',
  BRIS:'Financial Services', BBNI:'Financial Services',
  // Telco / Media
  TLKM:'Communication Services', EXCL:'Communication Services', ISAT:'Communication Services',
  FREN:'Communication Services', MNCN:'Communication Services', SCMA:'Communication Services',
  // Consumer Staples
  UNVR:'Consumer Staples', ICBP:'Consumer Staples', INDF:'Consumer Staples',
  HMSP:'Consumer Staples', GGRM:'Consumer Staples', CPIN:'Consumer Staples',
  JPFA:'Consumer Staples', AALI:'Consumer Staples', LSIP:'Consumer Staples',
  SIMP:'Consumer Staples', SIDO:'Consumer Staples', MYOR:'Consumer Staples',
  // Consumer Discretionary
  ASII:'Consumer Discretionary', ACES:'Consumer Discretionary', MAPI:'Consumer Discretionary',
  LPPF:'Consumer Discretionary', ERAA:'Consumer Discretionary',
  // Energy / Mining
  ADRO:'Energy', PTBA:'Energy', BYAN:'Energy', ITMG:'Energy',
  PGAS:'Energy', AKRA:'Energy', MEDC:'Energy',
  // Basic Materials
  ANTM:'Basic Materials', INCO:'Basic Materials', TINS:'Basic Materials',
  MDKA:'Basic Materials', SMGR:'Basic Materials', INTP:'Basic Materials',
  AMRT:'Basic Materials',
  // Industrials
  JSMR:'Industrials', WSKT:'Industrials', WIKA:'Industrials', ADHI:'Industrials',
  UNTR:'Industrials', SMDR:'Industrials', BIRD:'Industrials',
  // Healthcare
  KLBF:'Healthcare', KAEF:'Healthcare', MIKA:'Healthcare', PRDA:'Healthcare',
  // Real Estate
  BSDE:'Real Estate', SMRA:'Real Estate', CTRA:'Real Estate', PWON:'Real Estate',
  DMAS:'Real Estate', LPKR:'Real Estate',
  // Technology
  GOTO:'Technology', BUKA:'Technology', EMTK:'Technology', DMMX:'Technology',
};

// ── US sector fallback map ────────────────────────────────────
const US_SECTORS = {
  // Technology
  AAPL:'Technology', MSFT:'Technology', NVDA:'Technology', AMD:'Technology',
  INTC:'Technology', AVGO:'Technology', QCOM:'Technology', TXN:'Technology',
  MU:'Technology', AMAT:'Technology', LRCX:'Technology', KLAC:'Technology',
  ORCL:'Technology', CRM:'Technology', ADBE:'Technology', NOW:'Technology',
  SNOW:'Technology', PLTR:'Technology', CRWD:'Technology', PANW:'Technology',
  MRVL:'Technology', ASML:'Technology', TSM:'Technology', ARM:'Technology',
  // Communication Services
  GOOGL:'Communication Services', GOOG:'Communication Services',
  META:'Communication Services', NFLX:'Communication Services',
  DIS:'Communication Services', CMCSA:'Communication Services',
  T:'Communication Services', VZ:'Communication Services',
  SPOT:'Communication Services', SNAP:'Communication Services',
  // Consumer Discretionary
  AMZN:'Consumer Discretionary', TSLA:'Consumer Discretionary',
  NKE:'Consumer Discretionary', MCD:'Consumer Discretionary',
  SBUX:'Consumer Discretionary', HD:'Consumer Discretionary',
  LOW:'Consumer Discretionary', TGT:'Consumer Discretionary',
  BKNG:'Consumer Discretionary', ABNB:'Consumer Discretionary',
  // Consumer Staples
  WMT:'Consumer Staples', COST:'Consumer Staples', PG:'Consumer Staples',
  KO:'Consumer Staples', PEP:'Consumer Staples', PM:'Consumer Staples',
  // Financial Services
  'BRK-B':'Financial Services', JPM:'Financial Services', BAC:'Financial Services',
  GS:'Financial Services', MS:'Financial Services', V:'Financial Services',
  MA:'Financial Services', PYPL:'Financial Services', AXP:'Financial Services',
  // Healthcare
  JNJ:'Healthcare', PFE:'Healthcare', MRK:'Healthcare', ABBV:'Healthcare',
  LLY:'Healthcare', UNH:'Healthcare', TMO:'Healthcare', ABT:'Healthcare',
  // Energy
  XOM:'Energy', CVX:'Energy', COP:'Energy', SLB:'Energy',
  // Industrials
  CAT:'Industrials', BA:'Industrials', GE:'Industrials', HON:'Industrials',
  UPS:'Industrials', FDX:'Industrials', DE:'Industrials',
  // Real Estate
  AMT:'Real Estate', PLD:'Real Estate', EQIX:'Real Estate',
  // Industrials (Defense)
  RTX:'Industrials', LMT:'Industrials', NOC:'Industrials', GD:'Industrials',
  // ETF / Commodities
  SPY:'ETF', QQQ:'ETF', VTI:'ETF', IWM:'ETF', VOO:'ETF',
  GLD:'Commodities', SLV:'Commodities', IAU:'Commodities', GDX:'Commodities',
  USO:'Commodities', UNG:'Commodities',
};

// ── Fetch sector/industry via quoteSummary ────────────────────
async function fetchSector(symbol, crumb, cookie, env) {
  // 1. IDX: hardcoded map (Yahoo unreliable for .JK)
  if (symbol.endsWith('.JK')) {
    const base = symbol.replace('.JK', '');
    if (IDX_SECTORS[base]) return { sector: IDX_SECTORS[base], industry: null };
  } else {
    // 2. US: hardcoded map
    if (US_SECTORS[symbol]) return { sector: US_SECTORS[symbol], industry: null };
  }
  // 3. KV cache — previously auto-fetched sectors
  if (env?.TICKER_STATS) {
    try {
      const cached = await env.TICKER_STATS.get(`sector:${symbol}`);
      if (cached) return { sector: cached, industry: null };
    } catch { /* ignore */ }
  }
  // 4. Yahoo Finance assetProfile — last resort, cache result in KV
  try {
    const url = `https://query1.finance.yahoo.com/v11/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=assetProfile&crumb=${encodeURIComponent(crumb)}`;
    const res = await fetch(url, { headers: { 'User-Agent': UA, 'Cookie': cookie, 'Accept': 'application/json' } });
    const data = await res.json();
    const profile = data?.quoteSummary?.result?.[0]?.assetProfile;
    const sector = profile?.sector || null;
    const industry = profile?.industry || null;
    // Store in KV so we never hit Yahoo for this ticker again (90-day TTL)
    if (sector && env?.TICKER_STATS) {
      try { await env.TICKER_STATS.put(`sector:${symbol}`, sector, { expirationTtl: 60 * 60 * 24 * 90 }); } catch { /* ignore */ }
    }
    return { sector, industry };
  } catch { return { sector: null, industry: null }; }
}

// ── Parse dividends by calendar year ─────────────────────────
function parseDivsByYear(dividendEvents) {
  const byYear = {};
  for (const d of Object.values(dividendEvents || {})) {
    const yr = new Date(d.date * 1000).getFullYear();
    byYear[yr] = (byYear[yr] || 0) + d.amount;
  }
  return byYear;
}

// ── Full stock quote: price + dividends + sector ──────────────
async function fetchStock(sym, env) {
  const { crumb, cookie } = await getCrumb();

  // Frontend already sends correct format: BBCA.JK for IDX, AAPL for US
  // Just trust the ticker as-is — no character-count guessing
  const ticker = sym.toUpperCase();
  const market = ticker.endsWith('.JK') ? 'IDX' : 'US';

  // Fetch price + 2yr dividend history in one call
  const result = await fetchChart(ticker, '2y', '1d', 'dividends', crumb, cookie);
  const meta   = result.meta;
  const price  = meta.regularMarketPrice;
  const currency = meta.currency;

  // Use actual closes array for previous close — meta.chartPreviousClose can be
  // unreliable for ETFs/commodities on a 2-year range chart
  const closes    = result?.indicators?.quote?.[0]?.close?.filter(v => v != null) || [];
  const prevClose = closes.length >= 2 ? closes[closes.length - 2] : null;
  const changePercent = (price && prevClose)
    ? ((price - prevClose) / prevClose * 100)
    : null;

  // Dividend calc
  const divEvents = result?.events?.dividends || {};
  const byYear    = parseDivsByYear(divEvents);
  const thisYear  = new Date().getFullYear();
  const curYrDiv  = byYear[thisYear]  || 0;
  const lastYrDiv = byYear[thisYear-1] || 0;

  const divPerShareThis = curYrDiv  || null;
  const divPerShareLast = lastYrDiv || null;
  const divSource       = curYrDiv ? 'thisYear' : (lastYrDiv ? 'lastYear' : null);
  const ttmDiv          = curYrDiv || lastYrDiv || 0;
  const divYieldTTM     = price && ttmDiv  ? (ttmDiv  / price) * 100 : null;
  const divYieldLast    = price && lastYrDiv ? (lastYrDiv / price) * 100 : null;

  // Sector — checks hardcoded map → KV cache → Yahoo (auto-caches result)
  const { sector, industry } = await fetchSector(ticker, crumb, cookie, env);

  return { symbol: sym, ticker, market, price, currency, changePercent,
    divYieldTTM, divYieldLast, divPerShareThis, divPerShareLast, divSource,
    sector, industry };
}

// ── FX rates → IDR ───────────────────────────────────────────
async function fetchFXRates() {
  const { crumb, cookie } = await getCrumb();
  const pairs = ['USD','SGD','JPY','CNY','EUR','MYR'];
  const results = {};
  await Promise.all(pairs.map(async base => {
    try {
      const result = await fetchChart(`${base}IDR=X`, '5d', '1d', null, crumb, cookie);
      const meta = result.meta;
      const closes = result?.indicators?.quote?.[0]?.close?.filter(Boolean) || [];
      const prev   = closes.length >= 2 ? closes[closes.length-2] : null;
      const cur    = meta.regularMarketPrice;
      const change24h = (prev && cur) ? ((cur - prev) / prev * 100) : null;
      results[base] = { rateToIDR: cur, change24h };
    } catch { results[base] = { rateToIDR: null, change24h: null }; }
  }));
  return { rates: results };
}

// ── Gold price (XAU/IDR per gram) ────────────────────────────
async function fetchGoldPrice() {
  const { crumb, cookie } = await getCrumb();
  try {
    const [goldResult, fxResult] = await Promise.all([
      fetchChart('GC=F', '1mo', '1d', null, crumb, cookie),
      fetchChart('USDIDR=X', '1mo', '1d', null, crumb, cookie),
    ]);
    const goldUSD = goldResult.meta.regularMarketPrice; // per troy oz
    const usdIdr  = fxResult.meta.regularMarketPrice;
    const pricePerGram = (goldUSD / 31.1035) * usdIdr;

    // % changes
    const closes = goldResult?.indicators?.quote?.[0]?.close?.filter(Boolean) || [];
    const timestamps = goldResult?.timestamp || [];
    const now = Date.now() / 1000;
    const dayAgo = now - 86400, monthAgo = now - 2592000, yearAgo = now - 31536000;

    const getClose = (targetTs) => {
      let best = null, bestDiff = Infinity;
      closes.forEach((c, i) => {
        const diff = Math.abs((timestamps[i] || 0) - targetTs);
        if (diff < bestDiff) { bestDiff = diff; best = c; }
      });
      return best;
    };

    const pct = (from, to) => (from && to) ? ((to - from) / from * 100) : null;
    const p24h = pct(getClose(dayAgo),   goldUSD);
    const p1M  = pct(getClose(monthAgo), goldUSD);
    const p1Y  = pct(getClose(yearAgo),  goldUSD);

    return { pricePerGram: Math.round(pricePerGram), currency: 'IDR',
      goldUSD, usdIdr, change24h: p24h, change1M: p1M, change1Y: p1Y };
  } catch(e) {
    return { error: e.message };
  }
}

// ── Nightly cron: auto-fill missing sectors for all known tickers ─
async function runSectorCron(env) {
  if (!env?.TICKER_STATS) return;
  let crumb, cookie;
  try { ({ crumb, cookie } = await getCrumb()); } catch { return; }

  const list = await env.TICKER_STATS.list();
  // Only look at ticker keys (exclude sector: cache keys)
  const tickers = list.keys.map(k => k.name).filter(k => !k.startsWith('sector:'));

  for (const ticker of tickers) {
    // Skip if already in hardcoded maps
    if (ticker.endsWith('.JK')) {
      if (IDX_SECTORS[ticker.replace('.JK', '')]) continue;
    } else {
      if (US_SECTORS[ticker]) continue;
    }
    // Skip if already cached in KV
    try {
      const cached = await env.TICKER_STATS.get(`sector:${ticker}`);
      if (cached) continue;
    } catch { continue; }
    // Fetch from Yahoo and cache
    try {
      const url = `https://query1.finance.yahoo.com/v11/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=assetProfile&crumb=${encodeURIComponent(crumb)}`;
      const res = await fetch(url, { headers: { 'User-Agent': UA, 'Cookie': cookie, 'Accept': 'application/json' } });
      const data = await res.json();
      const sector = data?.quoteSummary?.result?.[0]?.assetProfile?.sector;
      if (sector) await env.TICKER_STATS.put(`sector:${ticker}`, sector, { expirationTtl: 60 * 60 * 24 * 90 });
    } catch { /* skip this ticker */ }
    // Small delay — avoid hammering Yahoo
    await new Promise(r => setTimeout(r, 400));
  }
}

// updateStats removed — ticker hit counts burned too much KV write quota

// ── Hash IP for privacy (never store raw IPs) ─────────────────
async function hashIP(ip) {
  const data = new TextEncoder().encode(ip + ':nwtracker-2026');
  const buf  = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── Global stats: country + unique user (max 1 write-set per IP per day) ─
// Only writes once per IP per day — subsequent requests from same IP are free reads.
// Called only from /price (not /fx or /gold) to further reduce write pressure.
async function trackGlobalStats(env, request) {
  if (!env?.TICKER_STATS) return;
  try {
    const ip     = request.headers.get('CF-Connecting-IP') || 'unknown';
    const today  = new Date().toISOString().slice(0, 10);
    const ipHash = await hashIP(ip);
    const ipKey  = `ip_daily:${ipHash}:${today}`;

    // If already tracked today — zero writes, just return
    const alreadySeen = await env.TICKER_STATS.get(ipKey);
    if (alreadySeen) return;

    // First request of the day from this IP — do all writes at once
    const country = request.cf?.country || 'XX';
    await env.TICKER_STATS.put(ipKey, '1', { expirationTtl: 25 * 60 * 60 }); // mark as seen today

    await env.TICKER_STATS.put(`global:country:${country}`, '1');             // country presence

    // Unique user (cumulative, 365-day dedup)
    const uniqKey = `uniq:${ipHash}`;
    const isNew   = await env.TICKER_STATS.get(uniqKey);
    if (!isNew) {
      await env.TICKER_STATS.put(uniqKey, '1', { expirationTtl: 365 * 24 * 60 * 60 });
      const uuCount = parseInt(await env.TICKER_STATS.get('global:unique_users') || '0', 10);
      await env.TICKER_STATS.put('global:unique_users', String(uuCount + 1));
    }
  } catch { /* never break price requests */ }
}

// ── Router ────────────────────────────────────────────────────
export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    const url  = new URL(request.url);
    const json = (data, status=200) => new Response(JSON.stringify(data),
      { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

    // GET /
    if (url.pathname === '/') return json({ status: 'ok', version: '1.3.0', service: 'NW Tracker Stock Proxy' });

    // GET /crumb-test
    if (url.pathname === '/crumb-test') {
      try { const { crumb } = await getCrumb(); return json({ crumb: crumb.slice(0,8)+'...', ok: true }); }
      catch(e) { return json({ error: e.message }, 500); }
    }

    // GET /price?symbol=BBCA,AAPL,TLKM
    if (url.pathname === '/price') {
      const raw = url.searchParams.get('symbol');
      if (!raw) return json({ error: 'symbol param required' }, 400);
      const symbols = raw.split(',').map(s => s.trim().toUpperCase()).slice(0, 10);

      // Fire-and-forget: global stats, once per IP per day (zero latency impact)
      if (ctx?.waitUntil) ctx.waitUntil(trackGlobalStats(env, request));

      const results = {};
      await Promise.all(symbols.map(async sym => {
        try { results[sym] = await fetchStock(sym, env); }
        catch(e) { results[sym] = { symbol: sym, error: e.message, price: null }; }
      }));
      return json(results);
    }

    // GET /fx
    if (url.pathname === '/fx') {
      try { return json(await fetchFXRates()); }
      catch(e) { return json({ error: e.message }, 500); }
    }

    // GET /gold
    if (url.pathname === '/gold') {
      try { return json(await fetchGoldPrice()); }
      catch(e) { return json({ error: e.message }, 500); }
    }

    // GET /stats — ticker usage leaderboard + sector cache status
    if (url.pathname === '/stats') {
      if (!env?.TICKER_STATS) return json({ error: 'KV not bound' }, 503);
      try {
        const list = await env.TICKER_STATS.list();
        const allKeys    = list.keys.map(k => k.name);
        const tickerKeys = allKeys.filter(k => !k.startsWith('sector:') && !k.startsWith('global:') && !k.startsWith('ip_daily:'));
        const sectorKeys = allKeys.filter(k => k.startsWith('sector:'));

        const entries = (await Promise.all(
          tickerKeys.map(async name => [name, parseInt(await env.TICKER_STATS.get(name) || '0', 10)])
        )).filter(([, v]) => !isNaN(v) && v > 0);
        entries.sort((a, b) => b[1] - a[1]);

        const sectorCached = sectorKeys.map(k => k.replace('sector:', ''));
        const noSector = tickerKeys.filter(t =>
          !sectorCached.includes(t) &&
          !(t.endsWith('.JK') ? IDX_SECTORS[t.replace('.JK','')] : US_SECTORS[t])
        );

        return json({ tickers: Object.fromEntries(entries), total: entries.length, sectorsCached: sectorCached.length, noSectorYet: noSector });
      } catch(e) { return json({ error: e.message }, 500); }
    }

    // GET /global-stats — public stats for the global page
    if (url.pathname === '/global-stats') {
      if (!env?.TICKER_STATS) return json({ error: 'KV not bound' }, 503);
      try {
        const [countryList, allList] = await Promise.all([
          env.TICKER_STATS.list({ prefix: 'global:country:' }),
          env.TICKER_STATS.list(),
        ]);
        const countries    = countryList.keys.map(k => k.name.replace('global:country:', '')).sort();
        const tickerKeys   = allList.keys.map(k => k.name).filter(k =>
          !k.startsWith('sector:') && !k.startsWith('global:') && !k.startsWith('ip_daily:') && !k.startsWith('uniq:')
        );
        const uniqueUsers  = parseInt(await env.TICKER_STATS.get('global:unique_users') || '0', 10);
        return json({ uniqueCountries: countries.length, countries, uniqueTickers: tickerKeys.length, uniqueUsers });
      } catch(e) { return json({ error: e.message }, 500); }
    }

    return json({ error: 'Not found' }, 404);
  },

  // Nightly cron: auto-fill sectors for unknown tickers
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runSectorCron(env));
  },
};
