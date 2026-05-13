/**
 * Health check keeps `{ ok }` shape for the existing Vite/React `apiFetch('/v1/health', { skipAuth: true })` call.
 */
export function getHealth(req, res) {
  res.json({
    ok: true,
    success: true,
    service: 'stock-dashboard-backend',
    time: new Date().toISOString(),
  });
}
