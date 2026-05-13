import { env } from '../config/env.js';
import { EVENTS } from './events.js';
import { getIO } from './io.registry.js';

function stockDebug(...args) {
  if (env.debugStock) {
    // eslint-disable-next-line no-console
    console.log('[stock:socket]', ...args);
  }
}

/**
 * Push a single-symbol quote to clients without replacing the full market map.
 * Frontend merges `bySymbol` with existing state.
 */
export function emitFocusedStockAndChartTick(details) {
  if (!details?.symbol || details.price == null) return;
  const io = getIO();
  if (!io) return;

  const sym = String(details.symbol).toUpperCase();
  const row = {
    symbol: sym,
    name: details.name,
    sector: details.sector,
    price: details.price,
    changePct: details.changePct,
    high: details.high,
    low: details.low,
    volume: details.volume,
    marketCapCr: details.marketCapCr,
  };
  const asOf = new Date().toISOString();

  io.emit(EVENTS.STOCK_UPDATE, {
    success: true,
    message: `Stock update: ${sym}`,
    data: {
      bySymbol: { [sym]: row },
      asOf,
      partial: true,
    },
  });

  io.emit(EVENTS.CHART_UPDATE, {
    success: true,
    message: 'Chart tick',
    data: {
      points: [{ symbol: sym, t: Date.now(), v: details.price }],
    },
  });

  stockDebug('emit', sym, { price: details.price, asOf });
}
