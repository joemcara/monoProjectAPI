# B2B Orders Backoffice — Monorepo

Sistema compuesto por **dos APIs** (Customers y Orders) y un **Lambda orquestador**, operando sobre MySQL con Docker Compose.

## Arquitectura

```
┌─────────────────┐     ┌─────────────────┐
│  Customers API  │◄────│   Orders API    │
│   :3001         │     │   :3002         │
│                 │     │                 │
│ • CRUD clientes │     │ • CRUD productos│
│ • /internal     │     │ • CRUD órdenes  │
│   (service-to-  │     │ • Confirm/Cancel│
│    service)     │     │ • Idempotency   │
└────────┬────────┘     └────────┬────────┘
         │                       │
         └───────┬───────────────┘
                 │
         ┌───────▼───────┐
         │    MySQL 8    │
         │   :3306       │
         │  b2b_orders   │
         └───────────────┘

┌──────────────────────────┐
│   Lambda Orchestrator    │
│   :3000 (offline)        │
│                          │
│ POST /orchestrator/      │
│   create-and-confirm-    │
│   order                  │
│                          │
│ Llama a Customers API    │
│ y Orders API             │
└──────────────────────────┘
```

## Estructura del repositorio

```
monoProjectAPI/
├── customers-api/       # API de clientes (Express, puerto 3001)
│   ├── src/
│   ├── openapi.yaml
│   ├── Dockerfile
│   └── package.json
├── orders-api/          # API de pedidos y productos (Express, puerto 3002)
│   ├── src/
│   ├── openapi.yaml
│   ├── Dockerfile
│   └── package.json
├── lambda-orchestrator/ # Lambda orquestador (Serverless Framework)
│   ├── src/
│   ├── openapi.yaml
│   ├── serverless.yml
│   └── package.json
├── db/
│   ├── schema.sql       # Esquema de base de datos
│   └── seed.sql         # Datos de ejemplo
├── docker-compose.yml
└── README.md
```

## Requisitos previos

- Docker Desktop instalado y corriendo
- Node.js 22+ (solo para Lambda local)
- npm

## Levantamiento con Docker Compose

### 1. Clonar el repositorio

```bash
git clone <URL_DEL_REPO>
cd monoProjectAPI
```

### 2. Construir y levantar

```bash
docker-compose build
docker-compose up -d
```

### 3. Verificar servicios

```bash
curl http://localhost:3001/health
# → {"status":"ok","service":"customers-api","timestamp":"..."}

curl http://localhost:3002/health
# → {"status":"ok","service":"orders-api","timestamp":"..."}
```

## Variables de entorno

Cada servicio usa las siguientes variables (ya configuradas en `docker-compose.yml`):

| Variable | Valor por defecto | Descripción |
|---|---|---|
| `PORT` | 3001/3002 | Puerto del servicio |
| `DB_HOST` | mysql | Host de MySQL |
| `DB_PORT` | 3306 | Puerto de MySQL |
| `DB_USER` | appuser | Usuario de MySQL |
| `DB_PASSWORD` | apppass | Contraseña de MySQL |
| `DB_NAME` | b2b_orders | Base de datos |
| `JWT_SECRET` | supersecret | Secreto para firmar JWT |
| `SERVICE_TOKEN` | internal-service-token | Token para endpoints /internal |
| `CUSTOMERS_API_BASE` | http://customers-api:3001 | URL de Customers API (usado por Orders API) |

## Autenticación

### Obtener token JWT

Ambas APIs comparten el mismo `JWT_SECRET`, así que un token generado en cualquiera sirve para ambas.

```bash
curl -X POST http://localhost:3001/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "admin123"}'
```

Respuesta:
```json
{"token": "eyJhbGciOiJIUzI1NiIs...", "expiresIn": "24h"}
```

**Credenciales**: `admin` / `admin123`

## Ejemplos cURL

### Customers API (puerto 3001)

```bash
# Obtener token
TOKEN=$(curl -s -X POST http://localhost:3001/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}' | jq -r '.token')

# Crear cliente
curl -X POST http://localhost:3001/customers \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "TechCorp", "email": "info@techcorp.com", "phone": "+1-555-9999"}'

# Obtener cliente
curl http://localhost:3001/customers/1 \
  -H "Authorization: Bearer $TOKEN"

# Buscar clientes
curl "http://localhost:3001/customers?search=ACME&limit=10" \
  -H "Authorization: Bearer $TOKEN"

# Actualizar cliente
curl -X PUT http://localhost:3001/customers/1 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"phone": "+1-555-1111"}'

# Eliminar cliente (soft-delete)
curl -X DELETE http://localhost:3001/customers/1 \
  -H "Authorization: Bearer $TOKEN"

# Endpoint interno (service-to-service)
curl http://localhost:3001/internal/customers/1 \
  -H "Authorization: Bearer internal-service-token"
```

### Orders API (puerto 3002)

```bash
# Obtener token
TOKEN=$(curl -s -X POST http://localhost:3002/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}' | jq -r '.token')

# Crear producto
curl -X POST http://localhost:3002/products \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"sku": "SKU-100", "name": "Premium Widget", "price_cents": 249900, "stock": 30}'

# Listar productos
curl "http://localhost:3002/products?search=Widget" \
  -H "Authorization: Bearer $TOKEN"

# Actualizar stock
curl -X PATCH http://localhost:3002/products/1 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"stock": 200}'

# Crear orden (usa customer_id del seed)
curl -X POST http://localhost:3002/orders \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"customer_id": 1, "items": [{"product_id": 1, "qty": 2}, {"product_id": 2, "qty": 1}]}'

# Ver orden con items
curl http://localhost:3002/orders/1 \
  -H "Authorization: Bearer $TOKEN"

# Confirmar orden (idempotente)
curl -X POST http://localhost:3002/orders/1/confirm \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Idempotency-Key: my-unique-key-001"

# Repetir con misma key → misma respuesta (idempotente)
curl -X POST http://localhost:3002/orders/1/confirm \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Idempotency-Key: my-unique-key-001"

# Cancelar orden
curl -X POST http://localhost:3002/orders/1/cancel \
  -H "Authorization: Bearer $TOKEN"

# Buscar órdenes por estado
curl "http://localhost:3002/orders?status=CONFIRMED&limit=10" \
  -H "Authorization: Bearer $TOKEN"
```

## Lambda Orchestrator

### Ejecución local (serverless-offline)

```bash
cd lambda-orchestrator
npm install
npm run dev
```

El Lambda queda disponible en `http://localhost:3000`.

### Invocar desde Postman/cURL

```bash
curl -X POST http://localhost:3000/orchestrator/create-and-confirm-order \
  -H "Content-Type: application/json" \
  -d '{
    "customer_id": 1,
    "items": [{"product_id": 2, "qty": 3}],
    "idempotency_key": "abc-123",
    "correlation_id": "req-789"
  }'
```

Respuesta esperada (201):
```json
{
  "success": true,
  "correlationId": "req-789",
  "data": {
    "customer": {
      "id": 1,
      "name": "ACME Corp",
      "email": "ops@acme.com",
      "phone": "+1-555-0001"
    },
    "order": {
      "id": 1,
      "status": "CONFIRMED",
      "total_cents": 389700,
      "items": [
        {
          "product_id": 2,
          "qty": 3,
          "unit_price_cents": 129900,
          "subtotal_cents": 389700
        }
      ]
    }
  }
}
```

### Con ngrok (URL pública)

```bash
# Exponer Customers API
ngrok http 3001
# → https://abc123.ngrok-free.app

# Exponer Orders API
ngrok http 3002
# → https://def456.ngrok-free.app

# Configurar Lambda con URLs públicas
CUSTOMERS_API_BASE=https://abc123.ngrok-free.app \
ORDERS_API_BASE=https://def456.ngrok-free.app \
npm run dev
```

### Despliegue en AWS

```bash
cd lambda-orchestrator

# Configurar variables
export CUSTOMERS_API_BASE=https://tu-customers-api.com
export ORDERS_API_BASE=https://tu-orders-api.com

serverless deploy
```

## Base de datos

### Tablas

| Tabla | Descripción |
|---|---|
| `customers` | Clientes (soft-delete con `deleted_at`) |
| `products` | Productos con SKU único y stock |
| `orders` | Pedidos con estado CREATED/CONFIRMED/CANCELED |
| `order_items` | Líneas de pedido con precios y subtotales |
| `idempotency_keys` | Claves de idempotencia para confirmación |

### Reiniciar base de datos

```bash
docker-compose down -v   # Elimina volúmenes (datos)
docker-compose up -d     # Recrea con schema.sql + seed.sql
```

## Documentación OpenAPI

Cada servicio incluye su spec OpenAPI 3.0:
- `customers-api/openapi.yaml`
- `orders-api/openapi.yaml`
- `lambda-orchestrator/openapi.yaml`

## Stack tecnológico

- **Runtime**: Node.js 22
- **Framework**: Express
- **Base de datos**: MySQL 8
- **Validación**: Zod
- **Autenticación**: JWT (jsonwebtoken)
- **Lambda**: Serverless Framework v3 + serverless-offline
- **Contenedores**: Docker + Docker Compose
