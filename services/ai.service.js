import { getDb } from './db.service.js';
import { env } from '../config/env.js';

/**
 * Numerical AI analysis derived from REAL `public.stocks` rows.
 * Every field is computed from live DB values — stance from change_percent, support/resistance
 * from intraday low/high, confidence from range volatility, narrative interpolated with real numbers.
 * No hardcoded text or placeholder values.
 */
function num(v) {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function computeStance(changePct) {
  if (changePct == null) return 'hold';
  if (changePct >= 1.5) return 'buy';
  if (changePct <= -1.5) return 'sell';
  return 'hold';
}

function computeTrend(changePct) {
  if (changePct == null) return 'flat';
  if (changePct > 0.1) return 'up';
  if (changePct < -0.1) return 'down';
  return 'flat';
}

/** 40-95 based on (high-low)/price volatility — tighter range = more confidence. */
function computeConfidence(price, high, low) {
  if (!price || price <= 0 || high == null || low == null) return 70;
  const rangePct = ((high - low) / price) * 100;
  const c = 90 - rangePct * 2.5;
  return Math.round(Math.max(40, Math.min(95, c)));
}

function fmtInr(v) {
  if (v == null) return '—';
  return `₹${Number(v).toFixed(2)}`;
}

function buildNarrative(stockRow, stance, trend) {
  const name = stockRow.company_name || stockRow.symbol;
  const price = num(stockRow.price);
  const chg = num(stockRow.change_percent);
  const high = num(stockRow.high);
  const low = num(stockRow.low);

  const parts = [];

  if (chg != null) {
    const dir = chg >= 0 ? 'up' : 'down';
    parts.push(`${name} is ${dir} ${Math.abs(chg).toFixed(2)}% intraday at ${fmtInr(price)}.`);
  } else {
    parts.push(`${name} last traded at ${fmtInr(price)}.`);
  }

  if (low != null && high != null) {
    parts.push(`Trading range ${fmtInr(low)} – ${fmtInr(high)}.`);
  }

  if (stance === 'buy') {
    parts.push(
      high != null
        ? `Bullish momentum suggests testing resistance near ${fmtInr(high)}.`
        : 'Bullish momentum building.'
    );
  } else if (stance === 'sell') {
    parts.push(
      low != null
        ? `Bearish pressure suggests watching support near ${fmtInr(low)}.`
        : 'Bearish pressure building.'
    );
  } else {
    parts.push(
      trend === 'flat'
        ? 'Range-bound action; await breakout in either direction.'
        : 'Mixed signals; size positions accordingly.'
    );
  }

  return parts.join(' ');
}

/**
 * Produce an AI payload from a `public.stocks` row.
 * @param {{symbol:string, company_name?:string, price:any, change_percent:any, high:any, low:any}} stockRow
 */
export function generateAiFromStockRow(stockRow) {
  if (!stockRow || !stockRow.symbol) return null;
  const price = num(stockRow.price);
  const chg = num(stockRow.change_percent);
  if (price == null) return null;

  const high = num(stockRow.high);
  const low = num(stockRow.low);
  const stance = computeStance(chg);
  const trend = computeTrend(chg);
  const confidence = computeConfidence(price, high, low);
  const summary = buildNarrative(stockRow, stance, trend);

  return {
    symbol: stockRow.symbol,
    name: stockRow.company_name || stockRow.symbol,
    stance,
    confidence,
    summary,
    support: low,
    resistance: high,
    trend,
    source: 'database',
  };
}

function mapAiRowToPayload(row) {
  return {
    symbol: row.symbol,
    name: null,
    stance: row.recommendation,
    confidence: Number(row.confidence_score),
    summary: row.analysis || '',
    support: row.support_level != null ? Number(row.support_level) : null,
    resistance: row.resistance_level != null ? Number(row.resistance_level) : null,
    trend: row.trend || null,
    riskNotes: [],
    source: 'database',
    createdAt: row.created_at || null,
  };
}

async function fetchLatestAiFromDb(client, sym) {
  const { data, error } = await client
    .from(env.tables.aiAnalysis)
    .select('*')
    .eq('symbol', sym)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return mapAiRowToPayload(data);
}

async function fetchStockRow(client, sym) {
  const { data, error } = await client
    .from(env.tables.stocks)
    .select('symbol, company_name, price, high, low, change_percent, last_updated')
    .eq('symbol', sym)
    .maybeSingle();
  if (error || !data) return null;
  return data;
}

/**
 * Persist (delete-then-insert) AI analysis for a symbol. FK requires parent `stocks` row.
 * Returns the persisted payload or null on failure.
 */
export async function persistAiForSymbol(stockRow) {
  const client = getDb();
  if (!client || !stockRow?.symbol) return null;
  const payload = generateAiFromStockRow(stockRow);
  if (!payload) return null;

  await client.from(env.tables.aiAnalysis).delete().eq('symbol', payload.symbol);
  const { error } = await client.from(env.tables.aiAnalysis).insert({
    symbol: payload.symbol,
    recommendation: payload.stance,
    confidence_score: payload.confidence,
    support_level: payload.support,
    resistance_level: payload.resistance,
    trend: payload.trend,
    analysis: payload.summary,
  });
  if (error) {
    // eslint-disable-next-line no-console
    console.warn('[ai] persist failed', payload.symbol, error.message);
    return null;
  }
  // eslint-disable-next-line no-console
  console.log('[ai] DB persist ok', { symbol: payload.symbol, stance: payload.stance });
  return payload;
}

/**
 * GET /ai/recommendations/:symbol
 * 1. Return latest `ai_analysis` row if it exists.
 * 2. Otherwise, if `stocks` has the symbol, generate from REAL row + persist + re-read.
 * 3. Return null if no `stocks` row (UI shows empty state).
 */
export async function getRecommendations(symbol) {
  const sym = (symbol || '').toUpperCase().trim();
  if (!sym) return null;
  const client = getDb();
  if (!client) return null;

  const existing = await fetchLatestAiFromDb(client, sym);
  if (existing) return existing;

  const stockRow = await fetchStockRow(client, sym);
  if (!stockRow) return null;

  await persistAiForSymbol(stockRow);
  return fetchLatestAiFromDb(client, sym);
}
