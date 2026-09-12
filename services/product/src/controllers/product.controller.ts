/**
 * Product Controller — CRUD operations with aggressive Redis caching.
 *
 * Cache strategy:
 * - Listings:  key = `products:list:p{page}:l{limit}:c{category}` — TTL 300s
 * - Details:   key = `products:detail:{id}` — TTL 600s
 * - On write:  Invalidate `products:detail:{id}` + all `products:list:*`
 */

import { Response } from 'express';
import { PrismaClient, Prisma } from '@prisma/client';
import { z } from 'zod';
import { config } from '../config';
import { redisCache } from '../cache/redis.wrapper';
import { AuthRequest } from '../middleware/auth.middleware';

const prisma = new PrismaClient({
  log: config.nodeEnv === 'development' ? ['query', 'warn', 'error'] : ['error'],
});

// ─── Validation Schemas ─────────────────────────────────────────────────────

const createProductSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().min(1),
  price: z.number().positive().max(999999.99),
  category: z.string().min(1).max(100),
  sku: z.string().min(1).max(50),
  imageUrl: z.string().url().optional(),
  stock: z.number().int().nonnegative(),
});

const updateProductSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().min(1).optional(),
  price: z.number().positive().max(999999.99).optional(),
  category: z.string().min(1).max(100).optional(),
  imageUrl: z.string().url().nullable().optional(),
  stock: z.number().int().nonnegative().optional(),
  isActive: z.boolean().optional(),
});

// ─── Cache Key Generators ───────────────────────────────────────────────────

function listCacheKey(page: number, limit: number, category: string): string {
  return `products:list:p${page}:l${limit}:c${category || 'all'}`;
}

function detailCacheKey(id: string): string {
  return `products:detail:${id}`;
}

// ─── Controllers ────────────────────────────────────────────────────────────

/**
 * GET /api/products
 * Paginated product listing with optional category filter.
 * Response is cached in Redis for 300s.
 */
export async function listProducts(req: AuthRequest, res: Response): Promise<void> {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || config.pagination.defaultPage);
    const limit = Math.min(
      config.pagination.maxLimit,
      Math.max(1, parseInt(req.query.limit as string) || config.pagination.defaultLimit)
    );
    const category = (req.query.category as string) || '';

    const cacheKey = listCacheKey(page, limit, category);

    const result = await redisCache.getOrSet(cacheKey, config.cache.listingTtl, async () => {
      const where: Prisma.ProductWhereInput = { isActive: true };
      if (category) {
        where.category = category;
      }

      const [products, total] = await Promise.all([
        prisma.product.findMany({
          where,
          skip: (page - 1) * limit,
          take: limit,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            name: true,
            price: true,
            category: true,
            sku: true,
            imageUrl: true,
            stock: true,
            createdAt: true,
          },
        }),
        prisma.product.count({ where }),
      ]);

      const totalPages = Math.ceil(total / limit);

      return {
        data: products,
        meta: {
          total,
          page,
          limit,
          totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1,
        },
      };
    });

    res.status(200).json({ success: true, ...result });
  } catch (error) {
    console.error('List products error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch products.' });
  }
}

/**
 * GET /api/products/:id
 * Single product detail. Cached for 600s.
 */
export async function getProduct(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const cacheKey = detailCacheKey(id);

    const product = await redisCache.getOrSet(cacheKey, config.cache.detailTtl, async () => {
      return prisma.product.findUnique({
        where: { id },
      });
    });

    if (!product) {
      res.status(404).json({ success: false, error: 'Product not found.' });
      return;
    }

    res.status(200).json({ success: true, data: product });
  } catch (error) {
    console.error('Get product error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch product.' });
  }
}

/**
 * POST /api/products (Admin only)
 * Creates a new product and invalidates listing caches.
 */
export async function createProduct(req: AuthRequest, res: Response): Promise<void> {
  try {
    const validation = createProductSchema.safeParse(req.body);
    if (!validation.success) {
      res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: validation.error.flatten().fieldErrors,
      });
      return;
    }

    const { price, ...rest } = validation.data;

    // Check for duplicate SKU
    const existingSku = await prisma.product.findUnique({ where: { sku: rest.sku } });
    if (existingSku) {
      res.status(409).json({ success: false, error: 'A product with this SKU already exists.' });
      return;
    }

    const product = await prisma.product.create({
      data: {
        ...rest,
        price: new Prisma.Decimal(price),
      },
    });

    // Invalidate listing caches (new product affects pagination)
    await redisCache.invalidatePattern('products:list:*');

    res.status(201).json({ success: true, data: product });
  } catch (error) {
    console.error('Create product error:', error);
    res.status(500).json({ success: false, error: 'Failed to create product.' });
  }
}

/**
 * PUT /api/products/:id (Admin only)
 * Updates a product and invalidates both detail and listing caches.
 */
export async function updateProduct(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const validation = updateProductSchema.safeParse(req.body);

    if (!validation.success) {
      res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: validation.error.flatten().fieldErrors,
      });
      return;
    }

    // Check product exists
    const existing = await prisma.product.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ success: false, error: 'Product not found.' });
      return;
    }

    const { price, ...rest } = validation.data;
    const updateData: Record<string, unknown> = { ...rest };
    if (price !== undefined) {
      updateData.price = new Prisma.Decimal(price);
    }

    const product = await prisma.product.update({
      where: { id },
      data: updateData,
    });

    // Invalidate caches: both detail and all listings
    await Promise.all([
      redisCache.invalidateKey(detailCacheKey(id)),
      redisCache.invalidatePattern('products:list:*'),
    ]);

    res.status(200).json({ success: true, data: product });
  } catch (error) {
    console.error('Update product error:', error);
    res.status(500).json({ success: false, error: 'Failed to update product.' });
  }
}

/**
 * DELETE /api/products/:id (Admin only)
 * Soft-deletes a product (sets isActive = false) and invalidates caches.
 */
export async function deleteProduct(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { id } = req.params;

    const existing = await prisma.product.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ success: false, error: 'Product not found.' });
      return;
    }

    await prisma.product.update({
      where: { id },
      data: { isActive: false },
    });

    // Invalidate caches
    await Promise.all([
      redisCache.invalidateKey(detailCacheKey(id)),
      redisCache.invalidatePattern('products:list:*'),
    ]);

    res.status(200).json({ success: true, message: 'Product deleted successfully.' });
  } catch (error) {
    console.error('Delete product error:', error);
    res.status(500).json({ success: false, error: 'Failed to delete product.' });
  }
}

export { prisma };
