import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { validateRequest } from '../middleware/validate.middleware.js';
import { symbolParam } from '../validators/stock.validator.js';
import * as aiController from '../controllers/ai.controller.js';

const router = Router();
router.use(requireAuth);
router.get('/recommendations/:symbol', [...symbolParam, validateRequest], asyncHandler(aiController.recommendations));

export default router;
