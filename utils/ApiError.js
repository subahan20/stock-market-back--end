export class ApiError extends Error {
  /** @param {Record<string, unknown>} [details] — optional JSON-safe diagnostics (e.g. dev-only). */
  constructor(message, statusCode = 400, details = undefined) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
    this.name = 'ApiError';
  }
}
