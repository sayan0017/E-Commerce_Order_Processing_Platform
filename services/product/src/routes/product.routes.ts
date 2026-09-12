/**
 * Product Service route definitions.
 */

import { Router } from 'express';
import {
  listProducts,
  getProduct,
  createProduct,
  updateProduct,
  deleteProduct,
} from '../controllers/product.controller';
import { authenticate, authorize } from '../middleware/auth.middleware';

const router = Router();

// Public routes (still benefit from Redis caching)
router.get('/', listProducts);
router.get('/:id', getProduct);

// Admin-only routes
router.post('/', authenticate, authorize('ADMIN'), createProduct);
router.put('/:id', authenticate, authorize('ADMIN'), updateProduct);
router.delete('/:id', authenticate, authorize('ADMIN'), deleteProduct);

export default router;
