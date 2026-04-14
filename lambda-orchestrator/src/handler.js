const express = require('express');
const serverless = require('serverless-http');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const { z } = require('zod');

const app = express();
app.use(express.json());

const CUSTOMERS_API_BASE = process.env.CUSTOMERS_API_BASE || 'http://localhost:3001';
const ORDERS_API_BASE = process.env.ORDERS_API_BASE || 'http://localhost:3002';
const SERVICE_TOKEN = process.env.SERVICE_TOKEN || 'internal-service-token';
const JWT_SECRET = process.env.JWT_SECRET || 'supersecret';

// Generate a JWT for the Lambda to authenticate with Orders API
function generateServiceJwt() {
  return jwt.sign(
    { id: 0, username: 'lambda-service', role: 'service' },
    JWT_SECRET,
    { expiresIn: '1h' }
  );
}

// Validation schema
const orchestratorSchema = z.object({
  customer_id: z.number().int().positive(),
  items: z.array(z.object({
    product_id: z.number().int().positive(),
    qty: z.number().int().positive(),
  })).min(1),
  idempotency_key: z.string().min(1),
  correlation_id: z.string().optional(),
});

// POST /orchestrator/create-and-confirm-order
app.post('/orchestrator/create-and-confirm-order', async (req, res) => {
  const correlationId = req.body.correlation_id || `corr-${Date.now()}`;

  try {
    // 1. Validate input
    const validation = orchestratorSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        success: false,
        correlationId,
        error: 'Validation error',
        details: validation.error.issues,
      });
    }

    const { customer_id, items, idempotency_key } = validation.data;
    const jwtToken = generateServiceJwt();

    // 2. Validate customer via Customers API /internal
    let customer;
    try {
      const customerRes = await axios.get(
        `${CUSTOMERS_API_BASE}/internal/customers/${customer_id}`,
        { headers: { Authorization: `Bearer ${SERVICE_TOKEN}` } }
      );
      customer = customerRes.data;
    } catch (err) {
      const status = err.response?.status || 500;
      return res.status(status === 404 ? 404 : 502).json({
        success: false,
        correlationId,
        error: `Customer validation failed: ${err.response?.data?.error || err.message}`,
      });
    }

    // 3. Create order via Orders API
    let order;
    try {
      const orderRes = await axios.post(
        `${ORDERS_API_BASE}/orders`,
        { customer_id, items },
        { headers: { Authorization: `Bearer ${jwtToken}` } }
      );
      order = orderRes.data;
    } catch (err) {
      return res.status(err.response?.status || 502).json({
        success: false,
        correlationId,
        error: `Order creation failed: ${err.response?.data?.error || err.message}`,
      });
    }

    // 4. Confirm order via Orders API (idempotent)
    let confirmedOrder;
    try {
      const confirmRes = await axios.post(
        `${ORDERS_API_BASE}/orders/${order.id}/confirm`,
        {},
        {
          headers: {
            Authorization: `Bearer ${jwtToken}`,
            'X-Idempotency-Key': idempotency_key,
          },
        }
      );
      confirmedOrder = confirmRes.data;
    } catch (err) {
      return res.status(err.response?.status || 502).json({
        success: false,
        correlationId,
        error: `Order confirmation failed: ${err.response?.data?.error || err.message}`,
      });
    }

    // 5. Return consolidated response
    res.status(201).json({
      success: true,
      correlationId,
      data: {
        customer: {
          id: customer.id,
          name: customer.name,
          email: customer.email,
          phone: customer.phone,
        },
        order: {
          id: confirmedOrder.id,
          status: confirmedOrder.status,
          total_cents: confirmedOrder.total_cents,
          items: confirmedOrder.items.map(item => ({
            product_id: item.product_id,
            qty: item.qty,
            unit_price_cents: item.unit_price_cents,
            subtotal_cents: item.subtotal_cents,
          })),
        },
      },
    });
  } catch (err) {
    console.error('Orchestrator error:', err);
    res.status(500).json({
      success: false,
      correlationId,
      error: 'Internal orchestrator error',
    });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'lambda-orchestrator' });
});

module.exports.handler = serverless(app);
