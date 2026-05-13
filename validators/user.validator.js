import { body } from 'express-validator';

export const watchlistAddRules = [
  body('symbol').trim().notEmpty().withMessage('symbol is required').isLength({ max: 32 }),
];
