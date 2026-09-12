/**
 * Auth Service — Entry Point
 *
 * Express server providing JWT-based authentication and RBAC.
 * Runs on port 3001 by default.
 */

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config, validateConfig } from './config';
import authRoutes from './routes/auth.routes';
import { prisma } from './controllers/auth.controller';

// Validate config before starting
if (config.nodeEnv === 'production') {
  validateConfig();
}

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
      service: 'auth-service',
      timestamp: new Date().toISOString(),
    });
  } catch {
    res.status(503).json({
      status: 'unhealthy',
      service: 'auth-service',
      timestamp: new Date().toISOString(),
    });
  }
});

// ─── API Routes ─────────────────────────────────────────────────────────────

app.use('/api/auth', authRoutes);

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
  console.log(`🔐 Auth Service running on port ${config.port} [${config.nodeEnv}]`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received. Shutting down gracefully...');
  server.close();
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received. Shutting down gracefully...');
  server.close();
  await prisma.$disconnect();
  process.exit(0);
});

export default app;
