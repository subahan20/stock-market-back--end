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

/** Pick the first non-empty string from a list of candidates. */
function firstNonEmpty(...values) {
  for (const v of values) {
    if (typeof v === 'string' && v.trim().length > 0) return v;
  }
  return null;
}

/**
 * Best-effort projection of OAuth identity payload onto `public.users` columns.
 * Google/GitHub stash useful fields in `raw_user_meta_data`; we mirror them so the
 * Settings UI (and any future joins) always read the same shape from one table.
 */
function buildUsersRowFromAuth(authUser) {
  const meta = authUser?.user_metadata || {};
  const appMeta = authUser?.app_metadata || {};
  return {
    id: authUser.id,
    email: (authUser.email || meta.email || '').toLowerCase(),
    full_name: firstNonEmpty(meta.full_name, meta.name, meta.given_name && meta.family_name
      ? `${meta.given_name} ${meta.family_name}`
      : null),
    avatar_url: firstNonEmpty(meta.avatar_url, meta.picture),
    provider: firstNonEmpty(appMeta.provider, meta.provider, 'email'),
    updated_at: new Date().toISOString(),
  };
}

/**
 * Returns the `public.users` row, backfilling from `auth.users.raw_user_meta_data`
 * when fields drifted (e.g. user signed up before migration 007, Google updated avatar,
 * or the original trigger ran before OAuth metadata was hydrated).
 *
 * Backfill rules:
 *   - Insert the row if missing.
 *   - Upsert any field that is NULL in DB but non-empty in auth metadata.
 *   - Never overwrite a non-null DB field with a different auth value (user may have
 *     edited their profile out-of-band).
 */
async function syncUsersRowFromAuth(authUser, currentRow) {
  const projected = buildUsersRowFromAuth(authUser);
  const next = {
    id: authUser.id,
    email: currentRow?.email || projected.email,
    full_name: currentRow?.full_name || projected.full_name,
    avatar_url: currentRow?.avatar_url || projected.avatar_url,
    provider: currentRow?.provider || projected.provider,
    updated_at: projected.updated_at,
  };

  const needsSync =
    !currentRow ||
    (next.full_name && next.full_name !== currentRow.full_name) ||
    (next.avatar_url && next.avatar_url !== currentRow.avatar_url) ||
    (next.provider && next.provider !== currentRow.provider) ||
    (next.email && next.email !== currentRow.email);
  if (!needsSync) return currentRow;

  const { data, error } = await db()
    .from(env.tables.users)
    .upsert(next, { onConflict: 'id' })
    .select()
    .maybeSingle();
  if (error) {
    if (error.code === '42P01' || error.message?.includes('relation')) {
      return currentRow;
    }
    // eslint-disable-next-line no-console
    console.warn('[users] backfill upsert failed', error.message);
    return currentRow;
  }
  // eslint-disable-next-line no-console
  console.log('[users] DB backfill from auth metadata ok', {
    id: authUser.id,
    full_name: !!data?.full_name,
    avatar_url: !!data?.avatar_url,
    provider: data?.provider,
  });
  return data;
}

export async function getProfile(user) {
  let row = null;
  const { data, error } = await db()
    .from(env.tables.users)
    .select('*')
    .eq('id', user.id)
    .maybeSingle();
  if (error && !(error.code === '42P01' || error.message?.includes('relation'))) {
    throw new ApiError(error.message, HTTP_STATUS.BAD_REQUEST);
  }
  row = data || null;

  // Backfill from auth metadata so OAuth fields (avatar, name) always reach the DB.
  // Safe to run on every read: it's a no-op when the row is already complete.
  try {
    row = await syncUsersRowFromAuth(user, row);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[users] backfill skipped', err?.message || err);
  }

  const meta = user.user_metadata || {};
  return {
    id: user.id,
    email: row?.email || user.email || meta.email || null,
    fullName: row?.full_name ?? firstNonEmpty(meta.full_name, meta.name),
    avatarUrl: row?.avatar_url ?? firstNonEmpty(meta.avatar_url, meta.picture),
    provider: row?.provider ?? firstNonEmpty(user.app_metadata?.provider, meta.provider, 'email'),
    profileUpdatedAt: row?.updated_at ?? null,
    metadata: meta,
    appMetadata: user.app_metadata || {},
  };
}

function num(v) {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Raw watchlist rows (no join). */
export async function listWatchlistRaw(userId) {
  const { data, error } = await db()
    .from(env.tables.watchlist)
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) {
    if (error.code === 'PGRST116' || error.message?.includes('relation') || error.code === '42P01') {
      return [];
    }
    throw new ApiError(error.message, HTTP_STATUS.BAD_REQUEST);
  }
  return data || [];
}

/**
 * Watchlist rows joined with the latest quote row from `public.stocks`.
 * Returns one DTO per pinned symbol: `{ id, symbol, name, price, changePct, lastUpdated, addedAt }`.
 */
export async function listWatchlist(userId) {
  const rows = await listWatchlistRaw(userId);
  if (!rows.length) return [];

  const symbols = [...new Set(rows.map((r) => r.symbol))];
  const { data: stockRows, error } = await db()
    .from(env.tables.stocks)
    .select('symbol, company_name, price, change_percent, last_updated')
    .in('symbol', symbols);

  if (error && !(error.code === '42P01' || error.message?.includes('relation'))) {
    throw new ApiError(error.message, HTTP_STATUS.BAD_REQUEST);
  }

  const bySymbol = new Map();
  for (const s of stockRows || []) bySymbol.set(s.symbol, s);

  return rows.map((r) => {
    const s = bySymbol.get(r.symbol) || null;
    return {
      id: r.id,
      symbol: r.symbol,
      name: s?.company_name || r.symbol,
      price: num(s?.price),
      changePct: num(s?.change_percent),
      lastUpdated: s?.last_updated || null,
      addedAt: r.created_at || null,
    };
  });
}

export async function addWatchlistItem(userId, symbol) {
  const row = {
    user_id: userId,
    symbol: symbol.toUpperCase(),
    created_at: new Date().toISOString(),
  };
  const { data, error } = await db()
    .from(env.tables.watchlist)
    .upsert(row, { onConflict: 'user_id,symbol' })
    .select()
    .single();
  if (error) {
    if (error.message?.includes('relation') || error.code === '42P01') {
      throw new ApiError(
        `Table "${env.tables.watchlist}" missing. Run migrations in backend/migrations (001–008).`,
        HTTP_STATUS.SERVICE_UNAVAILABLE
      );
    }
    throw new ApiError(error.message, HTTP_STATUS.BAD_REQUEST);
  }
  return data;
}

export async function removeWatchlistItem(userId, symbol) {
  const sym = String(symbol || '').toUpperCase().trim();
  if (!sym) throw new ApiError('symbol is required', HTTP_STATUS.BAD_REQUEST);
  const { data, error } = await db()
    .from(env.tables.watchlist)
    .delete()
    .eq('user_id', userId)
    .eq('symbol', sym)
    .select()
    .maybeSingle();
  if (error) {
    throw new ApiError(error.message, HTTP_STATUS.BAD_REQUEST);
  }
  if (!data) {
    throw new ApiError(`Symbol ${sym} not on watchlist`, HTTP_STATUS.NOT_FOUND);
  }
  return { id: data.id, symbol: data.symbol };
}
