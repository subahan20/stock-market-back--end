import * as stockService from '../services/stock.service.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { ApiError } from '../utils/ApiError.js';
import { HTTP_STATUS } from '../constants/index.js';
import { assertSafeSymbol } from '../helpers/symbol.helpers.js';
import { emitFocusedStockAndChartTick } from '../websocket/focusedStock.emit.js';

export async function live(req, res) {
  const data = await stockService.getLiveQuotesMerged();
  sendSuccess(res, data, 'Live quotes');
}

export async function history(req, res) {
  const symbol = assertSafeSymbol(req.params.symbol);
  const range = req.query.range || '1D';
  const data = await stockService.getChartSeries(symbol, range);
  sendSuccess(res, data, 'Historical series');
}

export async function analysis(req, res) {
  const symbol = assertSafeSymbol(req.params.symbol);
  const details = await stockService.resolveStockDetails(symbol);
  if (!details) {
    throw new ApiError(`No stock data found for symbol ${symbol}`, HTTP_STATUS.NOT_FOUND);
  }
  emitFocusedStockAndChartTick(details);
  sendSuccess(res, { fundamentals: details, note: 'Add external analyst data in stock.service' }, 'Analysis bundle');
}

/** Canonical UI payload — same shape legacy `/market/stocks/:symbol/details` returned in `data`. */
export async function details(req, res) {
  const symbol = assertSafeSymbol(req.params.symbol);
  const data = await stockService.resolveStockDetails(symbol);
  if (!data) {
    throw new ApiError(`No stock data found for symbol ${symbol}`, HTTP_STATUS.NOT_FOUND);
  }
  emitFocusedStockAndChartTick(data);
  sendSuccess(res, data, 'Stock details');
}

/** DB-only details (Supabase `stocks` table). No vendor fetch, no socket emit. */
export async function detailsFromDb(req, res) {
  const symbol = assertSafeSymbol(req.params.symbol);
  const data = await stockService.getStockFromDb(symbol);
  if (!data) {
    throw new ApiError(`No stored data for symbol ${symbol}`, HTTP_STATUS.NOT_FOUND);
  }
  sendSuccess(res, data, 'Stock details from database');
}

export async function search(req, res) {
  const raw = req.query.q ?? req.query.query ?? '';
  const q = stockService.normalizeStockSearchQuery(raw);
  const limit = Math.min(Number(req.query.limit) || 10, 50);
  const data = await stockService.searchWithLiveQuotes(q, limit);
  sendSuccess(res, data, 'Search results');
}

export async function topGainers(req, res) {
  const rows = await stockService.getTopGainersMerged();
  sendSuccess(res, rows, 'Top gainers');
}

export async function topLosers(req, res) {
  const rows = await stockService.getTopLosersMerged();
  sendSuccess(res, rows, 'Top losers');
}

export async function marketOverview(req, res) {
  const data = await stockService.getOverviewPayloadMerged();
  sendSuccess(res, data, 'Market overview');
}
