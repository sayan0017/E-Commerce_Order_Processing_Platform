/**
 * Shared type definitions for the E-Commerce Order Processing Platform.
 * These types define the contract between microservices.
 */

// ─── Auth Types ─────────────────────────────────────────────────────────────

export enum Role {
  ADMIN = 'ADMIN',
  CUSTOMER = 'CUSTOMER',
}

export interface JwtPayload {
  userId: string;
  email: string;
  role: Role;
  iat?: number;
  exp?: number;
}

export interface AuthenticatedRequest {
  user?: JwtPayload;
}

// ─── Product Types ──────────────────────────────────────────────────────────

export interface ProductCreateInput {
  name: string;
  description: string;
  price: number;
  category: string;
  sku: string;
  imageUrl?: string;
  stock: number;
}

export interface ProductUpdateInput {
  name?: string;
  description?: string;
  price?: number;
  category?: string;
  imageUrl?: string;
  stock?: number;
  isActive?: boolean;
}

export interface PaginationQuery {
  page?: number;
  limit?: number;
  category?: string;
  cursor?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

// ─── Order Types ────────────────────────────────────────────────────────────

export enum OrderStatus {
  PENDING = 'PENDING',
  CONFIRMED = 'CONFIRMED',
  PAID = 'PAID',
  SHIPPED = 'SHIPPED',
  DELIVERED = 'DELIVERED',
  CANCELLED = 'CANCELLED',
  REFUNDED = 'REFUNDED',
}

export interface CartItem {
  productId: string;
  quantity: number;
}

export interface CheckoutRequest {
  items: CartItem[];
}

export interface PaymentResult {
  success: boolean;
  paymentId: string | null;
  message: string;
  amount: number;
}

// ─── API Response Types ─────────────────────────────────────────────────────

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}
