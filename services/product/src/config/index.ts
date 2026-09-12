/**
 * Centralized configuration for the Product Service.
 */

export const config = {
  port: parseInt(process.env.PORT || '3002', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  // Database
  databaseUrl: process.env.DATABASE_URL || 'postgresql://ecommerce:ecommerce_secret@localhost:5432/ecommerce?schema=product',

  // Redis
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',

  // JWT (shared secret with Auth Service)
  jwt: {
    secret: process.env.JWT_SECRET || 'dev_secret_change_in_production',
  },

  // Cache TTLs (seconds)
  cache: {
    listingTtl: parseInt(process.env.CACHE_TTL_LISTING || '300', 10),   // 5 minutes
    detailTtl: parseInt(process.env.CACHE_TTL_DETAIL || '600', 10),     // 10 minutes
  },

  // Pagination defaults
  pagination: {
    defaultPage: 1,
    defaultLimit: 20,
    maxLimit: 100,
  },
} as const;
