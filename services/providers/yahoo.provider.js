/**
 * Yahoo Finance v8 chart API — https://query1.finance.yahoo.com/v8/finance/chart/<symbol>
 *
 * Used for Indian listings (NSE/BSE) where Twelve Data's free plan ships previous-session
 * data only. The v8 chart endpoint:
 *   - Requires no API key, no crumb cookie (unlike the v7 quote endpoint that needs auth).
 *   - Returns BOTH the live quote (in `meta`) and the intraday time series in one call.
 *   - Updates in near real-time during NSE/BSE hours (typically <15s delay).
 *
 * Limitations:
 *   - Yahoo can rate-limit aggressive callers (~2k req/hr per IP). For our use (6 NSE
 *     symbols every 5 min) that's nowhere near the ceiling.
 *   - Unofficial endpoint — Yahoo can break it at any time. If it does we fall back to
 *     Twelve via the router.
 */

import { STOCK_UNIVERSE } from '../../constants/stockUniverse.js';

const BASE = 'https://query1.finance.yahoo.com/v8/finance/chart';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const NAME_BY_SYMBOL = Object.fromEntries(STOCK_UNIVERSE.map((u) => [u.symbol, u.name]));
const IN_SYMBOLS = new Set(
  STOCK_UNIVERSE.filter((u) => u.region === 'IN').map((u) => u.symbol)
);

/**
 * Yahoo symbol overrides (indices + explicit BSE listings would go here).
 * Anything not listed falls back to `<INTERNAL>.NS` when the internal symbol is in
 * `IN_SYMBOLS`, or the bare ticker otherwise.
 */
const YAHOO_OVERRIDES = {
  NIFTY: '^NSEI',
  SENSEX: '^BSESN',
};

/** Map our internal symbol to a Yahoo ticker; returns null if we shouldn't route to Yahoo. */
export function toYahooSymbol(internal) {
  const s = String(internal || '').toUpperCase().trim();
  if (!s) return null;
  if (YAHOO_OVERRIDES[s]) return YAHOO_OVERRIDES[s];
  if (IN_SYMBOLS.has(s)) return `${s}.NS`;
  return null;
}

/** @param {string} internal */
export function yahooSupports(internal) {
  return toYahooSymbol(internal) !== null;
}

async function fetchJson(url, { timeoutMs = 15000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': UA },
      signal: ctrl.signal,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = json?.chart?.error?.description || `Yahoo HTTP ${res.status}`;
      const e = new Error(msg);
      e.status = res.status;
      throw e;
    }
    if (json?.chart?.error) {
      throw new Error(json.chart.error.description || 'Yahoo returned an error');
    }
    return json;
  } finally {
    clearTimeout(t);
  }
}

function num(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Pull the live quote (and intraday series in one call). The `meta` block on Yahoo's
 * chart response includes regularMarketPrice + day high/low + previous close — all the
 * fields we need for the dashboard cards.
 *
 * @param {string} internal
 * @returns {Promise<{
 *   symbol: string, company_name: string|null, price: number|null,
 *   high: number|null, low: number|null, volume: number, market_cap: null,
 *   change_percent: number|null, currency: string|null,
 *   _vendor: 'yahoo', _vendorName: string|null, _quoteTimestamp: number|null,
 * } | null>}
 */
export async function fetchQuote(internal) {
  const yahooSym = toYahooSymbol(internal);
  if (!yahooSym) return null;
  const url = `${BASE}/${encodeURIComponent(yahooSym)}?interval=5m&range=1d`;
  const json = await fetchJson(url);
  const meta = json?.chart?.result?.[0]?.meta;
  if (!meta) return null;

  const price = num(meta.regularMarketPrice);
  const prev = num(meta.previousClose) ?? num(meta.chartPreviousClose);
  const high = num(meta.regularMarketDayHigh);
  const low = num(meta.regularMarketDayLow);
  let volume = num(meta.regularMarketVolume) ?? 0;
  volume = Math.round(volume);

  let pct = null;
  if (price != null && prev != null && prev !== 0) {
    pct = ((price - prev) / prev) * 100;
  }

  const name =
    (typeof meta.longName === 'string' && meta.longName.trim()) ||
    (typeof meta.shortName === 'string' && meta.shortName.trim()) ||
    NAME_BY_SYMBOL[String(internal).toUpperCase()] ||
    null;

  const tsSec = num(meta.regularMarketTime);

  if (price == null) return null;

  return {
    symbol: String(internal).toUpperCase(),
    company_name: name,
    price,
    high,
    low,
    volume,
    market_cap: null,
    change_percent: pct,
    currency: meta.currency || null,
    _vendor: 'yahoo',
    _vendorName: name,
    _quoteTimestamp: tsSec ? tsSec * 1000 : null,
  };
}

/**
 * Light parallel batch. Yahoo's `/v8/chart` is one symbol per request, so we fan out.
 * Stops accumulating if rate-limit kicks in (429).
 * @param {string[]} internals
 */
export async function fetchQuoteBatchByInternal(internals) {
  const uniq = [...new Set(internals.map((s) => String(s || '').toUpperCase().trim()))].filter(
    yahooSupports
  );
  if (!uniq.length) return [];
  const out = [];
  const chunkSize = 6;
  let rateLimited = false;
  for (let i = 0; i < uniq.length; i += chunkSize) {
    if (rateLimited) break;
    const chunk = uniq.slice(i, i + chunkSize);
    const part = await Promise.all(
      chunk.map(async (internal) => {
        try {
          return await fetchQuote(internal);
        } catch (e) {
          if (e?.status === 429) rateLimited = true;
          return null;
        }
      })
    );
    out.push(...part.filter(Boolean));
    if (i + chunkSize < uniq.length) await new Promise((r) => setTimeout(r, 120));
  }
  if (rateLimited) {
    throw new Error('Yahoo: rate limit (429) — pausing');
  }
  return out;
}

/**
 * Yahoo chart ranges:
 *   1D → interval=5m,  range=1d
 *   1W → interval=30m, range=5d
 *   1M → interval=1d,  range=1mo
 *   1Y → interval=1wk, range=1y
 */
const CHART_CFG = {
  '1D': { interval: '5m', range: '1d' },
  '1W': { interval: '30m', range: '5d' },
  '1M': { interval: '1d', range: '1mo' },
  '1Y': { interval: '1wk', range: '1y' },
};

/** @returns {Promise<{ points: Array<{t:number,v:number}>, currency: string|null }>} */
export async function fetchTimeSeries(internal, rangeKey = '1D') {
  const yahooSym = toYahooSymbol(internal);
  if (!yahooSym) return { points: [], currency: null };
  const cfg = CHART_CFG[rangeKey] || CHART_CFG['1D'];
  const url = `${BASE}/${encodeURIComponent(yahooSym)}?interval=${cfg.interval}&range=${cfg.range}`;
  const json = await fetchJson(url);
  const result = json?.chart?.result?.[0];
  if (!result) return { points: [], currency: null };
  const stamps = result.timestamp || [];
  const closes = result.indicators?.quote?.[0]?.close || [];
  const points = [];
  for (let i = 0; i < stamps.length; i++) {
    const tSec = stamps[i];
    const v = closes[i];
    if (tSec == null || v == null || Number.isNaN(v)) continue;
    points.push({ t: tSec * 1000, v: Number(v) });
  }
  return { points, currency: result.meta?.currency || null };
}

export async function fetchIntradaySparkline(internal, maxPoints = 14) {
  const { points } = await fetchTimeSeries(internal, '1D');
  if (!points.length) return [];
  return points.slice(-maxPoints).map((p) => p.v);
}
