import { env } from '../config/env.js';
import { getDb } from './db.service.js';

const VALID_RANGES = new Set(['1D', '1W', '1M', '1Y']);

/** Per-range staleness so we only call vendors when truly needed. */
const RANGE_STALENESS_MS = {
  '1D': 6 * 60 * 1000,
  '1W': 90 * 60 * 1000,
  '1M': 25 * 60 * 60 * 1000,
  '1Y': 8 * 24 * 60 * 60 * 1000,
};

export function rangeStalenessMs(rangeKey) {
  return RANGE_STALENESS_MS[rangeKey] || RANGE_STALENESS_MS['1D'];
}

/**
 * Upsert (symbol, range, t) → v bars into `stock_chart_history`.
 * Caller must ensure the parent `stocks` row exists (FK constraint).
 */
export async function upsertChartBars(symbol, rangeKey, points) {
  if (!VALID_RANGES.has(rangeKey)) return { ok: false, skipped: true, reason: 'invalid_range' };
  const sym = String(symbol || '').toUpperCase().trim();
  if (!sym || !Array.isArray(points) || !points.length) {
    return { ok: false, skipped: true, reason: 'empty_points' };
  }
  const db = getDb();
  if (!db) return { ok: false, skipped: true, reason: 'no_supabase_admin_client' };

  const nowIso = new Date().toISOString();
  const payload = points
    .filter((p) => p && Number.isFinite(Number(p.t)) && Number.isFinite(Number(p.v)))
    .map((p) => ({
      symbol: sym,
      range_key: rangeKey,
      bar_t: Math.round(Number(p.t)),
      bar_v: Number(p.v),
      last_updated: nowIso,
    }));
  if (!payload.length) return { ok: false, skipped: true, reason: 'no_finite_points' };

  const { error } = await db
    .from(env.tables.stockChartHistory)
    .upsert(payload, { onConflict: 'symbol,range_key,bar_t' });
  if (error) {
    // eslint-disable-next-line no-console
    console.warn('[chart-history] upsert failed', error.message);
    return { ok: false, error: error.message };
  }
  // eslint-disable-next-line no-console
  console.log('[chart-history] DB upsert ok', {
    table: env.tables.stockChartHistory,
    symbol: sym,
    range: rangeKey,
    bars: payload.length,
  });
  return { ok: true, count: payload.length };
}

/** Read cached bars sorted ascending by `bar_t`. */
export async function loadChartBars(symbol, rangeKey, maxBars = 480) {
  if (!VALID_RANGES.has(rangeKey)) return [];
  const sym = String(symbol || '').toUpperCase().trim();
  if (!sym) return [];
  const db = getDb();
  if (!db) return [];

  const { data, error } = await db
    .from(env.tables.stockChartHistory)
    .select('bar_t, bar_v')
    .eq('symbol', sym)
    .eq('range_key', rangeKey)
    .order('bar_t', { ascending: true })
    .limit(maxBars);
  if (error) {
    // eslint-disable-next-line no-console
    console.warn('[chart-history] load failed', error.message);
    return [];
  }
  return (data || []).map((r) => ({ t: Number(r.bar_t), v: Number(r.bar_v) }));
}

/**
 * Sparkline-friendly read: latest N values for (symbol, 1D), oldest → newest.
 * Returns just an array of numbers (matches the previous vendor sparkline shape).
 */
export async function loadSparklineFromHistory(symbol, maxPoints = 14) {
  const sym = String(symbol || '').toUpperCase().trim();
  const db = getDb();
  if (!db || !sym) return [];
  const { data, error } = await db
    .from(env.tables.stockChartHistory)
    .select('bar_t, bar_v')
    .eq('symbol', sym)
    .eq('range_key', '1D')
    .order('bar_t', { ascending: false })
    .limit(maxPoints);
  if (error || !data?.length) return [];
  return data
    .slice()
    .reverse()
    .map((r) => Number(r.bar_v))
    .filter((n) => Number.isFinite(n));
}

/** Latest bar timestamp for staleness checks. */
export async function lastBarTimestamp(symbol, rangeKey) {
  const sym = String(symbol || '').toUpperCase().trim();
  const db = getDb();
  if (!db || !sym) return 0;
  const { data, error } = await db
    .from(env.tables.stockChartHistory)
    .select('bar_t')
    .eq('symbol', sym)
    .eq('range_key', rangeKey)
    .order('bar_t', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return 0;
  return Number(data.bar_t) || 0;
}
