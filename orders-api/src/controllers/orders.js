const pool = require('../config/db');
const { validateCustomer } = require('../services/customersClient');
const { checkIdempotencyKey, saveIdempotencyKey } = require('../utils/idempotency');

const CANCELLATION_WINDOW_MS = 10 * 60 * 1000;

async function findOrderById(id) {
  const [rows] = await pool.execute('SELECT * FROM orders WHERE id = ?', [id]);
  return rows.length > 0 ? rows[0] : null;
}

async function findOrderWithItems(id) {
  const order = await findOrderById(id);
  if (!order) return null;

  const [items] = await pool.execute('SELECT * FROM order_items WHERE order_id = ?', [id]);
  return { ...order, items };
}

function ensureProductExists(product, productId) {
  if (!product) {
    const error = new Error(`Product ${productId} not found`);
    error.statusCode = 400;
    throw error;
  }
}

function ensureStockAvailable(product, requestedQty) {
  if (product.stock < requestedQty) {
    const error = new Error(
      `Insufficient stock for product ${product.id} (${product.name}). Available: ${product.stock}, requested: ${requestedQty}`
    );
    error.statusCode = 400;
    throw error;
  }
}

async function deductStock(conn, productId, qty) {
  await conn.execute('UPDATE products SET stock = stock - ? WHERE id = ?', [qty, productId]);
}


async function validateAndReserveStock(conn, items) {
  let totalCents = 0;
  const orderItems = [];

  for (const item of items) {
    const product = await findProductForUpdate(conn, item.product_id);
    ensureProductExists(product, item.product_id);
    ensureStockAvailable(product, item.qty);

    const subtotalCents = product.price_cents * item.qty;
    totalCents += subtotalCents;

    orderItems.push({
      product_id: item.product_id,
      qty: item.qty,
      unit_price_cents: product.price_cents,
      subtotal_cents: subtotalCents,
    });

    await deductStock(conn, item.product_id, item.qty);
  }

  return { orderItems, totalCents };
}

async function findProductForUpdate(conn, productId) {
  const [rows] = await conn.execute(
    'SELECT id, name, price_cents, stock FROM products WHERE id = ? FOR UPDATE',
    [productId]
  );
  return rows.length > 0 ? rows[0] : null;
}



async function insertOrder(conn, customerId, totalCents) {
  const [result] = await conn.execute(
    'INSERT INTO orders (customer_id, status, total_cents) VALUES (?, ?, ?)',
    [customerId, 'CREATED', totalCents]
  );
  return result.insertId;
}

async function insertOrderItems(conn, orderId, items) {
  for (const item of items) {
    await conn.execute(
      'INSERT INTO order_items (order_id, product_id, qty, unit_price_cents, subtotal_cents) VALUES (?, ?, ?, ?, ?)',
      [orderId, item.product_id, item.qty, item.unit_price_cents, item.subtotal_cents]
    );
  }
}

async function restoreStock(conn, orderId) {
  const [items] = await conn.execute('SELECT * FROM order_items WHERE order_id = ?', [orderId]);
  for (const item of items) {
    await conn.execute('UPDATE products SET stock = stock + ? WHERE id = ?', [item.qty, item.product_id]);
  }
  return items;
}

function validateCancellation(order) {
  if (order.status === 'CANCELED') {
    return { valid: false, error: 'Order is already canceled' };
  }

  if (order.status === 'CONFIRMED') {
    const createdAt = new Date(order.created_at);
    const windowLimit = new Date(Date.now() - CANCELLATION_WINDOW_MS);
    if (createdAt < windowLimit) {
      return { valid: false, error: 'Confirmed orders can only be canceled within 10 minutes of creation' };
    }
  }

  return { valid: true };
}

async function updateOrderStatus(conn, orderId, status) {
  await conn.execute('UPDATE orders SET status = ? WHERE id = ?', [status, orderId]);
}


async function createOrder(req, res, next) {
  const conn = await pool.getConnection();
  try {
    const { customer_id, items } = req.body;

    const customer = await validateCustomer(customer_id);
    if (!customer) {
      return res.status(400).json({ error: `Customer ${customer_id} not found` });
    }

    await conn.beginTransaction();

    const { orderItems, totalCents } = await validateAndReserveStock(conn, items);
    const orderId = await insertOrder(conn, customer_id, totalCents);
    await insertOrderItems(conn, orderId, orderItems);

    await conn.commit();

    const createdOrder = await findOrderWithItems(orderId);
    res.status(201).json(createdOrder);
  } catch (err) {
    await conn.rollback();
    if (err.statusCode) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    next(err);
  } finally {
    conn.release();
  }
}

async function getOrderById(req, res, next) {
  try {
    const order = await findOrderWithItems(req.params.id);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }
    res.json(order);
  } catch (err) {
    next(err);
  }
}

function buildOrderSearchQuery(filters) {
  const { status, from, to, cursor, limit } = filters;
  let query = 'SELECT * FROM orders WHERE 1=1';
  const params = [];

  if (status) {
    query += ' AND status = ?';
    params.push(status);
  }
  if (from) {
    query += ' AND created_at >= ?';
    params.push(from);
  }
  if (to) {
    query += ' AND created_at <= ?';
    params.push(to);
  }
  if (cursor) {
    query += ' AND id > ?';
    params.push(Number(cursor));
  }

  query += ' ORDER BY id ASC LIMIT ?';
  params.push(Number(limit) || 20);

  return { query, params };
}

async function searchOrders(req, res, next) {
  try {
    const { query, params } = buildOrderSearchQuery(req.query);
    const [rows] = await pool.query(query, params);
    const nextCursor = rows.length > 0 ? rows[rows.length - 1].id : null;

    res.json({ data: rows, nextCursor });
  } catch (err) {
    next(err);
  }
}



async function confirmOrder(req, res, next) {
  try {
    const { id } = req.params;
    const idempotencyKey = req.headers['x-idempotency-key'];

    if (!idempotencyKey) {
      return res.status(400).json({ error: 'X-Idempotency-Key header is required' });
    }

    const existing = await checkIdempotencyKey(idempotencyKey);
    if (existing) {
      return res.status(200).json(JSON.parse(existing.response_body));
    }

    const order = await findOrderById(id);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }
    if (order.status !== 'CREATED') {
      return res.status(400).json({ error: `Order cannot be confirmed. Current status: ${order.status}` });
    }

    await updateOrderStatus(pool, id, 'CONFIRMED');

    const confirmedOrder = await findOrderWithItems(id);
    await saveIdempotencyKey(idempotencyKey, 'order_confirm', Number(id), 'CONFIRMED', confirmedOrder);

    res.json(confirmedOrder);
  } catch (err) {
    next(err);
  }
}

async function cancelOrder(req, res, next) {
  const conn = await pool.getConnection();
  try {
    const { id } = req.params;
    await conn.beginTransaction();

    const [orders] = await conn.execute('SELECT * FROM orders WHERE id = ? FOR UPDATE', [id]);
    if (orders.length === 0) {
      await conn.rollback();
      return res.status(404).json({ error: 'Order not found' });
    }

    const cancellation = validateCancellation(orders[0]);
    if (!cancellation.valid) {
      await conn.rollback();
      return res.status(400).json({ error: cancellation.error });
    }

    const items = await restoreStock(conn, id);
    await updateOrderStatus(conn, id, 'CANCELED');

    await conn.commit();

    const canceledOrder = await findOrderById(id);
    res.json({ ...canceledOrder, items });
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
}

module.exports = { createOrder, getOrderById, searchOrders, confirmOrder, cancelOrder };
