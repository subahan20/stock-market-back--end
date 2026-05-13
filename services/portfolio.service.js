import { getSupabaseAdmin } from '../config/supabase.js';
import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';
import { HTTP_STATUS } from '../constants/index.js';

function db() {
  const admin = getSupabaseAdmin();
  if (!admin) {
    throw new ApiError('Database unavailable (configure Supabase)', HTTP_STATUS.SERVICE_UNAVAILABLE);
  }
  return admin;
}

function num(v) {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Enrich raw portfolio rows by joining with `public.stocks` to compute current value, P&L.
 * @returns {{holdings:Array, totals:{invested:number, currentValue:number, pnl:number, pnlPct:number|null, dayChange:number|null}}}
 */
function enrichPortfolio(portfolioRows, stockRows) {
  const bySymbol = new Map();
  for (const s of stockRows) {
    bySymbol.set(s.symbol, s);
  }

  let invested = 0;
  let currentValue = 0;
  let dayChange = 0;
  let hasDayChange = false;

  const holdings = portfolioRows.map((row) => {
    const qty = num(row.quantity) ?? 0;
    const avg = num(row.average_buy_price) ?? 0;
    const investedRow = num(row.total_investment) ?? qty * avg;
    const stock = bySymbol.get(row.stock_symbol) || null;
    const livePrice = stock ? num(stock.price) : null;
    const changePct = stock ? num(stock.change_percent) : null;
    const value = livePrice != null ? qty * livePrice : null;
    const pnl = value != null ? value - investedRow : null;
    const pnlPct = pnl != null && investedRow > 0 ? (pnl / investedRow) * 100 : null;
    const rowDayChange = value != null && changePct != null ? (value * changePct) / 100 : null;

    invested += investedRow;
    if (value != null) currentValue += value;
    if (rowDayChange != null) {
      dayChange += rowDayChange;
      hasDayChange = true;
    }

    return {
      id: row.id,
      symbol: row.stock_symbol,
      name: stock?.company_name || row.stock_symbol,
      quantity: qty,
      averageBuyPrice: avg,
      totalInvestment: investedRow,
      currentPrice: livePrice,
      changePct,
      currentValue: value,
      pnl,
      pnlPct,
      lastUpdated: stock?.last_updated || null,
    };
  });

  const totalPnl = currentValue ? currentValue - invested : null;
  const totalPnlPct = totalPnl != null && invested > 0 ? (totalPnl / invested) * 100 : null;

  return {
    holdings,
    totals: {
      invested,
      currentValue: currentValue || null,
      pnl: totalPnl,
      pnlPct: totalPnlPct,
      dayChange: hasDayChange ? dayChange : null,
    },
  };
}

/** Raw rows from `public.portfolio` (no live join — kept for callers that already join elsewhere). */
export async function listPortfolioRaw(userId) {
  const { data, error } = await db()
    .from(env.tables.portfolio)
    .select('*')
    .eq('user_id', userId)
    .order('stock_symbol', { ascending: true });
  if (error) {
    if (error.code === 'PGRST116' || error.message?.includes('relation') || error.code === '42P01') {
      return [];
    }
    throw new ApiError(error.message, HTTP_STATUS.BAD_REQUEST);
  }
  return data || [];
}

/**
 * Portfolio rows joined with live quotes from `public.stocks`. Empty arrays when no holdings.
 */
export async function listPortfolio(userId) {
  const rows = await listPortfolioRaw(userId);
  if (!rows.length) {
    return enrichPortfolio([], []);
  }
  const symbols = [...new Set(rows.map((r) => r.stock_symbol))];
  const { data: stockRows, error } = await db()
    .from(env.tables.stocks)
    .select('symbol, company_name, price, change_percent, last_updated')
    .in('symbol', symbols);
  if (error && !(error.code === '42P01' || error.message?.includes('relation'))) {
    throw new ApiError(error.message, HTTP_STATUS.BAD_REQUEST);
  }
  return enrichPortfolio(rows, stockRows || []);
}
