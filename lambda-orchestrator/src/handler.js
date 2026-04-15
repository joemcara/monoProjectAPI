const express = require('express');
const serverless = require('serverless-http');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const { z } = require('zod');

const app = express();
app.use(express.json());

const CUSTOMERS_API_BASE = process.env.CUSTOMERS_API_BASE;
const ORDERS_API_BASE = process.env.ORDERS_API_BASE;
const SERVICE_TOKEN = process.env.SERVICE_TOKEN;
const JWT_SECRET = process.env.JWT_SECRET;

const orchestratorSchema = z.object({
  customer_id: z.number().int().positive(),
  items: z.array(z.object({
    product_id: z.number().int().positive(),
    qty: z.number().int().positive(),
  })).min(1),
  idempotency_key: z.string().min(1),
  correlation_id: z.string().optional(),
});

function generateServiceJwt() {
  return jwt.sign(
    { id: 0, username: 'lambda-service', role: 'service' },
    JWT_SECRET,
    { expiresIn: '1h' }
  );
}

function validateRequestBody(body) {
  const result = orchestratorSchema.safeParse(body);
  if (!result.success) {
    return { data: null, error: result.error.issues };
  }
  return { data: result.data, error: null };
}

async function fetchCustomer(customerId) {
  const response = await axios.get(
    `${CUSTOMERS_API_BASE}/internal/customers/${customerId}`,
    { headers: { Authorization: `Bearer ${SERVICE_TOKEN}` } }
  );
  return response.data;
}

async function requestCreateOrder(customerId, items, jwtToken) {
  const response = await axios.post(
    `${ORDERS_API_BASE}/orders`,
    { customer_id: customerId, items },
    { headers: { Authorization: `Bearer ${jwtToken}` } }
  );
  return response.data;
}

async function requestConfirmOrder(orderId, idempotencyKey, jwtToken) {
  const response = await axios.post(
    `${ORDERS_API_BASE}/orders/${orderId}/confirm`,
    {},
    {
      headers: {
        Authorization: `Bearer ${jwtToken}`,
        'X-Idempotency-Key': idempotencyKey,
      },
    }
  );
  return response.data;
}

function buildSuccessResponse(correlationId, customer, confirmedOrder) {
  return {
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
  };
}

function buildErrorResponse(correlationId, error) {
  return { success: false, correlationId, error };
}

function resolveErrorStatus(err, defaultNotFoundStatus) {
  const status = err.response?.status || 500;
  return status === 404 ? defaultNotFoundStatus : (err.response?.status || 502);
}

function extractErrorMessage(err) {
  return err.response?.data?.error || err.message;
}

app.post('/orchestrator/create-and-confirm-order', async (req, res) => {
  const correlationId = req.body.correlation_id || `corr-${Date.now()}`;

  try {
    const { data: validatedData, error: validationErrors } = validateRequestBody(req.body);
    if (validationErrors) {
      return res.status(400).json({ ...buildErrorResponse(correlationId, 'Validation error'), details: validationErrors });
    }

    const { customer_id, items, idempotency_key } = validatedData;
    const jwtToken = generateServiceJwt();

    let customer;
    try {
      customer = await fetchCustomer(customer_id);
    } catch (err) {
      const status = resolveErrorStatus(err, 404);
      return res.status(status).json(buildErrorResponse(correlationId, `Customer validation failed: ${extractErrorMessage(err)}`));
    }

    let order;
    try {
      order = await requestCreateOrder(customer_id, items, jwtToken);
    } catch (err) {
      return res.status(err.response?.status || 502).json(buildErrorResponse(correlationId, `Order creation failed: ${extractErrorMessage(err)}`));
    }

    let confirmedOrder;
    try {
      confirmedOrder = await requestConfirmOrder(order.id, idempotency_key, jwtToken);
    } catch (err) {
      return res.status(err.response?.status || 502).json(buildErrorResponse(correlationId, `Order confirmation failed: ${extractErrorMessage(err)}`));
    }

    const response = buildSuccessResponse(correlationId, customer, confirmedOrder);
    res.status(201).json(response);
  } catch (err) {
    console.error('Orchestrator error:', err);
    res.status(500).json(buildErrorResponse(correlationId, 'Internal orchestrator error'));
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'lambda-orchestrator' });
});

module.exports.handler = serverless(app);
