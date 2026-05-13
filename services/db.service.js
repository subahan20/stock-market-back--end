import { getSupabaseAdmin } from '../config/supabase.js';
import { env } from '../config/env.js';

/** Central Supabase admin client accessor (service role; bypasses RLS). */
export function getDb() {
  return getSupabaseAdmin();
}

/** Resolved table names from env (see migrations + config/env.js). */
export function tables() {
  return env.tables;
}
