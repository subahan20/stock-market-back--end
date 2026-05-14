import * as aiService from '../services/ai.service.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { assertSafeSymbol } from '../helpers/symbol.helpers.js';
import { emitAiUpdate } from '../websocket/ai.emit.js';
import { analyzeLiveMarketWithGroq } from '../services/groq.service.js';
import { getMarketSnapshot } from '../services/realtimeStock.engine.js';

/**
 * GET /ai/recommendations/:symbol
 * Returns the latest row from `public.ai_analysis`, or `data: null` when none exists.
 * The frontend renders an empty state on null (no fabricated narrative).
 */
export async function recommendations(req, res) {
  const symbol = assertSafeSymbol(req.params.symbol);
  const data = await aiService.getRecommendations(symbol);
  if (data) {
    emitAiUpdate(symbol, data);
  }
  sendSuccess(res, data, data ? 'AI recommendations' : 'No AI analysis stored for symbol');
}

/**
 * GET /ai/market-insights
 * Uses Groq to analyze the live market data from memory and returns an insight.
 */
export async function marketInsights(req, res) {
  const snapshot = getMarketSnapshot();
  if (!snapshot) {
    return sendSuccess(res, { error: 'No live market data available yet' }, 'Market snapshot not ready');
  }

  // Extract a smaller subset of data to avoid exceeding prompt limits
  const miniSnapshot = {
    nifty: snapshot.nifty,
    sensex: snapshot.sensex,
    topGainers: snapshot.topGainers,
    topLosers: snapshot.topLosers,
  };

  const insight = await analyzeLiveMarketWithGroq(miniSnapshot);
  sendSuccess(res, insight, 'Market insight generated');
}
