/**
 * Test Helpers — Shared utilities for API tests.
 *
 * Provides HTTP client wrappers and token generation for mocked API tests.
 * Tests run against mocked controllers, not live services (for CI reliability).
 */

import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';

const JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret_for_ci';

// ─── Service URLs ───────────────────────────────────────────────────────────

export const SERVICE_URLS = {
  auth: process.env.AUTH_SERVICE_URL || 'http://localhost:3001',
  product: process.env.PRODUCT_SERVICE_URL || 'http://localhost:3002',
  order: process.env.ORDER_SERVICE_URL || 'http://localhost:3003',
};

// ─── Token Generation ───────────────────────────────────────────────────────

export function generateTestToken(payload: {
  userId: string;
  email: string;
  role: 'ADMIN' | 'CUSTOMER';
}): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '1h' });
}

export function generateAdminToken(userId = 'admin-test-id'): string {
  return generateTestToken({
    userId,
    email: 'admin@test.com',
    role: 'ADMIN',
  });
}

export function generateCustomerToken(userId = 'customer-test-id'): string {
  return generateTestToken({
    userId,
    email: 'customer@test.com',
    role: 'CUSTOMER',
  });
}

// ─── Password Hashing ──────────────────────────────────────────────────────

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

// ─── Test Data Generators ───────────────────────────────────────────────────

let counter = 0;

export function uniqueEmail(): string {
  counter++;
  return `testuser_${Date.now()}_${counter}@test.com`;
}

export function createTestProduct(overrides: Record<string, unknown> = {}) {
  counter++;
  return {
    name: `Test Product ${counter}`,
    description: `Description for test product ${counter}`,
    price: 29.99,
    category: 'electronics',
    sku: `TEST-SKU-${Date.now()}-${counter}`,
    stock: 100,
    ...overrides,
  };
}

export function createTestCartItem(productId: string, quantity = 1) {
  return { productId, quantity };
}

// ─── Response Validators ────────────────────────────────────────────────────

export function expectSuccess(body: Record<string, unknown>): void {
  expect(body.success).toBe(true);
}

export function expectError(body: Record<string, unknown>): void {
  expect(body.success).toBe(false);
  expect(body.error).toBeDefined();
}
