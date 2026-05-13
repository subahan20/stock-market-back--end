import { Router } from 'express';
import { param } from 'express-validator';
import { requireAuth } from '../middleware/auth.middleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { validateRequest } from '../middleware/validate.middleware.js';
import { createAlertRules } from '../validators/alert.validator.js';
import * as alertController from '../controllers/alert.controller.js';

const router = Router();
router.use(requireAuth);

const idParam = [param('id').isUUID().withMessage('invalid alert id')];

router.post('/create', [...createAlertRules, validateRequest], asyncHandler(alertController.create));
router.get('/', asyncHandler(alertController.list));
router.delete('/:id', [...idParam, validateRequest], asyncHandler(alertController.remove));

export default router;
