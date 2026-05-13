import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import * as authController from '../controllers/auth.controller.js';

const router = Router();
router.post('/login', asyncHandler(authController.login));
router.post('/register', asyncHandler(authController.register));

export default router;
