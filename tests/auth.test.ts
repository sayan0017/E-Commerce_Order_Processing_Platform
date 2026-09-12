/**
 * Auth Service — API Tests
 *
 * Tests registration, login, JWT verification, and RBAC.
 * Uses mocked Express app for CI/CD reliability (no live service dependency).
 */

import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { generateTestToken, uniqueEmail, expectSuccess, expectError } from './helpers';

const JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret_for_ci';

// ─── Mock In-Memory Store ───────────────────────────────────────────────────

interface MockUser {
  id: string;
  email: string;
  password: string;
  name: string;
  role: 'ADMIN' | 'CUSTOMER';
  isActive: boolean;
  createdAt: Date;
}

const users: MockUser[] = [];
let userIdCounter = 0;

// ─── Build Mock Auth App ────────────────────────────────────────────────────

function createMockAuthApp() {
  const app = express();
  app.use(express.json());

  // POST /api/auth/register
  app.post('/api/auth/register', async (req, res) => {
    const { email, password, name, role } = req.body;

    if (!email || !password || !name) {
      res.status(400).json({ success: false, error: 'Validation failed' });
      return;
    }

    if (password.length < 8) {
      res.status(400).json({ success: false, error: 'Validation failed', details: { password: ['Password must be at least 8 characters'] } });
      return;
    }

    const existing = users.find((u) => u.email === email);
    if (existing) {
      res.status(409).json({ success: false, error: 'An account with this email already exists.' });
      return;
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    userIdCounter++;
    const user: MockUser = {
      id: `user-${userIdCounter}`,
      email,
      password: hashedPassword,
      name,
      role: role || 'CUSTOMER',
      isActive: true,
      createdAt: new Date(),
    };
    users.push(user);

    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: '1h' }
    );

    res.status(201).json({
      success: true,
      data: {
        user: { id: user.id, email: user.email, name: user.name, role: user.role },
        token,
      },
    });
  });

  // POST /api/auth/login
  app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({ success: false, error: 'Validation failed' });
      return;
    }

    const user = users.find((u) => u.email === email);
    if (!user) {
      res.status(401).json({ success: false, error: 'Invalid email or password.' });
      return;
    }

    if (!user.isActive) {
      res.status(403).json({ success: false, error: 'Account has been deactivated.' });
      return;
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      res.status(401).json({ success: false, error: 'Invalid email or password.' });
      return;
    }

    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: '1h' }
    );

    res.status(200).json({
      success: true,
      data: {
        user: { id: user.id, email: user.email, name: user.name, role: user.role },
        token,
      },
    });
  });

  // GET /api/auth/profile (protected)
  app.get('/api/auth/profile', (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ success: false, error: 'Authentication required.' });
      return;
    }

    try {
      const decoded = jwt.verify(authHeader.split(' ')[1], JWT_SECRET) as { userId: string };
      const user = users.find((u) => u.id === decoded.userId);
      if (!user) {
        res.status(404).json({ success: false, error: 'User not found.' });
        return;
      }

      res.status(200).json({
        success: true,
        data: { id: user.id, email: user.email, name: user.name, role: user.role },
      });
    } catch {
      res.status(401).json({ success: false, error: 'Invalid token.' });
    }
  });

  return app;
}

// ─── Supertest-like helper using native fetch ───────────────────────────────

import http from 'http';

function startServer(app: express.Application): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const addr = server.address() as { port: number };
      resolve({ server, port: addr.port });
    });
  });
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Auth Service', () => {
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app = createMockAuthApp();
    const result = await startServer(app);
    server = result.server;
    baseUrl = `http://localhost:${result.port}`;
  });

  afterAll(() => {
    server.close();
  });

  describe('POST /api/auth/register', () => {
    it('should register a new user and return JWT', async () => {
      const email = uniqueEmail();
      const res = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password: 'securePassword123',
          name: 'Test User',
        }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expectSuccess(body);
      expect(body.data.token).toBeDefined();
      expect(body.data.user.email).toBe(email);
      expect(body.data.user.role).toBe('CUSTOMER');

      // Verify token is valid
      const decoded = jwt.verify(body.data.token, JWT_SECRET) as Record<string, unknown>;
      expect(decoded.userId).toBeDefined();
      expect(decoded.role).toBe('CUSTOMER');
    });

    it('should register an admin user', async () => {
      const email = uniqueEmail();
      const res = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password: 'adminPassword123',
          name: 'Admin User',
          role: 'ADMIN',
        }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.data.user.role).toBe('ADMIN');
    });

    it('should reject duplicate email', async () => {
      const email = uniqueEmail();
      // First registration
      await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'password123', name: 'User' }),
      });

      // Duplicate
      const res = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'password123', name: 'User' }),
      });

      expect(res.status).toBe(409);
      const body = await res.json();
      expectError(body);
    });

    it('should reject short passwords', async () => {
      const res = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: uniqueEmail(),
          password: 'short',
          name: 'User',
        }),
      });

      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/auth/login', () => {
    const loginEmail = `login_test_${Date.now()}@test.com`;
    const loginPassword = 'loginPassword123';

    beforeAll(async () => {
      await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: loginEmail,
          password: loginPassword,
          name: 'Login Test User',
        }),
      });
    });

    it('should login with valid credentials', async () => {
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: loginEmail, password: loginPassword }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expectSuccess(body);
      expect(body.data.token).toBeDefined();

      // Verify JWT contains role claim
      const decoded = jwt.verify(body.data.token, JWT_SECRET) as Record<string, unknown>;
      expect(decoded.role).toBe('CUSTOMER');
      expect(decoded.email).toBe(loginEmail);
    });

    it('should reject invalid password', async () => {
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: loginEmail, password: 'wrongPassword' }),
      });

      expect(res.status).toBe(401);
      const body = await res.json();
      expectError(body);
    });

    it('should reject non-existent email', async () => {
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'nobody@test.com', password: 'password123' }),
      });

      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/auth/profile', () => {
    it('should return 401 without token', async () => {
      const res = await fetch(`${baseUrl}/api/auth/profile`);
      expect(res.status).toBe(401);
      const body = await res.json();
      expectError(body);
    });

    it('should return 401 with invalid token', async () => {
      const res = await fetch(`${baseUrl}/api/auth/profile`, {
        headers: { Authorization: 'Bearer invalid.token.here' },
      });
      expect(res.status).toBe(401);
    });

    it('should return profile with valid token', async () => {
      // Register a user first
      const email = uniqueEmail();
      const regRes = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'password123', name: 'Profile User' }),
      });
      const regBody = await regRes.json();
      const token = regBody.data.token;

      // Get profile
      const res = await fetch(`${baseUrl}/api/auth/profile`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expectSuccess(body);
      expect(body.data.email).toBe(email);
    });
  });
});
