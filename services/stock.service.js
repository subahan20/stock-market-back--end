/**
 * Stock domain: live market ingest (Twelve Data if TWELVE_DATA_API_KEY, else Yahoo) + Supabase cache.
 * No synthetic price paths — only vendor + DB-backed values.
 */

import { env } from '../config/env.js';
import { getDb } from './db.service.js';
import { ApiError } from '../utils/ApiError.js';
import { HTTP_STATUS } from '../constants/index.js';
import { STOCK_UNIVERSE } from '../constants/stockUniverse.js';
import { SEARCH_QUERY_TO_SYMBOL } from '../constants/stockSearch.aliases.js';
import { attachPublicQuoteFields } from '../utils/stockQuoteNormalize.js';
import {
  getMarketSnapshot,
  getLastEngineError,
  refreshLiveMarketSafe,
  buildOverviewFromDbRows,
  getCreditsUsedToday,
} from './realtimeStock.engine.js';
import {
  fetchNormalizedQuotesForInternals,
  fetchChartForInternal,
  fetchSingleQuoteByInternal,
  lookupSymbols,
  marketDataSource,
  marketDataStatus,
} from './providers/marketData.provider.js';
import {
  loadChartBars,
  upsertChartBars,
  lastBarTimestamp,
  rangeStalenessMs,
} from './chartHistory.service.js';

const INDEX_ALIASES = [
  { symbol: 'NIFTY', name: 'NIFTY 50', sector: 'Index' },
  { symbol: 'SENSEX', name: 'SENSEX', sector: 'Index' },
];

const TICKER_RE = /^[A-Z0-9]{1,32}$/;

function stockDebug(label, payload) {
  if (!env.debugStock) return;
  // eslint-disable-next-line no-console
  console.log(`[stock:${label}]`, payload);
}

/**
 * Upsert one vendor quote into `public.stocks` so chart_history / details can satisfy FK & DB reads.
 */
export async function persistSingleStockRow(symbol, quote) {
  const sym = String(symbol || '').toUpperCase().trim();
  if (!sym || !quote || quote.price == null || quote.change_percent == null) {
    return { ok: false, skipped: true, reason: 'incomplete_quote' };
  }
  const db = getDb();
  if (!db) return { ok: false, skipped: true, reason: 'no_supabase_admin_client' };
  const payload = {
    symbol: sym,
    company_name: quote.company_name || quote._vendorName || sym,
    price: quote.price,
    high: quote.high,
    low: quote.low,
    volume: quote.volume ?? 0,
    market_cap: quote.market_cap,
    change_percent: quote.change_percent,
    last_updated: new Date().toISOString(),
  };
  const { error } = await db.from(env.tables.stocks).upsert(payload, { onConflict: 'symbol' });
  if (error) {
    // eslint-disable-next-line no-console
    console.warn('[stock] single upsert failed', sym, error.message);
    return { ok: false, error: error.message };
  }
  // eslint-disable-next-line no-console
  console.log('[stock] DB upsert ok (single)', { symbol: sym });
  return { ok: true };
}

/**
 * DB-only read for a single symbol from `public.stocks`. No vendor fallback.
 * Returns the canonical details shape (or null when missing / Supabase unavailable).
 */
export async function getStockFromDb(symbol) {
  const sym = (symbol || '').toUpperCase().trim();
  if (!sym) return null;
  const db = getDb();
  if (!db) {
    stockDebug('db:noClient', { sym });
    return null;
  }
  const { data, error } = await db
    .from(env.tables.stocks)
    .select('*')
    .eq('symbol', sym)
    .maybeSingle();
  if (error) {
    // eslint-disable-next-line no-console
    console.warn('[stock] getStockFromDb failed', error.message || error);
    return null;
  }
  if (!data) return null;
  return {
    symbol: data.symbol,
    name: data.company_name,
    sector: sym === 'NIFTY' || sym === 'SENSEX' ? 'Index' : 'Equity',
    price: Number(data.price),
    changePct: Number(data.change_percent),
    high: data.high != null ? Number(data.high) : null,
    low: data.low != null ? Number(data.low) : null,
    volume: Number(data.volume) || 0,
    marketCapCr: data.market_cap != null ? Number(data.market_cap) : 0,
    lastUpdated: data.last_updated || null,
    source: 'database',
    aiInsight: null,
  };
}

export async function listStocksFromDb() {
  const db = getDb();
  if (!db) return [];
  const { data, error } = await db.from(env.tables.stocks).select('*').order('symbol', { ascending: true });
  if (error) {
    // eslint-disable-next-line no-console
    console.warn('[stock] listStocksFromDb failed', error.message || error);
    return [];
  }
  if (!data?.length) return [];
  return data;
}

async function ensureOverview() {
  let snap = getMarketSnapshot();
  if (!snap) {
    const { overview } = await refreshLiveMarketSafe();
    snap = overview;
  }
  if (!snap) {
    const rows = await listStocksFromDb();
    if (rows.length) snap = buildOverviewFromDbRows(rows);
  }
  if (!snap) {
    const vendor = marketDataStatus();
    const verbose = env.nodeEnv === 'development' || env.debugStock;
    const dailyExhausted = Boolean(vendor.twelvedata?.dailyCooldownUntil);
    const message = dailyExhausted
      ? `Vendor (Twelve Data) daily quota exhausted until ${vendor.twelvedata.dailyCooldownUntil}. Supabase cache is empty — no data to serve.`
      : 'Live market data unavailable — vendor unreachable and Supabase cache is empty.';
    const details = {
      vendor,
      credits: getCreditsUsedToday(),
      supabaseAdminConfigured: Boolean(env.supabaseUrl && env.supabaseServiceRoleKey),
      lastEngineError: getLastEngineError()?.message ?? null,
      ...(verbose
        ? {
            where: 'stock.service.js → ensureOverview() after refreshLiveMarketSafe() + listStocksFromDb()',
            whyNoDbWrites:
              'Rows are upserted only after a successful live quote refresh (realtimeStock.engine → persistRows). If vendors fail first, nothing is saved. If SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are missing, persist is skipped.',
          }
        : {}),
    };
    throw new ApiError(message, HTTP_STATUS.SERVICE_UNAVAILABLE, details);
  }
  return snap;
}

export async function getOverviewPayloadMerged() {
  return ensureOverview();
}

export async function getLiveQuotesMerged() {
  const o = await ensureOverview();
  return {
    asOf: o.asOf,
    indices: { nifty: o.nifty, sensex: o.sensex },
    cards: o.marketCards,
    source: o.source,
  };
}

function universeForSearch() {
  return [...INDEX_ALIASES, ...STOCK_UNIVERSE];
}

/** Trim, collapse whitespace; empty string allowed (caller returns []). */
export function normalizeStockSearchQuery(raw) {
  if (raw == null) return '';
  return String(raw).trim().replace(/\s+/g, ' ');
}

export function searchUniverse(q, limit = 8) {
  const query = (q || '').trim().toLowerCase();
  if (!query) return [];
  const scored = universeForSearch().map((u) => {
    const sym = u.symbol.toLowerCase();
    const nm = u.name.toLowerCase();
    let score = 0;
    if (sym === query) score += 100;
    if (sym.startsWith(query)) score += 40;
    if (nm.startsWith(query)) score += 30;
    if (sym.includes(query)) score += 15;
    if (nm.includes(query)) score += 10;
    if (query === 'infosys' && sym === 'infy') score += 50;
    if (query === 'hdfc' && sym === 'hdfcbank') score += 45;
    return score > 0 ? { ...u, score } : null;
  });
  return scored
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ symbol, name, sector }) => ({ symbol, name, sector }));
}

function metaForSymbol(sym) {
  const s = String(sym || '').toUpperCase().trim();
  const fromUniverse = universeForSearch().find((u) => u.symbol === s);
  if (fromUniverse) {
    return { symbol: fromUniverse.symbol, name: fromUniverse.name, sector: fromUniverse.sector };
  }
  if (s === 'NIFTY' || s === 'SENSEX') {
    return { symbol: s, name: s === 'NIFTY' ? 'NIFTY 50' : 'SENSEX', sector: 'Index' };
  }
  return { symbol: s, name: s, sector: 'Equity' };
}

/**
 * Merge universe matches, nickname aliases, and direct ticker candidates (deduped).
 */
export function buildSearchCandidates(q, limit = 10) {
  const norm = normalizeStockSearchQuery(q);
  const lower = norm.toLowerCase();
  if (!norm) return [];

  const bySym = new Map();

  for (const row of searchUniverse(norm, limit)) {
    bySym.set(row.symbol, row);
  }

  const aliasSym = SEARCH_QUERY_TO_SYMBOL[lower];
  if (aliasSym) {
    const m = metaForSymbol(aliasSym);
    bySym.set(m.symbol, { symbol: m.symbol, name: m.name, sector: m.sector });
  }

  const ticker = norm.toUpperCase().replace(/\s+/g, '');
  if (TICKER_RE.test(ticker)) {
    const m = metaForSymbol(ticker);
    bySym.set(m.symbol, { symbol: m.symbol, name: m.name, sector: m.sector });
  }

  const out = [...bySym.values()];
  return out.slice(0, limit);
}

/**
 * Combine static-universe matches (instant, no API call) with dynamic Finnhub `/search`
 * results (any global company by name or ticker). The dynamic lookup is cached in-memory
 * inside the provider router, so typing the same query doesn't re-hit the API.
 *
 * The returned list keeps static priors first (highest relevance for our universe) and
 * fills the rest with fresh discoveries. Duplicates are merged by symbol.
 */
async function buildDynamicSearchCandidates(norm, limit) {
  const base = buildSearchCandidates(norm, limit);
  const bySym = new Map(base.map((r) => [r.symbol, r]));

  if (bySym.size >= limit) return [...bySym.values()].slice(0, limit);

  const remaining = limit - bySym.size;
  if (remaining <= 0) return [...bySym.values()];

  try {
    const discovered = await lookupSymbols(norm, { limit: remaining + 2 });
    for (const d of discovered) {
      if (bySym.has(d.symbol)) {
        const existing = bySym.get(d.symbol);
        if (existing.name === existing.symbol || existing.name === 'Equity') {
          bySym.set(d.symbol, { ...existing, name: d.name });
        }
        continue;
      }
      bySym.set(d.symbol, {
        symbol: d.symbol,
        name: d.name,
        sector: d.type && /etf/i.test(d.type) ? 'ETF' : 'Equity',
      });
      if (bySym.size >= limit) break;
    }
  } catch (e) {
    stockDebug('search:lookup-fail', { message: e?.message || String(e) });
  }

  return [...bySym.values()].slice(0, limit);
}

/**
 * Search with live quote fields merged from snapshot or a targeted quote fetch.
 * Any company on Finnhub (free plan supports US listings) is now searchable by name or ticker.
 */
export async function searchWithLiveQuotes(q, limit = 10) {
  const norm = normalizeStockSearchQuery(q);
  stockDebug('search:in', { query: norm, limit });

  if (!norm) {
    return [];
  }

  const base = await buildDynamicSearchCandidates(norm, limit);
  stockDebug('search:candidates', { symbols: base.map((b) => b.symbol) });

  const snap = getMarketSnapshot();
  const merged = [];
  const needFetch = [];
  for (const row of base) {
    const live = snap?.bySymbol?.[row.symbol];
    if (live && live.price != null) {
      merged.push({
        ...row,
        name: row.name || live.name || row.symbol,
        price: live.price,
        changePct: live.changePct,
        high: live.high,
        low: live.low,
        volume: live.volume,
        marketCapCr: live.marketCapCr,
      });
    } else {
      needFetch.push(row);
    }
  }
  if (!needFetch.length) {
    stockDebug('search:out', { count: merged.length, source: 'snapshot' });
    return merged;
  }

  try {
    const internals = needFetch.map((r) => r.symbol);
    const quotes = await fetchNormalizedQuotesForInternals(internals);
    stockDebug('external:batch', {
      source: marketDataSource(),
      requested: internals,
      got: quotes.map((x) => x.symbol),
    });
    const byInternal = Object.fromEntries(quotes.map((qt) => [qt.symbol, qt]));
    for (const row of needFetch) {
      let quote = byInternal[row.symbol];
      if (!quote || quote.price == null) {
        quote = await fetchSingleQuoteByInternal(row.symbol);
        stockDebug('external:single', {
          symbol: row.symbol,
          source: marketDataSource(),
          summary: quote
            ? { price: quote.price, change_percent: quote.change_percent, name: quote._vendorName }
            : null,
        });
      }
      if (!quote || quote.price == null) {
        merged.push({ ...row, price: null, changePct: null });
        continue;
      }
      // Persist the searched symbol so DB-backed reads (StockDetailsCard, charts) work for it.
      // Prefer the human name from Finnhub's search payload (`row.name`) when the vendor
      // didn't include one — that way the cards show "Apple Inc." instead of "AAPL".
      const persistName = quote.company_name || row.name || quote._vendorName || row.symbol;
      await persistSingleStockRow(row.symbol, {
        ...quote,
        company_name: persistName,
      });
      merged.push({
        ...row,
        name: persistName,
        price: quote.price,
        changePct: quote.change_percent,
        high: quote.high,
        low: quote.low,
        volume: quote.volume,
        marketCapCr: quote.market_cap,
      });
    }
  } catch (e) {
    stockDebug('search:error', { message: e?.message || String(e) });
    for (const row of needFetch) merged.push({ ...row, price: null, changePct: null });
  }

  stockDebug('search:out', { count: merged.length });
  return merged;
}

/**
 * Historical / chart series — DB-first (`stock_chart_history`), vendor refresh only when stale.
 * Every vendor fetch is upserted into the DB so subsequent reads are served from Supabase.
 */
export async function getChartSeries(symbol, range) {
  const sym = (symbol || 'INFY').toUpperCase().trim();
  const r = ['1D', '1W', '1M', '1Y'].includes(range) ? range : '1D';

  const cached = await loadChartBars(sym, r);
  const lastTs = cached.length ? cached[cached.length - 1].t : 0;
  const isStale = !lastTs || Date.now() - lastTs > rangeStalenessMs(r);
  stockDebug('chart:db-read', { symbol: sym, range: r, bars: cached.length, isStale });

  if (cached.length && !isStale) {
    return { symbol: sym, range: r, points: cached, source: 'database' };
  }

  let stockRow = await getStockFromDb(sym);
  if (!stockRow) {
    try {
      const q = await fetchSingleQuoteByInternal(sym);
      if (q && q.price != null && q.change_percent != null) {
        await persistSingleStockRow(sym, q);
        stockRow = await getStockFromDb(sym);
      }
    } catch (e) {
      stockDebug('chart:parent-row-skip', { symbol: sym, message: e?.message });
    }
  }

  let points = [];
  try {
    const result = await fetchChartForInternal(sym, r);
    points = result?.points || [];
  } catch (e) {
    stockDebug('chart:vendor-error', { symbol: sym, range: r, message: e?.message });
  }

  if (points.length && stockRow) {
    await upsertChartBars(sym, r, points);
    return { symbol: sym, range: r, points, source: 'database-refreshed' };
  }
  if (cached.length) {
    return { symbol: sym, range: r, points: cached, source: 'database-stale' };
  }
  return { symbol: sym, range: r, points, source: points.length ? 'vendor' : 'empty' };
}

function mapDetailsFromSnap(fromSnap, sym) {
  return {
    symbol: sym,
    name: fromSnap.name,
    sector: fromSnap.sector,
    price: fromSnap.price,
    changePct: fromSnap.changePct,
    high: fromSnap.high,
    low: fromSnap.low,
    volume: fromSnap.volume ?? 0,
    marketCapCr: fromSnap.marketCapCr ?? 0,
    aiInsight: null,
  };
}

function mapDetailsFromDbRow(row, sym) {
  return {
    symbol: row.symbol,
    name: row.company_name,
    sector: sym === 'NIFTY' || sym === 'SENSEX' ? 'Index' : 'Equity',
    price: Number(row.price),
    changePct: Number(row.change_percent),
    high: row.high != null ? Number(row.high) : null,
    low: row.low != null ? Number(row.low) : null,
    volume: Number(row.volume) || 0,
    marketCapCr: row.market_cap != null ? Number(row.market_cap) : 0,
    aiInsight: null,
  };
}

function mapDetailsFromQuote(q, sym) {
  const meta = universeForSearch().find((u) => u.symbol === sym);
  const name = q._vendorName || q.company_name || meta?.name || sym;
  const sector = meta?.sector || (sym === 'NIFTY' || sym === 'SENSEX' ? 'Index' : 'Equity');
  return {
    symbol: sym,
    name,
    sector,
    price: q.price,
    changePct: q.change_percent,
    high: q.high,
    low: q.low,
    volume: q.volume ?? 0,
    marketCapCr: q.market_cap ?? 0,
    aiInsight: null,
  };
}

export async function resolveStockDetails(symbol) {
  const sym = (symbol || '').toUpperCase().trim();
  stockDebug('details:in', { symbol: sym });

  async function tryResolve() {
    const snap = getMarketSnapshot();
    const fromSnap = snap?.bySymbol?.[sym];
    if (fromSnap) {
      return mapDetailsFromSnap(fromSnap, sym);
    }

    const rows = await listStocksFromDb();
    const row = rows.find((r) => r.symbol === sym);
    if (row) {
      return mapDetailsFromDbRow(row, sym);
    }

    try {
      const q = await fetchSingleQuoteByInternal(sym);
      stockDebug('external:details', {
        symbol: sym,
        source: marketDataSource(),
        rawSummary: q
          ? {
              price: q.price,
              change_percent: q.change_percent,
              high: q.high,
              low: q.low,
              volume: q.volume,
              market_cap: q.market_cap,
              name: q._vendorName || q.company_name,
            }
          : null,
      });
      if (!q || q.price == null) return null;
      return mapDetailsFromQuote(q, sym);
    } catch (e) {
      stockDebug('details:vendorError', { symbol: sym, message: e?.message || String(e) });
      return null;
    }
  }

  let details = await tryResolve();
  if (!details) {
    await refreshLiveMarketSafe();
    details = await tryResolve();
  }

  const out = details ? attachPublicQuoteFields(details) : null;
  stockDebug('details:out', { symbol: sym, ok: Boolean(out) });
  return out;
}

export async function getTopGainersMerged() {
  const o = await ensureOverview();
  return o.topGainers || [];
}

export async function getTopLosersMerged() {
  const o = await ensureOverview();
  return o.topLosers || [];
}

/** @deprecated use getLiveQuotesMerged */
export function getSocketTickPayload() {
  const snap = getMarketSnapshot();
  if (!snap) return null;
  return {
    asOf: snap.asOf,
    indices: { nifty: snap.nifty, sensex: snap.sensex },
    cards: snap.marketCards,
    source: snap.source,
  };
}

/**
 * Legacy external hook — wire custom vendor here; Yahoo is used by default in engine.
 */
export async function fetchExternalQuote(symbol) {
  if (!symbol) return null;
  const sym = String(symbol).toUpperCase().trim();
  return fetchSingleQuoteByInternal(sym);
}
