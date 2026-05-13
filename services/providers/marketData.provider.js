/**
 * Live market data routing.
 *
 *   - US tickers (AAPL, MSFT, NVDA, …)              → Finnhub (real-time, free) → Twelve fallback.
 *   - Indian listings + indices (INFY, NIFTY, …)    → Yahoo (real-time NSE INR, free) → Twelve fallback.
 *
 * If a vendor is missing/keyless/rate-limited, the router transparently falls through to the next
 * option (or returns empty so the engine can serve the Supabase DB cache).
 *
 * Yahoo's unofficial v8 chart endpoint can change without notice; if it ever stops responding,
 * Indian symbols fall back to Twelve (which returns previous-session close on free plan).
 */

import { env, looksLikeTwelveDataKey, looksLikeFinnhubKey } from '../../config/env.js';
import * as twelve from './twelvedata.provider.js';
import * as finnhub from './finnhub.provider.js';
import * as yahoo from './yahoo.provider.js';

/** Twelve Data rate-limit / quota cooldown (skip vendor while it is throwing 429 / credit errors). */
let twelveCooldownUntil = 0;
const TWELVE_COOLDOWN_MS = 65_000;
/** Daily quota cooldown — Twelve free plan resets at 00:00 UTC. */
let twelveDailyCooldownUntil = 0;
let lastTwelveErrorMessage = null;

/** Finnhub rate-limit cooldown (free plan: 60 req/min). */
let finnhubCooldownUntil = 0;
const FINNHUB_COOLDOWN_MS = 35_000;
let lastFinnhubErrorMessage = null;

/** Yahoo rate-limit cooldown (unofficial v8 chart endpoint). */
let yahooCooldownUntil = 0;
const YAHOO_COOLDOWN_MS = 60_000;
let lastYahooErrorMessage = null;

function isTwelveRateLimit(err) {
  const msg = String(err?.message || err || '').toLowerCase();
  return (
    msg.includes('api credits') ||
    msg.includes('run out') ||
    msg.includes('rate limit') ||
    msg.includes('429') ||
    msg.includes('http 429')
  );
}

function isTwelveDailyQuotaExhausted(err) {
  const msg = String(err?.message || err || '').toLowerCase();
  return msg.includes('for the day') || msg.includes('daily');
}

function nextUtcMidnightMs() {
  const d = new Date();
  d.setUTCHours(24, 0, 0, 0);
  return d.getTime();
}

function noteTwelveError(err) {
  lastTwelveErrorMessage = String(err?.message || err || '');
  if (!isTwelveRateLimit(err)) return;

  if (isTwelveDailyQuotaExhausted(err)) {
    twelveDailyCooldownUntil = nextUtcMidnightMs();
    // eslint-disable-next-line no-console
    console.warn(
      `[twelvedata] daily quota exhausted — pausing until ${new Date(twelveDailyCooldownUntil).toISOString()}; engine will serve DB cache only`
    );
    return;
  }

  twelveCooldownUntil = Date.now() + TWELVE_COOLDOWN_MS;
  // eslint-disable-next-line no-console
  console.warn(
    `[twelvedata] minute rate limit hit — pausing Twelve calls for ~${Math.round(
      TWELVE_COOLDOWN_MS / 1000
    )}s; engine will serve DB cache until then`
  );
}

function twelveAvailable() {
  if (!env.twelveDataApiKey) return false;
  if (!looksLikeTwelveDataKey()) return false;
  const now = Date.now();
  return now >= twelveCooldownUntil && now >= twelveDailyCooldownUntil;
}

function finnhubAvailable() {
  if (!env.finnhubApiKey) return false;
  if (!looksLikeFinnhubKey()) return false;
  return Date.now() >= finnhubCooldownUntil;
}

function noteFinnhubError(err) {
  lastFinnhubErrorMessage = String(err?.message || err || '');
  const status = err?.status;
  if (status === 429 || /rate limit/i.test(lastFinnhubErrorMessage)) {
    finnhubCooldownUntil = Date.now() + FINNHUB_COOLDOWN_MS;
    // eslint-disable-next-line no-console
    console.warn(
      `[finnhub] rate limit — pausing ~${Math.round(FINNHUB_COOLDOWN_MS / 1000)}s; falling back to Twelve Data / DB cache`
    );
  }
}

function yahooAvailable() {
  // No API key required for Yahoo's public v8 chart endpoint.
  return Date.now() >= yahooCooldownUntil;
}

function noteYahooError(err) {
  lastYahooErrorMessage = String(err?.message || err || '');
  const status = err?.status;
  if (status === 429 || /rate limit/i.test(lastYahooErrorMessage)) {
    yahooCooldownUntil = Date.now() + YAHOO_COOLDOWN_MS;
    // eslint-disable-next-line no-console
    console.warn(
      `[yahoo] rate limit (429) — pausing ~${Math.round(YAHOO_COOLDOWN_MS / 1000)}s; Indian symbols will use Twelve / DB cache`
    );
  }
}

export function marketDataSource() {
  // Order of preference for the dashboard's headline ticker (mostly US).
  if (finnhubAvailable()) return 'finnhub';
  if (yahooAvailable()) return 'yahoo';
  if (twelveAvailable()) return 'twelvedata';
  if (!env.twelveDataApiKey) return 'twelvedata-disabled';
  if (!looksLikeTwelveDataKey()) return 'twelvedata-invalid-key';
  return Date.now() < twelveDailyCooldownUntil ? 'twelvedata-daily-cooldown' : 'twelvedata-cooldown';
}

/** Vendor status snapshot for error responses. */
export function marketDataStatus() {
  const now = Date.now();
  return {
    source: marketDataSource(),
    twelvedata: {
      hasKey: Boolean(env.twelveDataApiKey),
      keyFormatValid: looksLikeTwelveDataKey(),
      minuteCooldownUntil:
        twelveCooldownUntil > now ? new Date(twelveCooldownUntil).toISOString() : null,
      dailyCooldownUntil:
        twelveDailyCooldownUntil > now ? new Date(twelveDailyCooldownUntil).toISOString() : null,
      lastError: lastTwelveErrorMessage,
    },
    finnhub: {
      hasKey: Boolean(env.finnhubApiKey),
      keyFormatValid: looksLikeFinnhubKey(),
      cooldownUntil:
        finnhubCooldownUntil > now ? new Date(finnhubCooldownUntil).toISOString() : null,
      lastError: lastFinnhubErrorMessage,
    },
    yahoo: {
      // Yahoo's v8 chart endpoint needs no key.
      cooldownUntil:
        yahooCooldownUntil > now ? new Date(yahooCooldownUntil).toISOString() : null,
      lastError: lastYahooErrorMessage,
    },
  };
}

function rowUsable(r) {
  return r && r.price != null && r.change_percent != null;
}

/**
 * Split internals into the symbol groups each vendor primarily owns:
 *   - finn  → US listings (Finnhub real-time)
 *   - yh    → Indian listings + indices (Yahoo real-time NSE INR)
 *   - tw    → leftovers (Twelve as a final fallback)
 *
 * A symbol may fall through multiple vendors if its primary is unavailable.
 */
function partitionVendorSymbols(internals) {
  const finn = [];
  const yh = [];
  const tw = [];
  for (const s of internals) {
    if (finnhub.finnhubSupports(s)) finn.push(s);
    else if (yahoo.yahooSupports(s)) yh.push(s);
    else tw.push(s);
  }
  return { finn, yh, tw };
}

/**
 * @param {string[]} internals Uppercase internal symbols
 * @returns {Promise<Array<{ symbol, company_name, price, high, low, volume, market_cap, change_percent, _vendor?, _quoteTimestamp? }>>}
 */
export async function fetchNormalizedQuotesForInternals(internals) {
  const { finn, yh, tw } = partitionVendorSymbols(internals);
  const out = [];
  const covered = new Set();

  // Finnhub for US tickers — real-time on free plan.
  if (finn.length && finnhubAvailable()) {
    try {
      const rows = await finnhub.fetchQuoteBatchByInternal(finn);
      for (const r of rows) {
        if (rowUsable(r)) {
          out.push(r);
          covered.add(r.symbol);
        }
      }
    } catch (e) {
      noteFinnhubError(e);
      // eslint-disable-next-line no-console
      console.warn('[finnhub] batch quote failed', e?.message || e);
    }
  }

  // Yahoo for Indian listings + indices — real-time NSE INR, no API key.
  if (yh.length && yahooAvailable()) {
    try {
      const rows = await yahoo.fetchQuoteBatchByInternal(yh);
      for (const r of rows) {
        if (rowUsable(r)) {
          out.push(r);
          covered.add(r.symbol);
        }
      }
    } catch (e) {
      noteYahooError(e);
      // eslint-disable-next-line no-console
      console.warn('[yahoo] batch quote failed', e?.message || e);
    }
  }

  // Twelve Data as the final fallback for anything still uncovered.
  const remaining = [
    ...tw,
    ...finn.filter((s) => !covered.has(s)),
    ...yh.filter((s) => !covered.has(s)),
  ];
  if (remaining.length && twelveAvailable()) {
    try {
      const rows = await twelve.fetchQuoteBatchByInternal(remaining);
      for (const r of rows) {
        if (!r) continue;
        if (!r._vendor) r._vendor = 'twelvedata';
        out.push(r);
      }
    } catch (e) {
      noteTwelveError(e);
      // eslint-disable-next-line no-console
      console.warn('[twelvedata] batch quote failed', e?.message || e);
    }
  }

  return out;
}

export async function fetchChartForInternal(internal, rangeKey) {
  // Prefer Yahoo for Indian listings/indices (real-time NSE INR).
  if (yahoo.yahooSupports(internal) && yahooAvailable()) {
    try {
      const series = await yahoo.fetchTimeSeries(internal, rangeKey);
      if (series?.points?.length) return series;
    } catch (e) {
      noteYahooError(e);
      // eslint-disable-next-line no-console
      console.warn(`[yahoo] time_series failed for ${internal} ${rangeKey}: ${e?.message || e}`);
    }
  }
  if (!twelveAvailable()) {
    return { points: [], currency: null };
  }
  try {
    const series = await twelve.fetchTimeSeries(internal, rangeKey);
    return series || { points: [], currency: null };
  } catch (e) {
    noteTwelveError(e);
    // eslint-disable-next-line no-console
    console.warn(`[twelvedata] time_series failed for ${internal} ${rangeKey}: ${e?.message || e}`);
    return { points: [], currency: null };
  }
}

/**
 * Dynamic symbol/company lookup so search isn't limited to the static STOCK_UNIVERSE.
 *
 * Backed by Finnhub `/search` (free plan). Results are cached in-memory by lowercased query
 * for `LOOKUP_TTL_MS` to keep typing latency low and stay well under 60 req/min.
 *
 * @param {string} query
 * @param {{ limit?: number }} [opts]
 * @returns {Promise<Array<{ symbol: string, name: string, type: string }>>}
 */
const LOOKUP_TTL_MS = 5 * 60 * 1000;
const LOOKUP_MAX_ENTRIES = 200;
const lookupCache = new Map(); // key → { ts, value }

function readLookupCache(key) {
  const e = lookupCache.get(key);
  if (!e) return null;
  if (Date.now() - e.ts > LOOKUP_TTL_MS) {
    lookupCache.delete(key);
    return null;
  }
  return e.value;
}

function writeLookupCache(key, value) {
  if (lookupCache.size >= LOOKUP_MAX_ENTRIES) {
    const firstKey = lookupCache.keys().next().value;
    if (firstKey !== undefined) lookupCache.delete(firstKey);
  }
  lookupCache.set(key, { ts: Date.now(), value });
}

export async function lookupSymbols(query, { limit = 8 } = {}) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  const cached = readLookupCache(q);
  if (cached) return cached.slice(0, limit);
  if (!finnhubAvailable()) return [];
  try {
    const rows = await finnhub.fetchSymbolLookup(q, { limit });
    writeLookupCache(q, rows);
    return rows;
  } catch (e) {
    noteFinnhubError(e);
    return [];
  }
}

export async function fetchSparklineForInternal(internal, maxPoints) {
  if (yahoo.yahooSupports(internal) && yahooAvailable()) {
    try {
      const line = await yahoo.fetchIntradaySparkline(internal, maxPoints);
      if (Array.isArray(line) && line.length) return line;
    } catch (e) {
      noteYahooError(e);
    }
  }
  if (!twelveAvailable()) return [];
  try {
    const line = await twelve.fetchIntradaySparkline(internal, maxPoints);
    return Array.isArray(line) ? line : [];
  } catch (e) {
    noteTwelveError(e);
    return [];
  }
}

/**
 * Single-symbol quote. Routes by symbol class:
 *   US tickers     → Finnhub (real-time on free plan)
 *   Indian listings → Yahoo (real-time NSE INR, no key)
 *   Everything else / fallbacks → Twelve Data
 * Returns null when no vendor can serve the symbol so the engine can use the DB cache.
 */
export async function fetchSingleQuoteByInternal(internal) {
  if (finnhub.finnhubSupports(internal) && finnhubAvailable()) {
    try {
      const r = await finnhub.fetchQuote(internal);
      if (rowUsable(r)) return r;
    } catch (e) {
      noteFinnhubError(e);
    }
  }
  if (yahoo.yahooSupports(internal) && yahooAvailable()) {
    try {
      const r = await yahoo.fetchQuote(internal);
      if (rowUsable(r)) return r;
    } catch (e) {
      noteYahooError(e);
    }
  }
  if (!twelveAvailable()) return null;
  try {
    const tr = await twelve.fetchQuoteBatchByInternal([internal]);
    const r = tr[0] || null;
    if (r && !r._vendor) r._vendor = 'twelvedata';
    return r;
  } catch (e) {
    noteTwelveError(e);
    return null;
  }
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * When batch quotes return nothing (rate limit, network blip), fetch one symbol at a time.
 * Stops early if no vendor is reachable.
 */
export async function fetchQuotesSequentialFallback(internals) {
  const uniq = [...new Set(internals)];
  const out = [];
  for (const sym of uniq) {
    if (!finnhubAvailable() && !yahooAvailable() && !twelveAvailable()) break;
    try {
      const q = await fetchSingleQuoteByInternal(sym);
      if (rowUsable(q)) out.push(q);
    } catch (e) {
      // fetchSingleQuoteByInternal already attributes the error; nothing more to do here.
    }
    await sleep(55);
  }
  return out;
}
