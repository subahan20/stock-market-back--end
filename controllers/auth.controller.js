import { getUserFromBearer } from '../services/auth.service.js';
import { sendSuccess, sendError } from '../utils/apiResponse.js';
import { MESSAGES } from '../constants/index.js';
import { HTTP_STATUS } from '../constants/index.js';

/** Interprets "login" as session verification with Supabase (client performs OAuth/password flows). */
export async function login(req, res, next) {
  try {
    const user = await getUserFromBearer(req.headers.authorization);
    sendSuccess(res, { user }, 'Session valid');
  } catch (e) {
    next(e);
  }
}

export async function register(_req, res) {
  return sendError(res, MESSAGES.REGISTER_VIA_SUPABASE, HTTP_STATUS.UNPROCESSABLE);
}
