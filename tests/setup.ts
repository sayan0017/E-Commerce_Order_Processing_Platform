/**
 * Global Test Setup
 *
 * Handles Prisma client initialization and database seeding for tests.
 */

import { PrismaClient as AuthPrismaClient } from '../services/auth/node_modules/@prisma/client';
import { PrismaClient as ProductPrismaClient } from '../services/product/node_modules/@prisma/client';
import { PrismaClient as OrderPrismaClient } from '../services/order/node_modules/@prisma/client';

// These clients will be used if tests need direct DB access for setup/teardown
export const authDb = new AuthPrismaClient({
  datasources: {
    db: {
      url: process.env.AUTH_DATABASE_URL || 'postgresql://ecommerce:ecommerce_secret@localhost:5432/ecommerce?schema=auth',
    },
  },
});

export const productDb = new ProductPrismaClient({
  datasources: {
    db: {
      url: process.env.PRODUCT_DATABASE_URL || 'postgresql://ecommerce:ecommerce_secret@localhost:5432/ecommerce?schema=product',
    },
  },
});

export const orderDb = new OrderPrismaClient({
  datasources: {
    db: {
      url: process.env.ORDER_DATABASE_URL || 'postgresql://ecommerce:ecommerce_secret@localhost:5432/ecommerce?schema=orders',
    },
  },
});

// Disconnect all clients after all tests
afterAll(async () => {
  await authDb.$disconnect();
  await productDb.$disconnect();
  await orderDb.$disconnect();
});
