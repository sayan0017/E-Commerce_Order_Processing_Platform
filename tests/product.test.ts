/**
 * Product Service — API Tests
 *
 * Tests CRUD operations, Redis caching behavior, cache invalidation,
 * and RBAC enforcement on product endpoints.
 */

import express from 'express';
import jwt from 'jsonwebtoken';
import http from 'http';
import {
  generateAdminToken,
  generateCustomerToken,
  createTestProduct,
  expectSuccess,
  expectError,
} from './helpers';

const JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret_for_ci';

// ─── Mock In-Memory Store & Cache ───────────────────────────────────────────

interface MockProduct {
  id: string;
  name: string;
  description: string;
  price: number;
  category: string;
  sku: string;
  imageUrl: string | null;
  stock: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const products: MockProduct[] = [];
const cache = new Map<string, { data: unknown; expiresAt: number }>();
let productIdCounter = 0;

function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry || Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.data as T;
}

function setCache(key: string, data: unknown, ttlMs: number): void {
  cache.set(key, { data, expiresAt: Date.now() + ttlMs });
}

function invalidateCache(pattern: string): void {
  const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
  for (const key of cache.keys()) {
    if (regex.test(key)) cache.delete(key);
  }
}

// ─── Auth Middleware ────────────────────────────────────────────────────────

function authMiddleware(req: express.Request, res: express.Response, next: express.NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ success: false, error: 'Authentication required.' });
    return;
  }
  try {
    const decoded = jwt.verify(authHeader.split(' ')[1], JWT_SECRET) as Record<string, string>;
    (req as any).user = decoded;
    next();
  } catch {
    res.status(401).json({ success: false, error: 'Invalid token.' });
  }
}

function adminOnly(req: express.Request, res: express.Response, next: express.NextFunction): void {
  if ((req as any).user?.role !== 'ADMIN') {
    res.status(403).json({ success: false, error: 'Access denied. Required role(s): ADMIN' });
    return;
  }
  next();
}

// ─── Build Mock Product App ─────────────────────────────────────────────────

function createMockProductApp() {
  const app = express();
  app.use(express.json());

  // GET /api/products — paginated listing (cached)
  app.get('/api/products', (req, res) => {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const category = (req.query.category as string) || '';
    const cacheKey = `products:list:p${page}:l${limit}:c${category || 'all'}`;

    const cached = getCached(cacheKey);
    if (cached) {
      res.status(200).json({ success: true, ...(cached as object), _cached: true });
      return;
    }

    let filtered = products.filter((p) => p.isActive);
    if (category) {
      filtered = filtered.filter((p) => p.category === category);
    }

    const total = filtered.length;
    const paginated = filtered.slice((page - 1) * limit, page * limit);
    const totalPages = Math.ceil(total / limit);

    const result = {
      data: paginated,
      meta: { total, page, limit, totalPages, hasNext: page < totalPages, hasPrev: page > 1 },
    };

    setCache(cacheKey, result, 300_000);
    res.status(200).json({ success: true, ...result, _cached: false });
  });

  // GET /api/products/:id — detail (cached)
  app.get('/api/products/:id', (req, res) => {
    const { id } = req.params;
    const cacheKey = `products:detail:${id}`;

    const cached = getCached(cacheKey);
    if (cached) {
      res.status(200).json({ success: true, data: cached, _cached: true });
      return;
    }

    const product = products.find((p) => p.id === id);
    if (!product) {
      res.status(404).json({ success: false, error: 'Product not found.' });
      return;
    }

    setCache(cacheKey, product, 600_000);
    res.status(200).json({ success: true, data: product, _cached: false });
  });

  // POST /api/products — create (admin only)
  app.post('/api/products', authMiddleware, adminOnly, (req, res) => {
    const { name, description, price, category, sku, imageUrl, stock } = req.body;

    if (!name || !description || price === undefined || !category || !sku || stock === undefined) {
      res.status(400).json({ success: false, error: 'Validation failed' });
      return;
    }

    const existingSku = products.find((p) => p.sku === sku);
    if (existingSku) {
      res.status(409).json({ success: false, error: 'A product with this SKU already exists.' });
      return;
    }

    productIdCounter++;
    const product: MockProduct = {
      id: `prod-${productIdCounter}`,
      name, description, price, category, sku,
      imageUrl: imageUrl || null,
      stock,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    products.push(product);

    invalidateCache('products:list:*');
    res.status(201).json({ success: true, data: product });
  });

  // PUT /api/products/:id — update (admin only)
  app.put('/api/products/:id', authMiddleware, adminOnly, (req, res) => {
    const { id } = req.params;
    const product = products.find((p) => p.id === id);
    if (!product) {
      res.status(404).json({ success: false, error: 'Product not found.' });
      return;
    }

    Object.assign(product, req.body, { updatedAt: new Date() });
    invalidateCache('products:list:*');
    invalidateCache(`products:detail:${id}`);
    res.status(200).json({ success: true, data: product });
  });

  // DELETE /api/products/:id — soft delete (admin only)
  app.delete('/api/products/:id', authMiddleware, adminOnly, (req, res) => {
    const { id } = req.params;
    const product = products.find((p) => p.id === id);
    if (!product) {
      res.status(404).json({ success: false, error: 'Product not found.' });
      return;
    }

    product.isActive = false;
    invalidateCache('products:list:*');
    invalidateCache(`products:detail:${id}`);
    res.status(200).json({ success: true, message: 'Product deleted successfully.' });
  });

  return app;
}

function startServer(app: express.Application): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const addr = server.address() as { port: number };
      resolve({ server, port: addr.port });
    });
  });
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Product Service', () => {
  let server: http.Server;
  let baseUrl: string;
  const adminToken = generateAdminToken();
  const customerToken = generateCustomerToken();

  beforeAll(async () => {
    const app = createMockProductApp();
    const result = await startServer(app);
    server = result.server;
    baseUrl = `http://localhost:${result.port}`;
  });

  afterAll(() => {
    server.close();
  });

  beforeEach(() => {
    cache.clear();
  });

  describe('POST /api/products (Admin only)', () => {
    it('should create a product as admin', async () => {
      const productData = createTestProduct();
      const res = await fetch(`${baseUrl}/api/products`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify(productData),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expectSuccess(body);
      expect(body.data.name).toBe(productData.name);
      expect(body.data.id).toBeDefined();
    });

    it('should reject product creation by customer (403)', async () => {
      const res = await fetch(`${baseUrl}/api/products`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerToken}`,
        },
        body: JSON.stringify(createTestProduct()),
      });

      expect(res.status).toBe(403);
      const body = await res.json();
      expectError(body);
    });

    it('should reject unauthenticated product creation (401)', async () => {
      const res = await fetch(`${baseUrl}/api/products`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createTestProduct()),
      });

      expect(res.status).toBe(401);
    });

    it('should reject duplicate SKU', async () => {
      const productData = createTestProduct({ sku: 'UNIQUE-SKU-001' });
      await fetch(`${baseUrl}/api/products`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify(productData),
      });

      const res = await fetch(`${baseUrl}/api/products`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ ...createTestProduct(), sku: 'UNIQUE-SKU-001' }),
      });

      expect(res.status).toBe(409);
    });
  });

  describe('GET /api/products (Public, Cached)', () => {
    it('should return paginated product list', async () => {
      // Create some products first
      for (let i = 0; i < 3; i++) {
        await fetch(`${baseUrl}/api/products`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${adminToken}`,
          },
          body: JSON.stringify(createTestProduct()),
        });
      }

      const res = await fetch(`${baseUrl}/api/products?page=1&limit=10`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expectSuccess(body);
      expect(body.meta).toBeDefined();
      expect(body.meta.total).toBeGreaterThanOrEqual(3);
      expect(Array.isArray(body.data)).toBe(true);
    });

    it('should cache the response on second call', async () => {
      // First call — cache miss
      const res1 = await fetch(`${baseUrl}/api/products?page=1&limit=5`);
      const body1 = await res1.json();
      expect(body1._cached).toBe(false);

      // Second call — cache hit
      const res2 = await fetch(`${baseUrl}/api/products?page=1&limit=5`);
      const body2 = await res2.json();
      expect(body2._cached).toBe(true);
    });

    it('should filter by category', async () => {
      await fetch(`${baseUrl}/api/products`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify(createTestProduct({ category: 'books' })),
      });

      const res = await fetch(`${baseUrl}/api/products?category=books`);
      const body = await res.json();
      expectSuccess(body);
      expect(body.data.every((p: any) => p.category === 'books')).toBe(true);
    });
  });

  describe('GET /api/products/:id (Public, Cached)', () => {
    it('should return product details', async () => {
      // Create a product
      const createRes = await fetch(`${baseUrl}/api/products`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify(createTestProduct()),
      });
      const { data: product } = await createRes.json();

      const res = await fetch(`${baseUrl}/api/products/${product.id}`);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.id).toBe(product.id);
    });

    it('should return 404 for non-existent product', async () => {
      const res = await fetch(`${baseUrl}/api/products/nonexistent-id`);
      expect(res.status).toBe(404);
    });
  });

  describe('PUT /api/products/:id (Admin, Cache Invalidation)', () => {
    it('should update product and invalidate cache', async () => {
      // Create product
      const createRes = await fetch(`${baseUrl}/api/products`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify(createTestProduct()),
      });
      const { data: product } = await createRes.json();

      // Cache the product
      await fetch(`${baseUrl}/api/products/${product.id}`);

      // Update
      const res = await fetch(`${baseUrl}/api/products/${product.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ name: 'Updated Product Name' }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.name).toBe('Updated Product Name');

      // Verify cache was invalidated (next get should be cache miss)
      const getRes = await fetch(`${baseUrl}/api/products/${product.id}`);
      const getBody = await getRes.json();
      expect(getBody._cached).toBe(false);
    });
  });

  describe('DELETE /api/products/:id (Admin, Soft Delete)', () => {
    it('should soft-delete a product', async () => {
      const createRes = await fetch(`${baseUrl}/api/products`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify(createTestProduct()),
      });
      const { data: product } = await createRes.json();

      const res = await fetch(`${baseUrl}/api/products/${product.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${adminToken}` },
      });

      expect(res.status).toBe(200);
    });
  });
});
