import { env } from '../config/env.js';
import { EVENTS } from '../websocket/events.js';
import { refreshLiveMarketSafe } from '../services/realtimeStock.engine.js';

function emitMarket(io, overview, chartPoints) {
  if (!overview) return;

  io.emit(EVENTS.MARKET_UPDATE, {
    success: true,
    message: 'Market overview',
    data: {
      nifty: overview.nifty,
      sensex: overview.sensex,
      marketCards: overview.marketCards,
      asOf: overview.asOf,
      source: overview.source,
    },
  });

  io.emit(EVENTS.STOCK_UPDATE, {
    success: true,
    message: 'Stock map',
    data: {
      bySymbol: overview.bySymbol || {},
      asOf: overview.asOf,
      partial: false,
    },
  });

  if (chartPoints && Object.keys(chartPoints).length) {
    io.emit(EVENTS.CHART_UPDATE, {
      success: true,
      message: 'Chart tick',
      data: {
        points: Object.entries(chartPoints).map(([symbol, p]) => (p ? { symbol, ...p } : null)).filter(Boolean),
      },
    });
  }

  io.emit(EVENTS.GAINERS_UPDATE, {
    success: true,
    message: 'Top gainers',
    data: overview.topGainers || [],
  });

  io.emit(EVENTS.LOSERS_UPDATE, {
    success: true,
    message: 'Top losers',
    data: overview.topLosers || [],
  });
}

export function startLiveMarketJob(io) {
  const intervalMs = Math.max(3000, env.marketBroadcastMs);

  const tick = async () => {
    try {
      const { overview, chartPoints } = await refreshLiveMarketSafe();
      emitMarket(io, overview, chartPoints);
    } catch {
      /* refreshLiveMarketSafe already logs */
    }
  };

  tick();
  const id = setInterval(tick, intervalMs);
  return () => clearInterval(id);
}
