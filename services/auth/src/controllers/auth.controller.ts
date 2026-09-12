/**
 * Auth Controller — handles registration, login, and profile retrieval.
 *
 * All passwords are hashed with bcrypt (12 rounds).
 * JWTs contain userId, email, and role claims.
 */

import { Response } from 'express';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { config } from '../config';
import { AuthRequest } from '../middleware/jwt.middleware';

const prisma = new PrismaClient({
  log: config.nodeEnv === 'development' ? ['query', 'warn', 'error'] : ['error'],
});

// ─── Validation Schemas ─────────────────────────────────────────────────────

const registerSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name: z.string().min(1, 'Name is required').max(100),
  role: z.enum(['ADMIN', 'CUSTOMER']).optional().default('CUSTOMER'),
});

const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

// ─── Helper: Generate JWT ───────────────────────────────────────────────────

function generateToken(user: { id: string; email: string; role: string }): string {
  return jwt.sign(
    {
      userId: user.id,
      email: user.email,
      role: user.role,
    },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn as string }
  );
}

// ─── Controllers ────────────────────────────────────────────────────────────

/**
 * POST /api/auth/register
 * Creates a new user account and returns a JWT.
 */
export async function register(req: AuthRequest, res: Response): Promise<void> {
  try {
    const validation = registerSchema.safeParse(req.body);

    if (!validation.success) {
      res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: validation.error.flatten().fieldErrors,
      });
      return;
    }

    const { email, password, name, role } = validation.data;

    // Check for existing user
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      res.status(409).json({
        success: false,
        error: 'An account with this email already exists.',
      });
      return;
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, config.bcrypt.saltRounds);

    // Create user
    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        name,
        role,
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
      },
    });

    // Generate JWT
    const token = generateToken(user);

    res.status(201).json({
      success: true,
      data: {
        user,
        token,
      },
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error during registration.',
    });
  }
}

/**
 * POST /api/auth/login
 * Authenticates a user and returns a JWT.
 */
export async function login(req: AuthRequest, res: Response): Promise<void> {
  try {
    const validation = loginSchema.safeParse(req.body);

    if (!validation.success) {
      res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: validation.error.flatten().fieldErrors,
      });
      return;
    }

    const { email, password } = validation.data;

    // Find user by email
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      res.status(401).json({
        success: false,
        error: 'Invalid email or password.',
      });
      return;
    }

    // Check if account is active
    if (!user.isActive) {
      res.status(403).json({
        success: false,
        error: 'Account has been deactivated.',
      });
      return;
    }

    // Verify password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      res.status(401).json({
        success: false,
        error: 'Invalid email or password.',
      });
      return;
    }

    // Generate JWT
    const token = generateToken(user);

    res.status(200).json({
      success: true,
      data: {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        },
        token,
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error during login.',
    });
  }
}

/**
 * GET /api/auth/profile
 * Returns the authenticated user's profile.
 */
export async function getProfile(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, error: 'Not authenticated.' });
      return;
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user.userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      res.status(404).json({ success: false, error: 'User not found.' });
      return;
    }

    res.status(200).json({
      success: true,
      data: user,
    });
  } catch (error) {
    console.error('Profile error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error.',
    });
  }
}

// Export prisma for cleanup
export { prisma };
