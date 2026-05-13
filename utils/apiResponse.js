export function sendSuccess(res, data, message = 'Success', status = 200) {
  return res.status(status).json({ success: true, message, data });
}

export function sendError(res, message, status = 400) {
  return res.status(status).json({ success: false, message });
}

/** Legacy Vite/React client expects `{ ok, data }` for `/market/*` routes. */
export function sendLegacySuccess(res, data, status = 200) {
  return res.status(status).json({ ok: true, data });
}

export function sendLegacyError(res, message, status = 400) {
  return res.status(status).json({ ok: false, error: message });
}
