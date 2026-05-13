import { getSupabaseAdmin } from '../config/supabase.js';
import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';
import { HTTP_STATUS } from '../constants/index.js';

function db() {
  const admin = getSupabaseAdmin();
  if (!admin) {
    throw new ApiError('Database unavailable (configure Supabase)', HTTP_STATUS.SERVICE_UNAVAILABLE);
  }
  return admin;
}

export async function createAlert(userId, payload) {
  const row = {
    user_id: userId,
    symbol: payload.symbol.toUpperCase(),
    threshold_type: payload.thresholdType || 'price_above',
    threshold_value: Number(payload.thresholdValue),
    note: payload.note || null,
    created_at: new Date().toISOString(),
  };
  const { data, error } = await db().from(env.tables.alerts).insert(row).select().single();
  if (error) {
    if (error.message?.includes('relation') || error.code === '42P01') {
      throw new ApiError(
        `Table "${env.tables.alerts}" missing. Run migrations in backend/migrations (001–008).`,
        HTTP_STATUS.SERVICE_UNAVAILABLE
      );
    }
    throw new ApiError(error.message, HTTP_STATUS.BAD_REQUEST);
  }
  return data;
}

export async function listAlerts(userId) {
  const { data, error } = await db()
    .from(env.tables.alerts)
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) {
    if (error.message?.includes('relation') || error.code === '42P01') {
      return [];
    }
    throw new ApiError(error.message, HTTP_STATUS.BAD_REQUEST);
  }
  return data || [];
}

export async function deleteAlert(userId, id) {
  const { data, error } = await db()
    .from(env.tables.alerts)
    .delete()
    .eq('id', id)
    .eq('user_id', userId)
    .select()
    .maybeSingle();
  if (error) {
    throw new ApiError(error.message, HTTP_STATUS.BAD_REQUEST);
  }
  if (!data) {
    throw new ApiError('Alert not found', HTTP_STATUS.NOT_FOUND);
  }
  return true;
}
