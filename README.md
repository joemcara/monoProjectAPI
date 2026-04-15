# B2B Orders Backoffice — Monorepo
## Paso 1: Variables de entorno

El proyecto tiene **3 archivos `.env`**, los cuales se tienen que añadir al momento de clonar el repo

### `customers-api/.env`

```env
PORT=3001
DB_HOST=localhost
DB_PORT=3306
DB_USER=appuser
DB_PASSWORD=apppass
DB_NAME=b2b_orders
JWT_SECRET=supersecret
SERVICE_TOKEN=internal-service-token
```

### `orders-api/.env`

```env
PORT=3002
DB_HOST=localhost
DB_PORT=3306
DB_USER=appuser
DB_PASSWORD=apppass
DB_NAME=b2b_orders
JWT_SECRET=supersecret
SERVICE_TOKEN=internal-service-token
CUSTOMERS_API_BASE=http://localhost:3001
```

### `lambda-orchestrator/.env`

```env
CUSTOMERS_API_BASE=http://localhost:3001
ORDERS_API_BASE=http://localhost:3002
SERVICE_TOKEN=internal-service-token
JWT_SECRET=supersecret
```

> **Nota:** Cuando se ejecuta con Docker Compose, las variables se inyectan desde `docker-compose.yml` (los `.env` son para ejecución local sin Docker). Dentro de Docker, `DB_HOST` es `mysql` y `CUSTOMERS_API_BASE` es `http://customers-api:3001`.

---

## Paso 2: Levantar con Docker Compose

### 2.1 Construir y levantar

```bash
docker compose up -d --build
```

Esto levanta 3 contenedores:
- **mysql** — Base de datos MySQL 8 (puerto `3307` del host → `3306` interno) en mi caso estaba ocupando el 3306 por default por eso tome esta decisión 
- **customers-api** — Puerto `3001`
- **orders-api** — Puerto `3002`

La base de datos se inicializa automáticamente con `db/schema.sql` y `db/seed.sql`.

### 2.2 Verificar que todo esté corriendo

```bash
docker compose ps
```

```bash
curl http://localhost:3001/health

curl http://localhost:3002/health
```

### 2.3 Documentación Swagger

- Customers API: http://localhost:3001/api-docs
- Orders API: http://localhost:3002/api-docs

### 2.4 Reiniciar base de datos (si es necesario)

```bash
docker compose down -v
docker compose up -d --build
```

El flag `-v` elimina los volúmenes y recrea la BD desde cero con el schema y seed.

---

## Paso 3: Levantar el Lambda Orchestrator

El orquestador se ejecuta **fuera de Docker** con Serverless Offline.

### 3.1 Instalar dependencias

```bash
cd lambda-orchestrator
npm install
```

### 3.2 Ejecutar en modo local

```bash
npm run dev
```

El Lambda queda disponible en `http://localhost:3003`.

### 3.3 Probar el orquestador

```bash
curl -X POST http://localhost:3003/orchestrator/create-and-confirm-order \
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
      "total_cents": 179700,
      "items": [
        {
          "product_id": 2,
          "qty": 3,
          "unit_price_cents": 59900,
          "subtotal_cents": 179700
        }
      ]
    }
  }
}
```

---

## Paso 4: Exponer con ngrok

Para que el Lambda Orchestrator (o cualquier cliente externo) pueda acceder a las APIs, se exponen con ngrok.

### 4.1 Exponer lambda 

En el proyecto en la carpeta **lambda-orchestrator** ejecutar el siguiente comando:

1. npm i
2. npm run dev 
 
posteriormente en otra terminal ejecutar el siguiente comando para exponer el lambda usando ngrok:

**Terminal**
```bash
ngrok http 3003
```
Y podremos usar el mismo endpoint mencionado en el paso 3.3 pero con la url que nos de ngrok.

```bash
curl -X POST {{ngrokUrl}}/orchestrator/create-and-confirm-order \
  -H "Content-Type: application/json" \
  -d '{
    "customer_id": 1,
    "items": [{"product_id": 2, "qty": 3}],
    "idempotency_key": "abc-123",
    "correlation_id": "req-789"
  }'
```

---

## Paso 5: Deploy en AWS

```bash
cd lambda-orchestrator

# Configurar las variables con las URLs públicas de las APIs
export CUSTOMERS_API_BASE=https://tu-customers-api.com
export ORDERS_API_BASE=https://tu-orders-api.com
export SERVICE_TOKEN=internal-service-token
export JWT_SECRET=supersecret

serverless deploy
```

---

## Autenticación

Los usuarios se almacenan en la tabla `users` de la base de datos. El seed incluye:

| Username | Password | Role |
|---|---|---|
| `admin` | `admin123` | `operator` |

### Obtener token JWT

```bash
curl -X POST http://localhost:3001/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "admin123"}'
```

Respuesta:
```json
{"token": "eyJhbGciOiJIUzI1NiIs...", "expiresIn": "24h"}
```

Ambas APIs comparten el mismo `JWT_SECRET`, así que un token generado en cualquiera sirve para ambas.

---

