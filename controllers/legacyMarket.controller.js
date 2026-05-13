import * as stockService from '../services/stock.service.js';
import { sendLegacySuccess } from '../utils/apiResponse.js';
import { assertSafeSymbol } from '../helpers/symbol.helpers.js';
import { ApiError } from '../utils/ApiError.js';
import { HTTP_STATUS } from '../constants/index.js';
import { emitFocusedStockAndChartTick } from '../websocket/focusedStock.emit.js';

export async function overview(req, res) {
  sendLegacySuccess(res, await stockService.getOverviewPayloadMerged());
}

export async function search(req, res) {
  const raw = req.query.q ?? req.query.query ?? '';
  const q = stockService.normalizeStockSearchQuery(raw);
  const data = await stockService.searchWithLiveQuotes(q, 10);
  sendLegacySuccess(res, data);
}

export async function stockDetails(req, res) {
  const sym = assertSafeSymbol(req.params.symbol);
  const details = await stockService.resolveStockDetails(sym);
  if (!details) {
    throw new ApiError(`No stock data found for symbol ${sym}`, HTTP_STATUS.NOT_FOUND);
  }
  emitFocusedStockAndChartTick(details);
  sendLegacySuccess(res, details);
}

export async function chart(req, res) {
  const sym = assertSafeSymbol(req.params.symbol);
  const range = typeof req.query.range === 'string' ? req.query.range : '1D';
  const allowed = ['1D', '1W', '1M', '1Y'];
  const r = allowed.includes(range) ? range : '1D';
  const data = await stockService.getChartSeries(sym, r);
  sendLegacySuccess(res, data);
}
