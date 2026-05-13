import { validationResult } from 'express-validator';
import { ApiError } from '../utils/ApiError.js';
import { HTTP_STATUS } from '../constants/index.js';

export function validateRequest(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const msg = errors
      .array()
      .map((e) => e.msg)
      .join('; ');
    return next(new ApiError(msg, HTTP_STATUS.BAD_REQUEST));
  }
  next();
}
