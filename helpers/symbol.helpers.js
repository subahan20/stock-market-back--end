import { ApiError } from '../utils/ApiError.js';
import { HTTP_STATUS } from '../constants/index.js';

const SAFE = /^[A-Z0-9^.-]{1,32}$/i;

export function normalizeSymbol(raw) {
  if (raw == null) return '';
  return String(raw).trim().toUpperCase();
}

export function assertSafeSymbol(symbol) {
  const s = normalizeSymbol(symbol);
  if (!s || !SAFE.test(s)) {
    throw new ApiError('Invalid symbol', HTTP_STATUS.BAD_REQUEST);
  }
  return s;
}
