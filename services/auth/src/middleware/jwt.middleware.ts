/**
 * JWT Authentication & Authorization Middleware.
 *
 * - `authenticate`: Verifies the JWT and attaches the decoded payload to `req.user`.
 * - `authorize(...roles)`: Checks if the authenticated user has one of the allowed roles.
 */

import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';

// Extend Express Request to include user payload
export interface AuthRequest extends Request {
  user?: {
    userId: string;
    email: string;
    role: string;
  };
}

/**
 * Verifies the Bearer token from the Authorization header.
 * On success, attaches decoded payload to `req.user`.
 */
export function authenticate(req: AuthRequest, res: Response, next: NextFunction): void {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({
        success: false,
        error: 'Authentication required. Provide a Bearer token.',
      });
      return;
    }

    const token = authHeader.split(' ')[1];

    const decoded = jwt.verify(token, config.jwt.secret) as {
      userId: string;
      email: string;
      role: string;
    };

    req.user = {
      userId: decoded.userId,
      email: decoded.email,
      role: decoded.role,
    };

    next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      res.status(401).json({
        success: false,
        error: 'Token has expired. Please log in again.',
      });
      return;
    }

    if (error instanceof jwt.JsonWebTokenError) {
      res.status(401).json({
        success: false,
        error: 'Invalid token.',
      });
      return;
    }

    res.status(500).json({
      success: false,
      error: 'Internal authentication error.',
    });
  }
}

/**
 * Role-Based Access Control (RBAC) middleware.
 * Must be used AFTER `authenticate`.
 *
 * @param roles - One or more roles that are allowed access.
 * @returns Express middleware function.
 *
 * @example
 * router.post('/products', authenticate, authorize('ADMIN'), createProduct);
 */
export function authorize(...roles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        error: 'Authentication required.',
      });
      return;
    }

    if (!roles.includes(req.user.role)) {
      res.status(403).json({
        success: false,
        error: `Access denied. Required role(s): ${roles.join(', ')}`,
      });
      return;
    }

    next();
  };
}
