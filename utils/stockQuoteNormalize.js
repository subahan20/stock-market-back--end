/**
 * Canonical quote shape for API responses and logging (camelCase).
 * Input: normalized vendor row from marketData / DB-shaped fields.
 */
export function normalizeVendorQuoteToPublic(input) {
  if (!input || typeof input !== 'object') return null;
  const symbol = String(input.symbol || '').toUpperCase().trim();
  if (!symbol) return null;
  const price = input.price != null ? Number(input.price) : null;
  const changePercent =
    input.changePercent != null
      ? Number(input.changePercent)
      : input.changePct != null
        ? Number(input.changePct)
        : input.change_percent != null
          ? Number(input.change_percent)
          : null;
  const high = input.high != null ? Number(input.high) : null;
  const low = input.low != null ? Number(input.low) : null;
  const volume = input.volume != null ? Math.round(Number(input.volume)) : null;
  const marketCap =
    input.marketCap != null
      ? Number(input.marketCap)
      : input.marketCapCr != null
        ? Number(input.marketCapCr)
        : input.market_cap != null
          ? Number(input.market_cap)
          : null;
  const companyName =
    input.companyName ||
    input.company_name ||
    input.name ||
    input._vendorName ||
    symbol;

  return {
    symbol,
    companyName,
    price: Number.isFinite(price) ? price : null,
    high: Number.isFinite(high) ? high : null,
    low: Number.isFinite(low) ? low : null,
    volume: volume != null && Number.isFinite(volume) ? volume : null,
    marketCap: marketCap != null && Number.isFinite(marketCap) ? marketCap : null,
    changePercent:
      changePercent != null && Number.isFinite(changePercent) ? changePercent : null,
  };
}

/** Merge public fields into legacy stock details payload (keeps aiInsight, sector, etc.). */
export function attachPublicQuoteFields(details) {
  if (!details) return null;
  const n = normalizeVendorQuoteToPublic(details);
  if (!n) return details;
  return {
    ...details,
    companyName: n.companyName,
    changePercent: n.changePercent,
    marketCap: n.marketCap ?? details.marketCapCr,
  };
}
