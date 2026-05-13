/**
 * Twelve Data market API — https://api.twelvedata.com/quote
 * Requires TWELVE_DATA_API_KEY (see env.js). 1 API credit per symbol per quote call.
 */

import { env } from '../../config/env.js';
import { toTwelveDataPair } from '../../constants/liveMarket.symbols.js';

const BASE = 'https://api.twelvedata.com';

function assertKey() {
  if (!env.twelveDataApiKey) {
    throw new Error('TWELVE_DATA_API_KEY is not configured');
  }
}

async function fetchJson(url, { timeoutMs = 25000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: ctrl.signal,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(json?.message || `Twelve Data HTTP ${res.status}`);
    }
    if (json?.status === 'error') {
      throw new Error(json?.message || 'Twelve Data returned an error');
    }
    return json;
  } finally {
    clearTimeout(t);
  }
}

function parseTdNum(v) {
  if (v == null || v === '') return null;
  const n = Number(String(v).trim().replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

/**
 * Normalized row for realtimeStock.engine / DB (same shape as Yahoo-derived rows).
 * Matches Twelve Data /quote payload: string numerics, `name`, `change`, `percent_change`,
 * `previous_close`, optional `extended_*` (see https://twelvedata.com/docs#quote ).
 */
export function normalizeTwelveQuote(internal, q) {
  if (!q || typeof q !== 'object') {
    return {
      symbol: internal,
      company_name: null,
      price: null,
      high: null,
      low: null,
      volume: 0,
      market_cap: null,
      change_percent: null,
      _vendorName: null,
    };
  }

  const price =
    parseTdNum(q.close) ??
    parseTdNum(q.open) ??
    parseTdNum(q.previous_close) ??
    parseTdNum(q.extended_price) ??
    parseTdNum(q.extended_close);
  let changePct = parseTdNum(q.percent_change);
  const prev = parseTdNum(q.previous_close);
  const changeAbs = parseTdNum(q.change);

  if (changePct == null && price != null && prev != null && prev !== 0) {
    changePct = ((price - prev) / prev) * 100;
  }
  if (changePct == null && changeAbs != null && prev != null && prev !== 0) {
    changePct = (changeAbs / prev) * 100;
  }

  const high = parseTdNum(q.high);
  const low = parseTdNum(q.low);
  let volume = parseTdNum(q.volume);
  if (volume == null) volume = 0;
  else volume = Math.round(volume);

  const name = typeof q.name === 'string' ? q.name.trim() : null;

  return {
    symbol: internal,
    company_name: name,
    price,
    high,
    low,
    volume,
    market_cap: null,
    change_percent: changePct,
    _vendorName: name,
  };
}

/**
 * @param {string} internal Uppercase internal symbol (e.g. RELIANCE)
 * @param {{ interval?: string }} [opts] — default 5min for fresher intraday quote bar
 */
export async function fetchQuote(internal, opts = {}) {
  assertKey();
  const { symbol, exchange } = toTwelveDataPair(internal);
  const params = new URLSearchParams({
    symbol,
    apikey: env.twelveDataApiKey,
    interval: opts.interval || '5min',
  });
  if (exchange) params.set('exchange', exchange);
  const url = `${BASE}/quote?${params.toString()}`;
  const json = await fetchJson(url);
  return normalizeTwelveQuote(internal, json);
}

/**
 * Parallel quotes with light throttling to reduce 429s on free tiers.
 * @param {string[]} internals
 */
export async function fetchQuoteBatchByInternal(internals) {
  assertKey();
  const uniq = [...new Set(internals)];
  const out = [];
  const chunkSize = 4;
  let rateLimited = false;
  for (let i = 0; i < uniq.length; i += chunkSize) {
    if (rateLimited) break;
    const chunk = uniq.slice(i, i + chunkSize);
    const part = await Promise.all(
      chunk.map(async (internal) => {
        try {
          return await fetchQuote(internal);
        } catch (e) {
          const msg = String(e?.message || '').toLowerCase();
          if (msg.includes('api credits') || msg.includes('run out') || msg.includes('429')) {
            rateLimited = true;
          }
          return null;
        }
      })
    );
    out.push(...part.filter(Boolean));
    if (i + chunkSize < uniq.length) await new Promise((r) => setTimeout(r, 250));
  }
  if (rateLimited) {
    throw new Error('Twelve Data: API credits exceeded for current minute');
  }
  return out;
}

const CHART_CFG = {
  '1D': { interval: '5min', outputsize: 80 },
  '1W': { interval: '1h', outputsize: 40 },
  '1M': { interval: '1day', outputsize: 32 },
  '1Y': { interval: '1week', outputsize: 56 },
};

/**
 * @param {string} internal
 * @param {'1D'|'1W'|'1M'|'1Y'} rangeKey
 */
export async function fetchTimeSeries(internal, rangeKey = '1D') {
  assertKey();
  const { symbol, exchange } = toTwelveDataPair(internal);
  const cfg = CHART_CFG[rangeKey] || CHART_CFG['1D'];
  const params = new URLSearchParams({
    symbol,
    apikey: env.twelveDataApiKey,
    interval: cfg.interval,
    outputsize: String(cfg.outputsize),
    order: 'ASC',
  });
  if (exchange) params.set('exchange', exchange);
  const url = `${BASE}/time_series?${params.toString()}`;
  const json = await fetchJson(url);
  const values = json?.values;
  if (!Array.isArray(values)) return { points: [], currency: json?.meta?.currency || null };
  const points = [];
  for (const row of values) {
    const t = row.datetime ? new Date(row.datetime).getTime() : null;
    const v = row.close != null ? Number(row.close) : null;
    if (t == null || Number.isNaN(t) || v == null || Number.isNaN(v)) continue;
    points.push({ t, v });
  }
  return { points, currency: json?.meta?.currency || null };
}

export async function fetchIntradaySparkline(internal, maxPoints = 14) {
  const { points } = await fetchTimeSeries(internal, '1D');
  if (!points.length) return [];
  return points.slice(-maxPoints).map((p) => p.v);
}
