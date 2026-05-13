import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { validateRequest } from '../middleware/validate.middleware.js';
import { searchQuery, symbolParam, historyRangeQuery } from '../validators/stock.validator.js';
import * as legacy from '../controllers/legacyMarket.controller.js';

const router = Router();
router.use(requireAuth);

router.get('/overview', asyncHandler(legacy.overview));
router.get('/search', [...searchQuery, validateRequest], asyncHandler(legacy.search));
router.get('/stocks/:symbol/details', [...symbolParam, validateRequest], asyncHandler(legacy.stockDetails));
router.get('/chart/:symbol', [...symbolParam, ...historyRangeQuery, validateRequest], asyncHandler(legacy.chart));

export default router;
