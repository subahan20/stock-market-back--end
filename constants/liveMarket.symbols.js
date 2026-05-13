import { STOCK_UNIVERSE } from './stockUniverse.js';

/**
 * Dashboard headline cards (internal symbol keys).
 *
 * Twelve Data free plan supports:
 *   - All major US/NASDAQ tickers (AAPL, MSFT, TSLA, NVDA, GOOGL, AMZN, …)
 *   - A very limited set of NSE symbols (INFY is one of the few free-tier-allowed ones).
 *
 * NSE/BSE indices (NIFTY_50, SENSEX) and most NSE equities (RELIANCE, TCS, HDFCBANK)
 * require Twelve Data Grow plan or higher. Add them back here once you upgrade.
 */
export const MARKET_CARD_SYMBOLS = ['INFY', 'AAPL', 'MSFT', 'TSLA', 'NVDA', 'GOOGL'];

/**
 * Symbols the live job fetches every broadcast tick. Kept tight to fit the Twelve Data
 * free 8-credits/minute budget (Yahoo fallback removed). Search/details/charts for any
 * other ticker still work — they are fetched on-demand and persisted via
 * `persistSingleStockRow` (see backend/services/stock.service.js).
 *
 * To track more symbols continuously, upgrade the Twelve plan and append here, or set
 * SUPABASE_TABLE_STOCKS-backed `ALL_TRACKED_INTERNAL` via env in the future.
 */
export const ALL_TRACKED_INTERNAL = [...MARKET_CARD_SYMBOLS];

export function displayLabel(internal) {
  const s = String(internal || '').toUpperCase();
  if (s === 'INFY') return 'INFOSYS';
  if (s === 'HDFCBANK') return 'HDFC';
  return s;
}

/**
 * Twelve Data `symbol` + `exchange` (see https://api.twelvedata.com/quote ).
 * Empty `exchange` omits the query param (Twelve resolves many US listings without it).
 */
export const INTERNAL_TO_TWELVE_DATA = {
  NIFTY: { symbol: 'NIFTY_50', exchange: 'NSE' },
  SENSEX: { symbol: 'SENSEX', exchange: 'BSE' },
  AAPL: { symbol: 'AAPL', exchange: 'NASDAQ' },
  MSFT: { symbol: 'MSFT', exchange: 'NASDAQ' },
  TSLA: { symbol: 'TSLA', exchange: 'NASDAQ' },
  NVDA: { symbol: 'NVDA', exchange: 'NASDAQ' },
  GOOGL: { symbol: 'GOOGL', exchange: 'NASDAQ' },
  AMZN: { symbol: 'AMZN', exchange: 'NASDAQ' },
  RELIANCE: { symbol: 'RELIANCE', exchange: 'NSE' },
  TCS: { symbol: 'TCS', exchange: 'NSE' },
  INFY: { symbol: 'INFY', exchange: 'NSE' },
  HDFCBANK: { symbol: 'HDFCBANK', exchange: 'NSE' },
  ICICIBANK: { symbol: 'ICICIBANK', exchange: 'NSE' },
  SBIN: { symbol: 'SBIN', exchange: 'NSE' },
  BHARTIARTL: { symbol: 'BHARTIARTL', exchange: 'NSE' },
  ITC: { symbol: 'ITC', exchange: 'NSE' },
  LT: { symbol: 'LT', exchange: 'NSE' },
  WIPRO: { symbol: 'WIPRO', exchange: 'NSE' },
  HINDUNILVR: { symbol: 'HINDUNILVR', exchange: 'NSE' },
  MARUTI: { symbol: 'MARUTI', exchange: 'NSE' },
};

for (const u of STOCK_UNIVERSE) {
  if (!INTERNAL_TO_TWELVE_DATA[u.symbol]) {
    INTERNAL_TO_TWELVE_DATA[u.symbol] =
      u.region === 'US' ? { symbol: u.symbol, exchange: '' } : { symbol: u.symbol, exchange: 'NSE' };
  }
}

export function toTwelveDataPair(internal) {
  const s = String(internal || '').toUpperCase().trim();
  if (INTERNAL_TO_TWELVE_DATA[s]) return INTERNAL_TO_TWELVE_DATA[s];
  if (/^[A-Z]{1,5}$/.test(s)) return { symbol: s, exchange: '' };
  return { symbol: s, exchange: 'NSE' };
}
