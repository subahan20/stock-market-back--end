import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { validateRequest } from '../middleware/validate.middleware.js';
import { watchlistAddRules } from '../validators/user.validator.js';
import * as userController from '../controllers/user.controller.js';

const router = Router();
router.use(requireAuth);

router.get('/profile', asyncHandler(userController.profile));
router.get('/portfolio', asyncHandler(userController.portfolio));
router.get('/watchlist', asyncHandler(userController.watchlistGet));
router.post('/watchlist', [...watchlistAddRules, validateRequest], asyncHandler(userController.watchlistPost));
router.delete('/watchlist/:symbol', asyncHandler(userController.watchlistDelete));

export default router;
