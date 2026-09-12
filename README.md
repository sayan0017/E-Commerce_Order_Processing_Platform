# E-Commerce Order Processing Platform

A TypeScript microservices platform for authentication, product catalog management, inventory, and order processing.

## Architecture

The platform is composed of three independent Express services:

| Service | Port | Responsibility | API prefix |
| --- | ---: | --- | --- |
| Auth | 3001 | User registration, login, JWTs, and role-based access control | `/api/auth` |
| Product | 3002 | Product catalog CRUD with Redis caching | `/api/products` |
| Order | 3003 | Checkout, orders, cancellation, and inventory initialization | `/api/orders` |

Shared infrastructure is provided by Docker Compose:

- PostgreSQL 16 for service data
- Redis 7 for product catalog caching
- A dedicated Docker network for service-to-service communication

## Prerequisites

- Node.js 20 or later
- npm 10 or later
- Docker Desktop with Docker Compose

## Quick Start With Docker

From the repository root:

```bash
npm run install:all
npm run generate:all
npm run docker:up
```

The services will be available at:

- Auth: `http://localhost:3001`
- Product: `http://localhost:3002`
- Order: `http://localhost:3003`

Check service health with:

```bash
curl http://localhost:3001/health
curl http://localhost:3002/health
curl http://localhost:3003/health
```

Apply Prisma migrations when the database is ready:

```bash
npm run migrate:all
```

Useful Docker commands:

```bash
npm run docker:logs    # Follow logs from all containers
npm run docker:down   # Stop containers and remove volumes
```

> `docker:down` removes the PostgreSQL and Redis volumes, so local data will be deleted.

## Local Development

Install all workspace dependencies once:

```bash
npm run install:all
npm run generate:all
```

Start PostgreSQL and Redis without starting the application containers:

```bash
docker compose up -d postgres redis
```

Then start each service in a separate terminal:

```bash
npm run dev:auth
npm run dev:product
npm run dev:order
```

When running services outside Docker, the default local connection settings are:

```text
PostgreSQL: postgresql://ecommerce:ecommerce_secret@localhost:5432/ecommerce
Redis:      redis://localhost:6379
```

The service-specific Prisma schemas use the `auth`, `product`, and `orders` PostgreSQL schemas. Run migrations with:

```bash
npm run migrate:all
```

## API Overview

### Authentication

```text
POST /api/auth/register   Create a customer account
POST /api/auth/login      Authenticate and receive a JWT
GET  /api/auth/profile    Get the authenticated user's profile
```

### Products

```text
GET    /api/products      List products with pagination and optional category filtering
GET    /api/products/:id  Get a product by ID
POST   /api/products      Create a product (ADMIN)
PUT    /api/products/:id  Update a product (ADMIN)
DELETE /api/products/:id  Delete a product (ADMIN)
```

### Orders

All order endpoints require a bearer token.

```text
POST  /api/orders/checkout       Create an order from cart items
GET   /api/orders                List the authenticated user's orders
GET   /api/orders/:id            Get an order by ID
PATCH /api/orders/:id/cancel     Cancel an order
POST  /api/orders/inventory/init Initialize inventory (ADMIN)
```

Send the JWT returned by login in the request header:

```http
Authorization: Bearer <token>
```

Example checkout request:

```json
{
	"items": [
		{ "productId": "product-id", "quantity": 2 }
	]
}
```

## Configuration

The Docker Compose file provides development defaults. For production, set unique secrets and credentials through environment variables instead of using the values committed in `docker-compose.yml`.

Common variables include:

| Variable | Used by | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Auth, Product, Order | PostgreSQL connection string |
| `JWT_SECRET` | Auth, Product, Order | Shared secret used to sign and verify JWTs |
| `JWT_EXPIRES_IN` | Auth | Token lifetime, such as `24h` |
| `REDIS_URL` | Product | Redis connection string |
| `CACHE_TTL_LISTING` | Product | Product-list cache lifetime in seconds |
| `CACHE_TTL_DETAIL` | Product | Product-detail cache lifetime in seconds |
| `PRODUCT_SERVICE_URL` | Order | Internal product service URL |

## Testing and Builds

Run the integration test suite:

```bash
npm test
```

Build each service:

```bash
npm run build:auth
npm run build:product
npm run build:order
```

Tests expect the required services and databases to be available. Start the Docker dependencies and apply migrations before running them.

## Repository Layout

```text
services/
	auth/       Authentication and role-based access control
	product/    Product catalog and Redis cache
	order/      Checkout, orders, payments, and inventory
shared/       Shared TypeScript contracts
tests/        Jest API integration tests
docker-compose.yml
```

## Security Notes

- Replace the default JWT secret, PostgreSQL password, and other credentials before deploying.
- Keep `NODE_ENV=production` in production environments so production configuration validation is enabled.
- Do not commit `.env` files or live credentials.

## License

This project is licensed under the MIT License.