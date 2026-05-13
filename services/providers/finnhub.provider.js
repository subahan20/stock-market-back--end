/**
 * Finnhub market API — https://finnhub.io/docs/api/quote
 *
 * Free tier:
 *   - 60 requests/minute (no daily cap)
 *   - Real-time quotes for US stocks
 *   - NSE/BSE quotes are NOT covered on free plan — Indian tickers must keep using Twelve Data.
 *
 * Configure FINNHUB_API_KEY in `.env` (sign up at https://finnhub.io — no credit card needed).
 */

import { env } from '../../config/env.js';
import { STOCK_UNIVERSE } from '../../constants/stockUniverse.js';

const BASE = 'https://finnhub.io/api/v1';

function assertKey() {
  if (!env.finnhubApiKey) {
    throw new Error('FINNHUB_API_KEY is not configured');
  }
}

const NAME_BY_SYMBOL = Object.fromEntries(STOCK_UNIVERSE.map((u) => [u.symbol, u.name]));

/** Finnhub trades on US tickers without exchange suffixes; this set is the supported universe. */
const US_SYMBOLS = new Set(
  STOCK_UNIVERSE.filter((u) => u.region === 'US').map((u) => u.symbol)
);

/** Tickers we'd never want to route to Finnhub (Indian listings + indices). */
const NSE_SYMBOLS = new Set(
  STOCK_UNIVERSE.filter((u) => u.region === 'IN').map((u) => u.symbol)
);

/**
 * Indian companies that also list as ADRs on NYSE/NASDAQ. Finnhub's free plan can quote
 * these in real time via the bare ticker (no exchange suffix). Prices are USD, not INR —
 * this is the explicit tradeoff for getting live data on the free tier (Twelve free's
 * NSE feed is permanently delayed).
 *
 *   WIT  → Wipro Ltd ADR (NYSE)          — verified live on Finnhub free
 *   IBN  → ICICI Bank Ltd ADR (NYSE)     — verified live on Finnhub free
 *   HDB  → HDFC Bank Ltd ADR (NYSE)      — verified live on Finnhub free
 *
 * INFY is intentionally NOT in this set: the dashboard's headline INFOSYS card needs to
 * remain in NSE INR (~₹1,140 range) for a recognisable rupee value, so it stays routed
 * to Twelve Data even though Twelve's free plan returns the previous session's close.
 * Tata Motors ADR (TTM) is excluded because it was delisted from the NYSE in 2023 and
 * returns zeros on Finnhub.
 */
const US_ADR_OVERRIDES = new Set(['WIT', 'IBN', 'HDB']);

/** @param {string} internal */
export function finnhubSupports(internal) {
  const s = String(internal || '').toUpperCase().trim();
  if (!s) return false;
  if (US_ADR_OVERRIDES.has(s)) return true;
  if (NSE_SYMBOLS.has(s)) return false;
  if (US_SYMBOLS.has(s)) return true;
  // Treat short alpha-only tickers as US-listed by default (matches the heuristic in
  // toTwelveDataPair). Anything with dots/colons/digits is treated as non-US.
  return /^[A-Z]{1,5}$/.test(s);
}

async function fetchJson(url, { timeoutMs = 15000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: ctrl.signal,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      // Finnhub returns 429 for rate limit and 401/403 for invalid keys; surface them clearly.
      const msg = json?.error || `Finnhub HTTP ${res.status}`;
      const e = new Error(msg);
      e.status = res.status;
      throw e;
    }
    if (json && typeof json === 'object' && json.error) {
      throw new Error(json.error);
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
 * Finnhub /quote payload:
 *   { c: current price, d: change, dp: percent change, h: day high, l: day low,
 *     o: open, pc: previous close, t: unix-seconds-of-last-trade }
 */
export function normalizeFinnhubQuote(internal, q) {
  if (!q || typeof q !== 'object') {
    return {
      symbol: internal,
      company_name: NAME_BY_SYMBOL[internal] || null,
      price: null,
      high: null,
      low: null,
      volume: 0,
      market_cap: null,
      change_percent: null,
      _vendor: 'finnhub',
      _vendorName: NAME_BY_SYMBOL[internal] || null,
      _quoteTimestamp: null,
    };
  }
  const price = num(q.c);
  const high = num(q.h);
  const low = num(q.l);
  const prev = num(q.pc);
  let pct = num(q.dp);
  if (pct == null && price != null && prev != null && prev !== 0) {
    pct = ((price - prev) / prev) * 100;
  }
  const t = num(q.t);
  const name = NAME_BY_SYMBOL[internal] || null;
  return {
    symbol: internal,
    company_name: name,
    price,
    high,
    low,
    volume: 0,
    market_cap: null,
    change_percent: pct,
    _vendor: 'finnhub',
    _vendorName: name,
    /** Last trade time reported by Finnhub (epoch ms). null if unknown. */
    _quoteTimestamp: t ? t * 1000 : null,
  };
}

/** @param {string} internal */
export async function fetchQuote(internal) {
  assertKey();
  const url = `${BASE}/quote?symbol=${encodeURIComponent(internal)}&token=${encodeURIComponent(env.finnhubApiKey)}`;
  const json = await fetchJson(url);
  // Finnhub returns { c: 0, d: null, dp: null, ... } for unknown / unsupported symbols.
  if (!json || json.c == null || json.c === 0) {
    return null;
  }
  return normalizeFinnhubQuote(internal, json);
}

/**
 * Symbol/company lookup against Finnhub's global `/search`.
 *
 * Free plan supports this endpoint and returns matches across exchanges. We strip
 * non-US suffixed listings (e.g. `AAPL.SW`, `005930.KS`) because the free plan can
 * only quote bare US tickers, and we filter to equities/ETFs.
 *
 * @param {string} query   Company name or ticker fragment ("netflix", "wal", "META").
 * @param {{ limit?: number }} [opts]
 * @returns {Promise<Array<{ symbol: string, name: string, type: string }>>}
 */
export async function fetchSymbolLookup(query, { limit = 8 } = {}) {
  assertKey();
  const q = String(query || '').trim();
  if (!q) return [];
  const url = `${BASE}/search?q=${encodeURIComponent(q)}&token=${encodeURIComponent(env.finnhubApiKey)}`;
  const json = await fetchJson(url, { timeoutMs: 12000 });
  const results = Array.isArray(json?.result) ? json.result : [];

  const out = [];
  const seen = new Set();
  for (const r of results) {
    if (!r || typeof r !== 'object') continue;
    const sym = String(r.displaySymbol || r.symbol || '').trim().toUpperCase();
    if (!sym || seen.has(sym)) continue;
    // Drop foreign exchange suffixes (dot or colon means "<ticker>.<exch>"); only keep US-listed.
    if (/[.:]/.test(sym)) continue;
    // Plain alphabetic tickers up to ~6 chars (Class B share like BRK.B already excluded above).
    if (!/^[A-Z][A-Z0-9-]{0,7}$/.test(sym)) continue;
    const type = String(r.type || '').toLowerCase();
    // Keep common stock + ETFs; skip warrants, units, preferred, rights, mutual funds, etc.
    if (type && !type.includes('common stock') && !type.includes('etf')) continue;
    out.push({
      symbol: sym,
      name: String(r.description || sym).trim(),
      type: r.type || 'Common Stock',
    });
    seen.add(sym);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Light parallel batch with throttling to stay under 60 req/min.
 * Filters out symbols Finnhub doesn't cover (Indian listings) so they fall through to Twelve.
 * @param {string[]} internals
 */
export async function fetchQuoteBatchByInternal(internals) {
  assertKey();
  const uniq = [...new Set(internals.map((s) => String(s || '').toUpperCase().trim()))].filter(
    finnhubSupports
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
    if (i + chunkSize < uniq.length) await new Promise((r) => setTimeout(r, 150));
  }
  if (rateLimited) {
    throw new Error('Finnhub: rate limit exceeded (60 req/min)');
  }
  return out;
}
