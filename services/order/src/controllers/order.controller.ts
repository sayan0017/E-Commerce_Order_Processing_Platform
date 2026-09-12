/**
 * Order Controller — Checkout Workflow & Order Management
 *
 * Checkout flow:
 *   1. Validate cart items
 *   2. Fetch product prices from DB
 *   3. Reserve inventory (atomic transaction)
 *   4. Process payment
 *   5. Confirm order + confirm stock deductions
 *   6. On payment failure: release reserved stock + mark order cancelled
 */

import { Response } from 'express';
import { PrismaClient, Prisma } from '@prisma/client';
import { z } from 'zod';
import { config } from '../config';
import { AuthRequest } from '../middleware/auth.middleware';
import { reserveStock, confirmStock, releaseStock, initializeInventory } from '../services/inventory.service';
import { processPayment, processRefund } from '../services/payment.service';

const prisma = new PrismaClient({
  log: config.nodeEnv === 'development' ? ['query', 'warn', 'error'] : ['error'],
});

// ─── Validation Schemas ─────────────────────────────────────────────────────

const cartItemSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int().positive().max(100),
});

const checkoutSchema = z.object({
  items: z.array(cartItemSchema).min(1).max(50),
});

const initInventorySchema = z.object({
  productId: z.string().uuid(),
  stock: z.number().int().nonnegative(),
});

// ─── Controllers ────────────────────────────────────────────────────────────

/**
 * POST /api/orders/checkout
 * Full checkout flow: validate → reserve → pay → confirm.
 */
export async function checkout(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, error: 'Authentication required.' });
      return;
    }

    const validation = checkoutSchema.safeParse(req.body);
    if (!validation.success) {
      res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: validation.error.flatten().fieldErrors,
      });
      return;
    }

    const { items } = validation.data;
    const userId = req.user.userId;

    // ── Step 1: Fetch product prices and validate existence ────────
    const productIds = items.map((i) => i.productId);
    const inventoryRecords = await prisma.inventory.findMany({
      where: { productId: { in: productIds } },
    });

    if (inventoryRecords.length !== productIds.length) {
      const foundIds = new Set(inventoryRecords.map((r) => r.productId));
      const missing = productIds.filter((id) => !foundIds.has(id));
      res.status(404).json({
        success: false,
        error: `Products not found in inventory: ${missing.join(', ')}`,
      });
      return;
    }

    // For price lookup, we use a raw query since products may be in another schema.
    // In a real system, this would be an API call to the Product Service.
    // Here we query directly since we share the same DB instance.
    const productPrices = await prisma.$queryRawUnsafe<Array<{ id: string; price: string; name: string }>>(
      `SELECT id, price::text, name FROM product.products WHERE id = ANY($1::uuid[]) AND is_active = true`,
      productIds
    );

    if (productPrices.length !== productIds.length) {
      res.status(404).json({
        success: false,
        error: 'One or more products are unavailable.',
      });
      return;
    }

    const priceMap = new Map(productPrices.map((p) => [p.id, parseFloat(p.price)]));

    // Calculate total
    let totalAmount = 0;
    for (const item of items) {
      const price = priceMap.get(item.productId);
      if (!price) {
        res.status(404).json({
          success: false,
          error: `Price not found for product ${item.productId}`,
        });
        return;
      }
      totalAmount += price * item.quantity;
    }

    // ── Step 2: Reserve inventory (atomic) ─────────────────────────
    const reservation = await reserveStock(items);

    if (!reservation.success) {
      res.status(409).json({
        success: false,
        error: reservation.error || 'Failed to reserve inventory.',
      });
      return;
    }

    // ── Step 3: Create pending order ───────────────────────────────
    const order = await prisma.order.create({
      data: {
        userId,
        status: 'PENDING',
        totalAmount: new Prisma.Decimal(totalAmount),
        items: {
          create: items.map((item) => ({
            productId: item.productId,
            quantity: item.quantity,
            unitPrice: new Prisma.Decimal(priceMap.get(item.productId)!),
          })),
        },
      },
      include: { items: true },
    });

    // ── Step 4: Process payment ────────────────────────────────────
    const paymentResult = await processPayment(totalAmount, userId);

    if (!paymentResult.success) {
      // Payment failed — release reserved stock and cancel order
      await releaseStock(items);
      await prisma.order.update({
        where: { id: order.id },
        data: { status: 'CANCELLED' },
      });

      res.status(402).json({
        success: false,
        error: paymentResult.message,
        data: { orderId: order.id, status: 'CANCELLED' },
      });
      return;
    }

    // ── Step 5: Confirm order + stock deductions ───────────────────
    await confirmStock(items);

    const confirmedOrder = await prisma.order.update({
      where: { id: order.id },
      data: {
        status: 'PAID',
        paymentId: paymentResult.paymentId,
      },
      include: { items: true },
    });

    res.status(201).json({
      success: true,
      data: {
        order: confirmedOrder,
        payment: {
          paymentId: paymentResult.paymentId,
          amount: paymentResult.amount,
          processedAt: paymentResult.processedAt,
        },
      },
    });
  } catch (error) {
    console.error('Checkout error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error during checkout.',
    });
  }
}

/**
 * GET /api/orders
 * List the authenticated user's orders (paginated).
 */
export async function listOrders(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, error: 'Authentication required.' });
      return;
    }

    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 10));
    const userId = req.user.userId;

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where: { userId },
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          items: {
            select: {
              id: true,
              productId: true,
              quantity: true,
              unitPrice: true,
            },
          },
        },
      }),
      prisma.order.count({ where: { userId } }),
    ]);

    const totalPages = Math.ceil(total / limit);

    res.status(200).json({
      success: true,
      data: orders,
      meta: {
        total,
        page,
        limit,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    });
  } catch (error) {
    console.error('List orders error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch orders.' });
  }
}

/**
 * GET /api/orders/:id
 * Get a specific order with line items.
 */
export async function getOrder(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, error: 'Authentication required.' });
      return;
    }

    const { id } = req.params;

    const order = await prisma.order.findFirst({
      where: {
        id,
        userId: req.user.userId,  // Users can only view their own orders
      },
      include: { items: true },
    });

    if (!order) {
      res.status(404).json({ success: false, error: 'Order not found.' });
      return;
    }

    res.status(200).json({ success: true, data: order });
  } catch (error) {
    console.error('Get order error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch order.' });
  }
}

/**
 * PATCH /api/orders/:id/cancel
 * Cancel an order and release reserved/deducted inventory.
 */
export async function cancelOrder(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, error: 'Authentication required.' });
      return;
    }

    const { id } = req.params;

    const order = await prisma.order.findFirst({
      where: { id, userId: req.user.userId },
      include: { items: true },
    });

    if (!order) {
      res.status(404).json({ success: false, error: 'Order not found.' });
      return;
    }

    if (['CANCELLED', 'REFUNDED', 'DELIVERED'].includes(order.status)) {
      res.status(400).json({
        success: false,
        error: `Cannot cancel order with status: ${order.status}`,
      });
      return;
    }

    const itemsToRelease = order.items.map((item) => ({
      productId: item.productId,
      quantity: item.quantity,
    }));

    // If order was PAID, we need to restore stock and process refund
    if (order.status === 'PAID') {
      // Restore stock (add back to available)
      await prisma.$transaction(async (tx) => {
        for (const item of itemsToRelease) {
          await tx.inventory.update({
            where: { productId: item.productId },
            data: {
              stock: { increment: item.quantity },
            },
          });
        }
      });

      // Process refund if there was a payment
      if (order.paymentId) {
        await processRefund(order.paymentId, Number(order.totalAmount));
      }
    } else if (order.status === 'PENDING' || order.status === 'CONFIRMED') {
      // Release reserved stock
      await releaseStock(itemsToRelease);
    }

    const cancelledOrder = await prisma.order.update({
      where: { id },
      data: { status: order.status === 'PAID' ? 'REFUNDED' : 'CANCELLED' },
      include: { items: true },
    });

    res.status(200).json({
      success: true,
      data: cancelledOrder,
      message: order.status === 'PAID'
        ? 'Order refunded and inventory restored.'
        : 'Order cancelled and inventory released.',
    });
  } catch (error) {
    console.error('Cancel order error:', error);
    res.status(500).json({ success: false, error: 'Failed to cancel order.' });
  }
}

/**
 * POST /api/orders/inventory/init (Admin only)
 * Initialize or update inventory for a product.
 */
export async function initInventory(req: AuthRequest, res: Response): Promise<void> {
  try {
    const validation = initInventorySchema.safeParse(req.body);
    if (!validation.success) {
      res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: validation.error.flatten().fieldErrors,
      });
      return;
    }

    await initializeInventory(validation.data.productId, validation.data.stock);

    res.status(200).json({
      success: true,
      message: 'Inventory initialized successfully.',
    });
  } catch (error) {
    console.error('Init inventory error:', error);
    res.status(500).json({ success: false, error: 'Failed to initialize inventory.' });
  }
}

export { prisma };
