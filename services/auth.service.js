import { getSupabaseAdmin } from '../config/supabase.js';
import { ApiError } from '../utils/ApiError.js';
import { HTTP_STATUS } from '../constants/index.js';

export async function getUserFromBearer(authorizationHeader) {
  const admin = getSupabaseAdmin();
  if (!admin) {
    throw new ApiError('Auth validation unavailable (configure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY)', HTTP_STATUS.SERVICE_UNAVAILABLE);
  }
  const header = authorizationHeader || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    throw new ApiError('Missing bearer token', HTTP_STATUS.UNAUTHORIZED);
  }
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) {
    throw new ApiError('Invalid or expired session', HTTP_STATUS.UNAUTHORIZED);
  }
  return data.user;
}
