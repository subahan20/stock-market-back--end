import { query, param } from 'express-validator';

export const symbolParam = [
  param('symbol').trim().notEmpty().withMessage('symbol is required').isLength({ max: 32 }).withMessage('symbol too long'),
];

export const searchQuery = [
  query('q').optional().isString().isLength({ max: 120 }).withMessage('q too long'),
  query('query').optional().isString().isLength({ max: 120 }).withMessage('query too long'),
];

export const historyRangeQuery = [
  query('range')
    .optional()
    .isIn(['1D', '1W', '1M', '1Y'])
    .withMessage('range must be 1D, 1W, 1M, or 1Y'),
];
