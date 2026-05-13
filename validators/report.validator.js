import { body } from 'express-validator';

/**
 * Validation for POST /api/reports/ai-email.
 *
 * We deliberately coerce to string up front so a missing field surfaces as the friendly
 * "name is required" / "email is required" instead of "must be a string" — which used to
 * fire when the frontend forgot to set `Content-Type: application/json` and the body never
 * reached this middleware.
 */
export const aiEmailReportRules = [
  body('name')
    .customSanitizer((v) => (v == null ? '' : String(v)))
    .trim()
    .notEmpty()
    .withMessage('name is required')
    .bail()
    .isLength({ max: 80 })
    .withMessage('name must be 80 characters or fewer'),
  body('email')
    .customSanitizer((v) => (v == null ? '' : String(v)))
    .trim()
    .notEmpty()
    .withMessage('email is required')
    .bail()
    .isEmail()
    .withMessage('email must be a valid email address')
    .bail()
    .isLength({ max: 200 })
    .withMessage('email must be 200 characters or fewer')
    .normalizeEmail({ gmail_remove_dots: false }),
];
