/**
 * Product Service — Entry Point
 *
 * Express server providing product catalog management with Redis caching.
 * Runs on port 3002 by default.
 */

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './config';
import productRoutes from './routes/product.routes';
import { redisCache } from './cache/redis.wrapper';
import { prisma } from './controllers/product.controller';

const app = express();

// ─── Global Middleware ──────────────────────────────────────────────────────

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10kb' }));

// ─── Health Check ───────────────────────────────────────────────────────────

app.get('/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.status(200).json({
      status: 'healthy',
      service: 'product-service',
      redis: redisCache.connected ? 'connected' : 'disconnected',
      timestamp: new Date().toISOString(),
    });
  } catch {
    res.status(503).json({
      status: 'unhealthy',
      service: 'product-service',
      timestamp: new Date().toISOString(),
    });
  }
});

// ─── API Routes ─────────────────────────────────────────────────────────────

app.use('/api/products', productRoutes);

// ─── 404 Handler ────────────────────────────────────────────────────────────

app.use((_req, res) => {
  res.status(404).json({ success: false, error: 'Route not found' });
});

// ─── Global Error Handler ───────────────────────────────────────────────────

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    success: false,
    error: config.nodeEnv === 'production' ? 'Internal server error' : err.message,
  });
});

// ─── Start Server ───────────────────────────────────────────────────────────

async function start() {
  // Connect Redis
  await redisCache.connect();

  const server = app.listen(config.port, () => {
    console.log(`📦 Product Service running on port ${config.port} [${config.nodeEnv}]`);
  });

  // Graceful shutdown
  const shutdown = async () => {
    console.log('Shutting down gracefully...');
    server.close();
    await redisCache.disconnect();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

start().catch((err) => {
  console.error('Failed to start Product Service:', err);
  process.exit(1);
});

export default app;
