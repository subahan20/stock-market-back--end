/**
 * Row → DTO mappers when responses need shaping beyond raw Supabase rows.
 */
export function mapAlertRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    symbol: row.symbol,
    thresholdType: row.threshold_type,
    thresholdValue: row.threshold_value,
    note: row.note,
    createdAt: row.created_at,
  };
}
