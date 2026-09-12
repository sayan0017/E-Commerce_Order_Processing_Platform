/**
 * Centralized configuration for the Auth Service.
 * All environment variables are validated and typed here.
 */

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  // Database
  databaseUrl: process.env.DATABASE_URL || 'postgresql://ecommerce:ecommerce_secret@localhost:5432/ecommerce?schema=auth',

  // JWT
  jwt: {
    secret: process.env.JWT_SECRET || 'dev_secret_change_in_production',
    expiresIn: process.env.JWT_EXPIRES_IN || '24h',
  },

  // Bcrypt
  bcrypt: {
    saltRounds: parseInt(process.env.BCRYPT_SALT_ROUNDS || '12', 10),
  },
} as const;

// Validate critical config at startup
export function validateConfig(): void {
  if (config.nodeEnv === 'production' && config.jwt.secret === 'dev_secret_change_in_production') {
    throw new Error('JWT_SECRET must be set in production environment');
  }
}
