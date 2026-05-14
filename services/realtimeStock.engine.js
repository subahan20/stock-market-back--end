import { env } from '../config/env.js';
import { getDb } from './db.service.js';
import {
  ALL_TRACKED_INTERNAL,
  MARKET_CARD_SYMBOLS,
  displayLabel,
} from '../constants/liveMarket.symbols.js';
import { STOCK_UNIVERSE } from '../constants/stockUniverse.js';
import {
  fetchNormalizedQuotesForInternals,
  fetchQuotesSequentialFallback,
  fetchSparklineForInternal,
  marketDataSource,
} from './providers/marketData.provider.js';
import { upsertChartBars, loadSparklineFromHistory } from './chartHistory.service.js';
import { persistAiForSymbol } from './ai.service.js';
import { emitAiUpdate } from '../websocket/ai.emit.js';

const SPARKLINE_POINTS = 14;
/** Minimum bars required in stock_chart_history before we skip the vendor sparkline call. */
const SPARKLINE_DB_MIN_BARS = 5;
/** Cumulative credit tally for daily logging. */
let creditsUsedToday = 0;
let creditsResetAt = nextUtcMidnightMs();

function nextUtcMidnightMs() {
  const d = new Date();
  d.setUTCHours(24, 0, 0, 0);
  return d.getTime();
}

function noteCreditsUsed(n) {
  if (!n) return;
  if (Date.now() >= creditsResetAt) {
    creditsUsedToday = 0;
    creditsResetAt = nextUtcMidnightMs();
  }
  creditsUsedToday += n;
}

export function getCreditsUsedToday() {
  return { used: creditsUsedToday, resetsAt: new Date(creditsResetAt).toISOString() };
}

const universeBySymbol = Object.fromEntries(STOCK_UNIVERSE.map((u) => [u.symbol, u]));

function companyName(internal) {
  if (internal === 'NIFTY') return 'NIFTY 50';
  if (internal === 'SENSEX') return 'SENSEX';
  return universeBySymbol[internal]?.name || internal;
}

function sectorFor(internal) {
  if (internal === 'NIFTY' || internal === 'SENSEX') return 'Index';
  return universeBySymbol[internal]?.sector || 'Equity';
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function withRetries(fn, { attempts = 3, baseDelayMs = 400 } = {}) {
  let last;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (i < attempts - 1) await sleep(baseDelayMs * (i + 1));
    }
  }
  throw last;
}

function finalizeQuoteRow(row) {
  const internal = row.symbol;
  return {
    symbol: internal,
    company_name: row.company_name || row._vendorName || companyName(internal),
    price: row.price,
    high: row.high,
    low: row.low,
    volume: row.volume ?? 0,
    market_cap: row.market_cap,
    change_percent: row.change_percent,
  };
}

let snapshot = null;
let lastError = null;
let lastRefreshAt = 0;

export function getMarketSnapshot() {
  return snapshot;
}

export function getLastEngineError() {
  return lastError;
}

export function getLastRefreshAt() {
  return lastRefreshAt;
}

/**
 * @returns {{ ok: boolean, count?: number, skipped?: boolean, reason?: string, error?: string }}
 */
async function persistRows(rows) {
  const valid = rows.filter((r) => r.price != null && r.change_percent != null);
  if (!valid.length) {
    return { ok: false, skipped: true, reason: 'no rows with price and change_percent' };
  }
  const db = getDb();
  if (!db) {
    // eslint-disable-next-line no-console
    console.warn(
      '[liveMarket] Supabase persist skipped: no admin client (set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).',
      `Would have saved ${valid.length} symbol(s).`
    );
    return { ok: false, skipped: true, reason: 'no_supabase_admin_client' };
  }
  const payload = valid.map((r) => ({
    symbol: r.symbol,
    company_name: r.company_name,
    price: r.price,
    high: r.high,
    low: r.low,
    volume: r.volume ?? 0,
    market_cap: r.market_cap,
    change_percent: r.change_percent,
    last_updated: new Date().toISOString(),
  }));
  const { error } = await db.from(env.tables.stocks).upsert(payload, { onConflict: 'symbol' });
  if (error) {
    // eslint-disable-next-line no-console
    console.warn('[liveMarket] Supabase upsert failed', error.message);
    return { ok: false, error: error.message, count: valid.length };
  }
  // eslint-disable-next-line no-console
  console.log('[liveMarket] DB upsert ok', {
    table: env.tables.stocks,
    symbols: valid.map((r) => r.symbol),
    count: valid.length,
  });
  return { ok: true, count: valid.length };
}

/** Re-read `stocks` after upsert so snapshot/socket match persisted rows (single display truth). */
async function reloadOverviewFromDatabase(sparklines, asOf) {
  const db = getDb();
  if (!db) return null;
  const { data, error } = await db
    .from(env.tables.stocks)
    .select('*')
    .order('symbol', { ascending: true });
  if (error) {
    // eslint-disable-next-line no-console
    console.warn('[liveMarket] reload overview from DB failed', error.message);
    return null;
  }
  if (!data?.length) return null;
  const overview = buildOverviewFromDbRows(data, sparklines, asOf);
  overview.source = `${marketDataSource()}-database`;
  overview.dataLayer = 'database';
  return overview;
}

function buildOverview(rowsBySymbol, sparklines, asOf) {
  const niftyRow = rowsBySymbol.NIFTY;
  const sensexRow = rowsBySymbol.SENSEX;
  const nifty = niftyRow
    ? { label: 'NIFTY 50', value: niftyRow.price, changePct: niftyRow.change_percent }
    : null;
  const sensex = sensexRow
    ? { label: 'SENSEX', value: sensexRow.price, changePct: sensexRow.change_percent }
    : null;

  const marketCards = MARKET_CARD_SYMBOLS.map((sym) => {
    const r = rowsBySymbol[sym];
    if (!r || r.price == null || r.change_percent == null) return null;
    const kind = sym === 'NIFTY' || sym === 'SENSEX' ? 'index' : 'stock';
    return {
      symbol: sym,
      label: displayLabel(sym),
      kind,
      value: r.price,
      changePct: r.change_percent,
      sparkline: sparklines[sym]?.length ? sparklines[sym] : [],
    };
  }).filter(Boolean);

  const activeSymbols = Object.keys(rowsBySymbol);
  const movers = activeSymbols.filter((s) => s !== 'NIFTY' && s !== 'SENSEX')
    .map((s) => {
      const r = rowsBySymbol[s];
      if (!r || r.price == null || r.change_percent == null) return null;
      return {
        symbol: s,
        name: r.company_name,
        price: r.price,
        changePct: r.change_percent,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.changePct - a.changePct);

  const topGainers = movers.slice(0, 5);
  const topLosers = [...movers].sort((a, b) => a.changePct - b.changePct).slice(0, 5);

  const bySymbol = {};
  for (const s of activeSymbols) {
    const r = rowsBySymbol[s];
    if (!r || r.price == null) continue;
    bySymbol[s] = {
      symbol: s,
      name: r.company_name,
      sector: sectorFor(s),
      price: r.price,
      changePct: r.change_percent,
      high: r.high,
      low: r.low,
      volume: r.volume,
      marketCapCr: r.market_cap,
    };
  }

  return {
    nifty,
    sensex,
    marketCards,
    topGainers,
    topLosers,
    bySymbol,
    asOf,
    source: marketDataSource(),
  };
}

/**
 * Full refresh: vendor quotes → Supabase → in-memory snapshot.
 */
function collectRowsBySymbolFromResults(results) {
  const rowsBySymbol = {};
  for (const raw of results) {
    const row = finalizeQuoteRow(raw);
    if (!ALL_TRACKED_INTERNAL.includes(row.symbol)) continue;
    if (row.price == null || row.change_percent == null) continue;
    rowsBySymbol[row.symbol] = row;
  }
  return rowsBySymbol;
}

export async function refreshLiveMarket() {
  let results = await withRetries(
    () => fetchNormalizedQuotesForInternals(ALL_TRACKED_INTERNAL),
    { attempts: 3, baseDelayMs: 600 }
  );

  let rowsBySymbol = collectRowsBySymbolFromResults(results);

  if (Object.keys(rowsBySymbol).length === 0) {
    // eslint-disable-next-line no-console
    console.warn('[liveMarket] batch quotes empty; trying sequential per-symbol fetch');
    results = await fetchQuotesSequentialFallback(ALL_TRACKED_INTERNAL);
    rowsBySymbol = collectRowsBySymbolFromResults(results);
  }

  if (Object.keys(rowsBySymbol).length === 0) {
    throw new Error('Live quote provider returned no usable rows for tracked symbols');
  }

  const asOf = new Date().toISOString();
  // Per-tick quote credits (Twelve Data: 1 credit per /quote call).
  noteCreditsUsed(Object.keys(rowsBySymbol).length);

  // Read sparklines from `stock_chart_history` first. Only call the vendor /time_series
  // endpoint when the DB has fewer than SPARKLINE_DB_MIN_BARS for a symbol (cold start).
  // Every successful vendor fetch is persisted so future ticks become DB-only.
  let sparklineVendorCalls = 0;
  const sparkEntries = await Promise.all(
    MARKET_CARD_SYMBOLS.map(async (sym) => {
      const fromDb = await loadSparklineFromHistory(sym, SPARKLINE_POINTS);
      if (fromDb.length >= SPARKLINE_DB_MIN_BARS) {
        return [sym, fromDb];
      }
      try {
        const line = await fetchSparklineForInternal(sym, SPARKLINE_POINTS);
        if (Array.isArray(line) && line.length) {
          sparklineVendorCalls += 1;
          // Persist these bars so the DB becomes the sparkline source from next tick onward.
          const nowMs = Date.now();
          const pts = line.map((v, i) => ({ t: nowMs - (line.length - 1 - i) * 60_000, v }));
          await upsertChartBars(sym, '1D', pts).catch(() => {});
          return [sym, line];
        }
        return [sym, fromDb];
      } catch {
        return [sym, fromDb];
      }
    })
  );
  noteCreditsUsed(sparklineVendorCalls);
  const sparklines = Object.fromEntries(sparkEntries);

  const persistRes = await persistRows(Object.values(rowsBySymbol));

  let overview = buildOverview(rowsBySymbol, sparklines, asOf);
  if (persistRes.ok && persistRes.count > 0) {
    const dbOverview = await reloadOverviewFromDatabase(sparklines, asOf);
    if (dbOverview?.bySymbol && Object.keys(dbOverview.bySymbol).length > 0) {
      overview = dbOverview;
    } else {
      // eslint-disable-next-line no-console
      console.warn('[liveMarket] persist succeeded but DB reload empty — using vendor snapshot');
    }
  } else if (!persistRes.ok && !persistRes.skipped) {
    // eslint-disable-next-line no-console
    console.warn('[liveMarket] DB persist failed — snapshot uses live vendor values only', persistRes);
  }

  snapshot = overview;
  lastRefreshAt = Date.now();
  lastError = null;

  // eslint-disable-next-line no-console
  console.log('[liveMarket] tick ok', {
    symbols: Object.keys(rowsBySymbol).length,
    sparklineVendorCalls,
    creditsUsedToday,
    creditsResetAt: new Date(creditsResetAt).toISOString(),
    intervalMs: env.marketBroadcastMs,
  });

  // Persist each headline card's latest price as a 1D bar in stock_chart_history
  // so the chart panel reads the same DB-backed value seen on the cards.
  if (persistRes.ok && persistRes.count > 0) {
    const nowMs = Date.now();
    await Promise.all(
      MARKET_CARD_SYMBOLS.map(async (sym) => {
        const r = overview.bySymbol?.[sym];
        if (!r?.price) return;
        try {
          await upsertChartBars(sym, '1D', [{ t: nowMs, v: Number(r.price) }]);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn('[liveMarket] chart_history tick upsert failed', sym, err?.message || err);
        }
      })
    );

    // Regenerate AI analysis for every tracked symbol from the just-persisted live row.
    // All numbers are derived from real DB values — no static text, no model API call.
    await Promise.all(
      Object.values(rowsBySymbol).map(async (row) => {
        try {
          const payload = await persistAiForSymbol(row);
          if (payload) emitAiUpdate(row.symbol, payload);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn('[liveMarket] AI persist failed', row.symbol, err?.message || err);
        }
      })
    );
  }

  const chartPoints = Object.fromEntries(
    MARKET_CARD_SYMBOLS.map((sym) => {
      const r = overview.bySymbol?.[sym];
      if (!r?.price) return [sym, null];
      return [sym, { t: Date.now(), v: r.price }];
    }).filter(([, v]) => v)
  );

  return { overview, chartPoints };
}

/**
 * When Yahoo fails, serve last DB rows (still real cached quotes, not synthetic).
 * @param {Record<string, number[]>} [sparklines] — optional vendor sparklines merged onto cards
 * @param {string} [asOf]
 */
export function buildOverviewFromDbRows(rows, sparklines, asOf) {
  const rowsBySymbol = {};
  for (const r of (rows || [])) {
    const sym = r?.symbol;
    if (!sym) continue;
    const price = Number(r.price);
    const chg = Number(r.change_percent);
    if (!Number.isFinite(price) || !Number.isFinite(chg)) continue;
    rowsBySymbol[sym] = {
      symbol: sym,
      company_name: r.company_name,
      price,
      high: r.high != null ? Number(r.high) : null,
      low: r.low != null ? Number(r.low) : null,
      volume: Number(r.volume) || 0,
      market_cap: r.market_cap != null ? Number(r.market_cap) : null,
      change_percent: chg,
    };
  }
  const emptySpark = Object.fromEntries(MARKET_CARD_SYMBOLS.map((s) => [s, []]));
  const sparks =
    sparklines && typeof sparklines === 'object' ? { ...emptySpark, ...sparklines } : emptySpark;
  const t = asOf || new Date().toISOString();
  const o = buildOverview(rowsBySymbol, sparks, t);
  return o;
}

export async function refreshLiveMarketSafe() {
  try {
    const { overview, chartPoints } = await refreshLiveMarket();
    return { overview, chartPoints, error: null };
  } catch (e) {
    lastError = e;
    // eslint-disable-next-line no-console
    console.warn('[liveMarket] refresh failed', e?.message || e);
    const db = getDb();
    if (db) {
      const { data, error: dbErr } = await db
        .from(env.tables.stocks)
        .select('*')
        .order('symbol', { ascending: true });
      if (dbErr) {
        // eslint-disable-next-line no-console
        console.warn('[liveMarket] Supabase cache read failed', dbErr.message || dbErr);
      }
      if (!dbErr && data?.length) {
        const overview = buildOverviewFromDbRows(data);
        overview.source = 'supabase-cache';
        overview.dataLayer = 'database';
        snapshot = overview;
        return { overview, chartPoints: null, error: e };
      }
    } else {
      // eslint-disable-next-line no-console
      console.warn(
        '[liveMarket] Supabase admin client missing — set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY for DB fallback'
      );
    }
    return { overview: snapshot, chartPoints: null, error: e };
  }
}
