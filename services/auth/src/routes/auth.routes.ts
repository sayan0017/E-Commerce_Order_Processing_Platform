/**
 * Auth Service route definitions.
 */

import { Router } from 'express';
import { register, login, getProfile } from '../controllers/auth.controller';
import { authenticate } from '../middleware/jwt.middleware';

const router = Router();

// Public routes
router.post('/register', register);
router.post('/login', login);

// Protected routes
router.get('/profile', authenticate, getProfile);

export default router;
