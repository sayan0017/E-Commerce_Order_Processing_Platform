/**
 * Order Service — API Tests
 *
 * Tests checkout workflow, inventory management, payment processing,
 * oversell prevention, concurrent checkout race conditions, and order cancellation.
 */

import express from 'express';
import jwt from 'jsonwebtoken';
import http from 'http';
import { randomUUID } from 'crypto';
import { generateAdminToken, generateCustomerToken, expectSuccess, expectError } from './helpers';

const JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret_for_ci';

// ─── Mock In-Memory Stores ─────────────────────────────────────────────────

interface MockInventory {
  productId: string;
  stock: number;
  reserved: number;
}

interface MockOrderItem {
  id: string;
  productId: string;
  quantity: number;
  unitPrice: number;
}

interface MockOrder {
  id: string;
  userId: string;
  status: string;
  totalAmount: number;
  paymentId: string | null;
  items: MockOrderItem[];
  createdAt: Date;
}

const inventory: MockInventory[] = [];
const orders: MockOrder[] = [];
const productPrices: Map<string, number> = new Map();

// ─── Seed Test Data ─────────────────────────────────────────────────────────

function seedProducts() {
  const testProducts = [
    { id: 'prod-1', price: 29.99, stock: 10 },
    { id: 'prod-2', price: 49.99, stock: 5 },
    { id: 'prod-3', price: 9999.99, stock: 100 },  // For payment failure test (< $10K per item)
    { id: 'prod-limited', price: 99.99, stock: 1 }, // Only 1 in stock — for race condition test
  ];

  inventory.length = 0;
  orders.length = 0;
  productPrices.clear();

  for (const p of testProducts) {
    productPrices.set(p.id, p.price);
    inventory.push({ productId: p.id, stock: p.stock, reserved: 0 });
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

// ─── Atomic Inventory Lock (simulates Serializable transaction) ─────────

let inventoryLock = false;

async function acquireLock(): Promise<void> {
  while (inventoryLock) {
    await new Promise((r) => setTimeout(r, 10));
  }
  inventoryLock = true;
}

function releaseLock(): void {
  inventoryLock = false;
}

// ─── Build Mock Order App ───────────────────────────────────────────────────

function createMockOrderApp() {
  const app = express();
  app.use(express.json());

  // POST /api/orders/checkout
  app.post('/api/orders/checkout', authMiddleware, async (req, res) => {
    const user = (req as any).user;
    const { items } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      res.status(400).json({ success: false, error: 'Validation failed' });
      return;
    }

    // Validate products exist
    for (const item of items) {
      if (!productPrices.has(item.productId)) {
        res.status(404).json({
          success: false,
          error: `Product not found: ${item.productId}`,
        });
        return;
      }
    }

    // ── Atomic inventory reservation ──────────────────────────────
    await acquireLock();
    try {
      for (const item of items) {
        const inv = inventory.find((i) => i.productId === item.productId);
        if (!inv) {
          releaseLock();
          res.status(404).json({ success: false, error: `Inventory not found: ${item.productId}` });
          return;
        }

        const available = inv.stock - inv.reserved;
        if (available < item.quantity) {
          releaseLock();
          res.status(409).json({
            success: false,
            error: `Insufficient stock for product ${item.productId}. Available: ${available}, Requested: ${item.quantity}`,
          });
          return;
        }

        inv.reserved += item.quantity;
      }
    } finally {
      releaseLock();
    }

    // Calculate total
    let totalAmount = 0;
    for (const item of items) {
      totalAmount += productPrices.get(item.productId)! * item.quantity;
    }

    // Create order
    const orderId = randomUUID();
    const order: MockOrder = {
      id: orderId,
      userId: user.userId,
      status: 'PENDING',
      totalAmount,
      paymentId: null,
      items: items.map((item: any) => ({
        id: randomUUID(),
        productId: item.productId,
        quantity: item.quantity,
        unitPrice: productPrices.get(item.productId)!,
      })),
      createdAt: new Date(),
    };
    orders.push(order);

    // Mock payment (fails if total >= $10,000)
    await new Promise((r) => setTimeout(r, 50));

    if (totalAmount >= 10000) {
      // Payment failed — release stock
      for (const item of items) {
        const inv = inventory.find((i) => i.productId === item.productId)!;
        inv.reserved -= item.quantity;
      }
      order.status = 'CANCELLED';
      res.status(402).json({
        success: false,
        error: 'Payment declined: Amount exceeds processing limit.',
        data: { orderId, status: 'CANCELLED' },
      });
      return;
    }

    // Payment success — confirm stock
    for (const item of items) {
      const inv = inventory.find((i) => i.productId === item.productId)!;
      inv.stock -= item.quantity;
      inv.reserved -= item.quantity;
    }

    order.status = 'PAID';
    order.paymentId = `pay_${randomUUID().substring(0, 24)}`;

    res.status(201).json({
      success: true,
      data: {
        order,
        payment: { paymentId: order.paymentId, amount: totalAmount },
      },
    });
  });

  // GET /api/orders
  app.get('/api/orders', authMiddleware, (req, res) => {
    const user = (req as any).user;
    const userOrders = orders.filter((o) => o.userId === user.userId);
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const paginated = userOrders.slice((page - 1) * limit, page * limit);

    res.status(200).json({
      success: true,
      data: paginated,
      meta: {
        total: userOrders.length,
        page,
        limit,
        totalPages: Math.ceil(userOrders.length / limit),
      },
    });
  });

  // GET /api/orders/:id
  app.get('/api/orders/:id', authMiddleware, (req, res) => {
    const user = (req as any).user;
    const order = orders.find((o) => o.id === req.params.id && o.userId === user.userId);
    if (!order) {
      res.status(404).json({ success: false, error: 'Order not found.' });
      return;
    }
    res.status(200).json({ success: true, data: order });
  });

  // PATCH /api/orders/:id/cancel
  app.patch('/api/orders/:id/cancel', authMiddleware, (req, res) => {
    const user = (req as any).user;
    const order = orders.find((o) => o.id === req.params.id && o.userId === user.userId);
    if (!order) {
      res.status(404).json({ success: false, error: 'Order not found.' });
      return;
    }

    if (['CANCELLED', 'REFUNDED', 'DELIVERED'].includes(order.status)) {
      res.status(400).json({ success: false, error: `Cannot cancel order with status: ${order.status}` });
      return;
    }

    // Restore inventory
    if (order.status === 'PAID') {
      for (const item of order.items) {
        const inv = inventory.find((i) => i.productId === item.productId);
        if (inv) inv.stock += item.quantity;
      }
      order.status = 'REFUNDED';
    } else {
      for (const item of order.items) {
        const inv = inventory.find((i) => i.productId === item.productId);
        if (inv) inv.reserved -= item.quantity;
      }
      order.status = 'CANCELLED';
    }

    res.status(200).json({ success: true, data: order });
  });

  // POST /api/orders/inventory/init (admin only)
  app.post('/api/orders/inventory/init', authMiddleware, (req, res) => {
    const user = (req as any).user;
    if (user.role !== 'ADMIN') {
      res.status(403).json({ success: false, error: 'Admin access required.' });
      return;
    }

    const { productId, stock } = req.body;
    const existing = inventory.find((i) => i.productId === productId);
    if (existing) {
      existing.stock = stock;
    } else {
      inventory.push({ productId, stock, reserved: 0 });
    }

    res.status(200).json({ success: true, message: 'Inventory initialized.' });
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

describe('Order Service', () => {
  let server: http.Server;
  let baseUrl: string;
  const adminToken = generateAdminToken();
  const customerToken = generateCustomerToken();
  const customer2Token = generateCustomerToken('customer-2-id');

  beforeAll(async () => {
    const app = createMockOrderApp();
    const result = await startServer(app);
    server = result.server;
    baseUrl = `http://localhost:${result.port}`;
  });

  afterAll(() => {
    server.close();
  });

  beforeEach(() => {
    seedProducts();
  });

  describe('POST /api/orders/checkout', () => {
    it('should complete checkout with valid cart', async () => {
      const res = await fetch(`${baseUrl}/api/orders/checkout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerToken}`,
        },
        body: JSON.stringify({
          items: [
            { productId: 'prod-1', quantity: 2 },
            { productId: 'prod-2', quantity: 1 },
          ],
        }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expectSuccess(body);
      expect(body.data.order.status).toBe('PAID');
      expect(body.data.order.paymentId).toBeDefined();
      expect(body.data.payment.amount).toBeCloseTo(29.99 * 2 + 49.99);

      // Verify inventory was decremented
      const inv1 = inventory.find((i) => i.productId === 'prod-1')!;
      const inv2 = inventory.find((i) => i.productId === 'prod-2')!;
      expect(inv1.stock).toBe(8);   // 10 - 2
      expect(inv2.stock).toBe(4);   // 5 - 1
    });

    it('should reject checkout when stock is insufficient (409)', async () => {
      const res = await fetch(`${baseUrl}/api/orders/checkout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerToken}`,
        },
        body: JSON.stringify({
          items: [{ productId: 'prod-2', quantity: 999 }],
        }),
      });

      expect(res.status).toBe(409);
      const body = await res.json();
      expectError(body);
      expect(body.error).toContain('Insufficient stock');
    });

    it('should handle payment failure and roll back inventory', async () => {
      // prod-3 costs $9,999.99; buying 2 = $19,999.98 which exceeds $10K limit
      const invBefore = inventory.find((i) => i.productId === 'prod-3')!;
      const stockBefore = invBefore.stock;

      const res = await fetch(`${baseUrl}/api/orders/checkout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerToken}`,
        },
        body: JSON.stringify({
          items: [{ productId: 'prod-3', quantity: 2 }],
        }),
      });

      expect(res.status).toBe(402);
      const body = await res.json();
      expect(body.data.status).toBe('CANCELLED');

      // Verify stock was NOT decremented (rolled back)
      const invAfter = inventory.find((i) => i.productId === 'prod-3')!;
      expect(invAfter.stock).toBe(stockBefore);
      expect(invAfter.reserved).toBe(0);
    });

    it('should prevent overselling with concurrent checkouts', async () => {
      // prod-limited has only 1 in stock
      // Send 2 concurrent checkout requests — only 1 should succeed

      const makeCheckout = () =>
        fetch(`${baseUrl}/api/orders/checkout`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${customerToken}`,
          },
          body: JSON.stringify({
            items: [{ productId: 'prod-limited', quantity: 1 }],
          }),
        });

      const [res1, res2] = await Promise.all([makeCheckout(), makeCheckout()]);

      const body1 = await res1.json();
      const body2 = await res2.json();

      const successes = [body1, body2].filter((b) => b.success === true);
      const failures = [body1, body2].filter((b) => b.success === false);

      // Exactly 1 should succeed, 1 should fail
      expect(successes.length).toBe(1);
      expect(failures.length).toBe(1);

      // Final stock should be 0
      const inv = inventory.find((i) => i.productId === 'prod-limited')!;
      expect(inv.stock).toBe(0);
    });

    it('should reject unauthenticated checkout (401)', async () => {
      const res = await fetch(`${baseUrl}/api/orders/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: [{ productId: 'prod-1', quantity: 1 }],
        }),
      });

      expect(res.status).toBe(401);
    });

    it('should reject empty cart (400)', async () => {
      const res = await fetch(`${baseUrl}/api/orders/checkout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerToken}`,
        },
        body: JSON.stringify({ items: [] }),
      });

      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/orders', () => {
    it('should list only the authenticated user\'s orders', async () => {
      // Create an order for customer 1
      await fetch(`${baseUrl}/api/orders/checkout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerToken}`,
        },
        body: JSON.stringify({ items: [{ productId: 'prod-1', quantity: 1 }] }),
      });

      // Customer 1 should see their order
      const res1 = await fetch(`${baseUrl}/api/orders`, {
        headers: { Authorization: `Bearer ${customerToken}` },
      });
      const body1 = await res1.json();
      expect(body1.data.length).toBeGreaterThanOrEqual(1);

      // Customer 2 should see no orders
      const res2 = await fetch(`${baseUrl}/api/orders`, {
        headers: { Authorization: `Bearer ${customer2Token}` },
      });
      const body2 = await res2.json();
      expect(body2.data.length).toBe(0);
    });
  });

  describe('GET /api/orders/:id', () => {
    it('should return order details with items', async () => {
      const checkoutRes = await fetch(`${baseUrl}/api/orders/checkout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerToken}`,
        },
        body: JSON.stringify({ items: [{ productId: 'prod-1', quantity: 1 }] }),
      });
      const { data } = await checkoutRes.json();

      const res = await fetch(`${baseUrl}/api/orders/${data.order.id}`, {
        headers: { Authorization: `Bearer ${customerToken}` },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(Array.isArray(body.data.items)).toBe(true);
      expect(body.data.items.length).toBeGreaterThanOrEqual(1);
    });

    it('should return 404 for other user\'s order', async () => {
      const checkoutRes = await fetch(`${baseUrl}/api/orders/checkout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerToken}`,
        },
        body: JSON.stringify({ items: [{ productId: 'prod-1', quantity: 1 }] }),
      });
      const { data } = await checkoutRes.json();

      // Try to access with different user
      const res = await fetch(`${baseUrl}/api/orders/${data.order.id}`, {
        headers: { Authorization: `Bearer ${customer2Token}` },
      });

      expect(res.status).toBe(404);
    });
  });

  describe('PATCH /api/orders/:id/cancel', () => {
    it('should cancel order and restore inventory', async () => {
      const checkoutRes = await fetch(`${baseUrl}/api/orders/checkout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerToken}`,
        },
        body: JSON.stringify({ items: [{ productId: 'prod-1', quantity: 3 }] }),
      });
      const { data } = await checkoutRes.json();

      const stockAfterCheckout = inventory.find((i) => i.productId === 'prod-1')!.stock;

      // Cancel the order
      const res = await fetch(`${baseUrl}/api/orders/${data.order.id}/cancel`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${customerToken}` },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.status).toBe('REFUNDED');

      // Verify inventory was restored
      const stockAfterCancel = inventory.find((i) => i.productId === 'prod-1')!.stock;
      expect(stockAfterCancel).toBe(stockAfterCheckout + 3);
    });

    it('should reject cancelling an already cancelled order', async () => {
      const checkoutRes = await fetch(`${baseUrl}/api/orders/checkout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerToken}`,
        },
        body: JSON.stringify({ items: [{ productId: 'prod-1', quantity: 1 }] }),
      });
      const { data } = await checkoutRes.json();

      // Cancel once
      await fetch(`${baseUrl}/api/orders/${data.order.id}/cancel`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${customerToken}` },
      });

      // Try to cancel again
      const res = await fetch(`${baseUrl}/api/orders/${data.order.id}/cancel`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${customerToken}` },
      });

      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/orders/inventory/init (Admin)', () => {
    it('should initialize inventory as admin', async () => {
      const res = await fetch(`${baseUrl}/api/orders/inventory/init`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({ productId: 'new-prod-1', stock: 500 }),
      });

      expect(res.status).toBe(200);
      const inv = inventory.find((i) => i.productId === 'new-prod-1');
      expect(inv).toBeDefined();
      expect(inv!.stock).toBe(500);
    });

    it('should reject inventory init by customer (403)', async () => {
      const res = await fetch(`${baseUrl}/api/orders/inventory/init`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${customerToken}`,
        },
        body: JSON.stringify({ productId: 'test', stock: 10 }),
      });

      expect(res.status).toBe(403);
    });
  });
});
