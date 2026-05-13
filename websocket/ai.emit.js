import { EVENTS } from './events.js';
import { getIO } from './io.registry.js';

/** Broadcast latest AI row for a symbol (after DB write or external model). */
export function emitAiUpdate(symbol, data) {
  const io = getIO();
  if (!io || !symbol || !data) return;
  io.emit(EVENTS.AI_UPDATE, {
    success: true,
    message: `AI insight: ${symbol}`,
    data: { symbol: String(symbol).toUpperCase(), ...data },
  });
}
