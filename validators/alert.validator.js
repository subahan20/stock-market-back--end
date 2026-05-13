import { body } from 'express-validator';

export const createAlertRules = [
  body('symbol').trim().notEmpty().withMessage('symbol is required').isLength({ max: 32 }),
  body('thresholdType')
    .optional()
    .isIn(['price_above', 'price_below', 'pct_change'])
    .withMessage('invalid thresholdType'),
  body('thresholdValue').isNumeric().withMessage('thresholdValue must be numeric'),
  body('note').optional().isString().isLength({ max: 500 }),
];
