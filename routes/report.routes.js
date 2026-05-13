import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { validateRequest } from '../middleware/validate.middleware.js';
import { aiEmailReportRules } from '../validators/report.validator.js';
import * as reportController from '../controllers/report.controller.js';

const router = Router();
router.use(requireAuth);

router.post(
  '/ai-email',
  [...aiEmailReportRules, validateRequest],
  asyncHandler(reportController.aiEmailReportSend)
);

export default router;
