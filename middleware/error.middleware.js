import { ApiError } from '../utils/ApiError.js';

function isLegacyMarketRoute(req) {
  return String(req.originalUrl || '').includes('/market/');
}

export function errorMiddleware(err, req, res, next) {
  if (res.headersSent) {
    next(err);
    return;
  }
  const status = err instanceof ApiError ? err.statusCode : err.status || 500;
  const message = err.message || 'Something went wrong';
  if (isLegacyMarketRoute(req)) {
    const legacy = { ok: false, error: message };
    if (err instanceof ApiError && err.details != null) legacy.details = err.details;
    res.status(status).json(legacy);
    return;
  }
  const body = { success: false, message };
  if (err instanceof ApiError && err.details != null) body.details = err.details;
  res.status(status).json(body);
}
