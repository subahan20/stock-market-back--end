import { Router } from 'express';
import { getHealth } from '../controllers/health.controller.js';
import stockRoutes from './stock.routes.js';
import legacyMarketRoutes from './legacyMarket.routes.js';
import authRoutes from './auth.routes.js';
import userRoutes from './user.routes.js';
import alertRoutes from './alert.routes.js';
import aiRoutes from './ai.routes.js';
import reportRoutes from './report.routes.js';

const router = Router();

router.get('/health', getHealth);
router.use('/stocks', stockRoutes);
router.use('/market', legacyMarketRoutes);
router.use('/auth', authRoutes);
router.use('/user', userRoutes);
router.use('/alerts', alertRoutes);
router.use('/ai', aiRoutes);
router.use('/reports', reportRoutes);

export default router;
