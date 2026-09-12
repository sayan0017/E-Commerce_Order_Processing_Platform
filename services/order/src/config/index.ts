/**
 * Centralized configuration for the Order Service.
 */

export const config = {
  port: parseInt(process.env.PORT || '3003', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  // Database
  databaseUrl: process.env.DATABASE_URL || 'postgresql://ecommerce:ecommerce_secret@localhost:5432/ecommerce?schema=orders',

  // JWT (shared secret with Auth Service)
  jwt: {
    secret: process.env.JWT_SECRET || 'dev_secret_change_in_production',
  },

  // Product Service URL (for price lookups during checkout)
  productServiceUrl: process.env.PRODUCT_SERVICE_URL || 'http://localhost:3002',

  // Transaction settings
  transaction: {
    maxRetries: 3,
    timeout: 10000,    // 10 seconds
    isolationLevel: 'Serializable' as const,
  },
} as const;
