/**
 * Order Service route definitions.
 */

import { Router } from 'express';
import {
  checkout,
  listOrders,
  getOrder,
  cancelOrder,
  initInventory,
} from '../controllers/order.controller';
import { authenticate, authorize } from '../middleware/auth.middleware';

const router = Router();

// All order routes require authentication
router.use(authenticate);

// Customer routes
router.post('/checkout', checkout);
router.get('/', listOrders);
router.get('/:id', getOrder);
router.patch('/:id/cancel', cancelOrder);

// Admin routes
router.post('/inventory/init', authorize('ADMIN'), initInventory);

export default router;
