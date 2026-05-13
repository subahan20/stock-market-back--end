import * as aiService from '../services/ai.service.js';
import { sendSuccess } from '../utils/apiResponse.js';
import { assertSafeSymbol } from '../helpers/symbol.helpers.js';
import { emitAiUpdate } from '../websocket/ai.emit.js';

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
