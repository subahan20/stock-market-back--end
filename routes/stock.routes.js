import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { validateRequest } from '../middleware/validate.middleware.js';
import { searchQuery, symbolParam, historyRangeQuery } from '../validators/stock.validator.js';
import * as stockController from '../controllers/stock.controller.js';

const router = Router();
router.use(requireAuth);

router.get('/live', asyncHandler(stockController.live));
router.get('/details/:symbol', [...symbolParam, validateRequest], asyncHandler(stockController.details));
router.get('/db/:symbol', [...symbolParam, validateRequest], asyncHandler(stockController.detailsFromDb));
router.get(
  '/history/:symbol',
  [...symbolParam, ...historyRangeQuery, validateRequest],
  asyncHandler(stockController.history)
);
router.get('/analysis/:symbol', [...symbolParam, validateRequest], asyncHandler(stockController.analysis));
router.get('/search', [...searchQuery, validateRequest], asyncHandler(stockController.search));
router.get('/top-gainers', asyncHandler(stockController.topGainers));
router.get('/top-losers', asyncHandler(stockController.topLosers));
router.get('/market-overview', asyncHandler(stockController.marketOverview));

export default router;
