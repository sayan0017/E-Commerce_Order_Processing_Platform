/**
 * Order Service — Entry Point
 *
 * Express server providing order processing and inventory management.
 * Runs on port 3003 by default.
 */

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './config';
import orderRoutes from './routes/order.routes';
import { prisma } from './controllers/order.controller';

const app = express();

// ─── Global Middleware ──────────────────────────────────────────────────────

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '50kb' }));

// ─── Health Check ───────────────────────────────────────────────────────────

app.get('/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.status(200).json({
      status: 'healthy',
      service: 'order-service',
      timestamp: new Date().toISOString(),
    });
  } catch {
    res.status(503).json({
      status: 'unhealthy',
      service: 'order-service',
      timestamp: new Date().toISOString(),
    });
  }
});

// ─── API Routes ─────────────────────────────────────────────────────────────

app.use('/api/orders', orderRoutes);

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

const server = app.listen(config.port, () => {
  console.log(`🛒 Order Service running on port ${config.port} [${config.nodeEnv}]`);
});

// Graceful shutdown
const shutdown = async () => {
  console.log('Shutting down gracefully...');
  server.close();
  await prisma.$disconnect();
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

export default app;
