import { getUserFromBearer } from '../services/auth.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';

export const requireAuth = asyncHandler(async (req, res, next) => {
  const user = await getUserFromBearer(req.headers.authorization);
  req.user = user;
  next();
});
