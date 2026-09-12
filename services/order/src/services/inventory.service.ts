/**
 * Inventory Service — Atomic Stock Management
 *
 * Prevents overselling via Prisma interactive transactions with Serializable isolation.
 *
 * Two-phase commit pattern:
 *   1. reserveStock()  → Check availability, increment `reserved`
 *   2. confirmStock()  → Decrement both `stock` and `reserved` (after payment)
 *   3. releaseStock()  → Decrement `reserved` only (on cancellation/failure)
 *
 * The Serializable isolation level ensures that concurrent checkouts for the same
 * product are serialized at the database level, preventing race conditions.
 */

import { PrismaClient, Prisma } from '@prisma/client';
import { config } from '../config';

interface ReservationItem {
  productId: string;
  quantity: number;
}

interface ReservationResult {
  success: boolean;
  reservedItems: ReservationItem[];
  error?: string;
}

const prisma = new PrismaClient({
  log: config.nodeEnv === 'development' ? ['query', 'warn', 'error'] : ['error'],
});

/**
 * Reserve inventory for a set of cart items.
 * Uses a Serializable transaction to prevent race conditions.
 *
 * @param items - Array of { productId, quantity }
 * @returns ReservationResult indicating success/failure
 */
export async function reserveStock(items: ReservationItem[]): Promise<ReservationResult> {
  try {
    const result = await prisma.$transaction(
      async (tx) => {
        const reservedItems: ReservationItem[] = [];

        for (const item of items) {
          // Read current inventory with row-level lock (Serializable isolation)
          const inventory = await tx.inventory.findUnique({
            where: { productId: item.productId },
          });

          if (!inventory) {
            throw new Error(`Inventory record not found for product: ${item.productId}`);
          }

          // Check available stock (stock - reserved)
          const available = inventory.stock - inventory.reserved;
          if (available < item.quantity) {
            throw new Error(
              `Insufficient stock for product ${item.productId}. ` +
              `Available: ${available}, Requested: ${item.quantity}`
            );
          }

          // Increment reserved count
          await tx.inventory.update({
            where: { productId: item.productId },
            data: {
              reserved: { increment: item.quantity },
            },
          });

          reservedItems.push(item);
        }

        return { success: true, reservedItems };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: config.transaction.timeout,
        timeout: config.transaction.timeout,
      }
    );

    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown inventory error';

    // Prisma P2034 = transaction conflict (serialization failure) — retriable
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
      return {
        success: false,
        reservedItems: [],
        error: 'Transaction conflict. Please retry checkout.',
      };
    }

    return {
      success: false,
      reservedItems: [],
      error: message,
    };
  }
}

/**
 * Confirm stock deductions after successful payment.
 * Decrements both `stock` and `reserved` fields.
 *
 * @param items - Array of { productId, quantity } that were previously reserved
 */
export async function confirmStock(items: ReservationItem[]): Promise<void> {
  await prisma.$transaction(
    async (tx) => {
      for (const item of items) {
        await tx.inventory.update({
          where: { productId: item.productId },
          data: {
            stock: { decrement: item.quantity },
            reserved: { decrement: item.quantity },
          },
        });
      }
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      timeout: config.transaction.timeout,
    }
  );
}

/**
 * Release reserved stock (on order cancellation or payment failure).
 * Only decrements the `reserved` field — actual stock is unaffected.
 *
 * @param items - Array of { productId, quantity } to release
 */
export async function releaseStock(items: ReservationItem[]): Promise<void> {
  await prisma.$transaction(
    async (tx) => {
      for (const item of items) {
        await tx.inventory.update({
          where: { productId: item.productId },
          data: {
            reserved: { decrement: item.quantity },
          },
        });
      }
    },
    {
      timeout: config.transaction.timeout,
    }
  );
}

/**
 * Initialize inventory for a product (called when products are created).
 */
export async function initializeInventory(productId: string, stock: number): Promise<void> {
  await prisma.inventory.upsert({
    where: { productId },
    update: { stock },
    create: { productId, stock, reserved: 0 },
  });
}

export { prisma };
