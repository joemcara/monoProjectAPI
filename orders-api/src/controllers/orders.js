const pool = require('../config/db');
const { validateCustomer } = require('../services/customersClient');
const { checkIdempotencyKey, saveIdempotencyKey } = require('../utils/idempotency');

/**
 * POST /orders
 * Creates an order: validates customer, checks stock, calculates totals,
 * inserts order + items, deducts stock — all inside a transaction.
 */
async function createOrder(req, res, next) {
  const conn = await pool.getConnection();
  try {
    const { customer_id, items } = req.body;

    // 1. Validate customer exists via Customers API /internal
    const customer = await validateCustomer(customer_id);
    if (!customer) {
      return res.status(400).json({ error: `Customer ${customer_id} not found` });
    }

    // 2. Begin transaction
    await conn.beginTransaction();

    let totalCents = 0;
    const orderItems = [];

    // 3. Validate stock and calculate totals
    for (const item of items) {
      const [products] = await conn.execute(
        'SELECT id, name, price_cents, stock FROM products WHERE id = ? FOR UPDATE',
        [item.product_id]
      );

      if (products.length === 0) {
        await conn.rollback();
        return res.status(400).json({ error: `Product ${item.product_id} not found` });
      }

      const product = products[0];
      if (product.stock < item.qty) {
        await conn.rollback();
        return res.status(400).json({
          error: `Insufficient stock for product ${item.product_id} (${product.name}). Available: ${product.stock}, requested: ${item.qty}`,
        });
      }

      const subtotalCents = product.price_cents * item.qty;
      totalCents += subtotalCents;

      orderItems.push({
        product_id: item.product_id,
        qty: item.qty,
        unit_price_cents: product.price_cents,
        subtotal_cents: subtotalCents,
      });

      // Deduct stock
      await conn.execute(
        'UPDATE products SET stock = stock - ? WHERE id = ?',
        [item.qty, item.product_id]
      );
    }

    // 4. Insert order
    const [orderResult] = await conn.execute(
      'INSERT INTO orders (customer_id, status, total_cents) VALUES (?, ?, ?)',
      [customer_id, 'CREATED', totalCents]
    );
    const orderId = orderResult.insertId;

    // 5. Insert order items
    for (const item of orderItems) {
      await conn.execute(
        'INSERT INTO order_items (order_id, product_id, qty, unit_price_cents, subtotal_cents) VALUES (?, ?, ?, ?, ?)',
        [orderId, item.product_id, item.qty, item.unit_price_cents, item.subtotal_cents]
      );
    }

    // 6. Commit
    await conn.commit();

    // 7. Return created order with items
    const [orders] = await pool.execute('SELECT * FROM orders WHERE id = ?', [orderId]);
    const [fetchedItems] = await pool.execute('SELECT * FROM order_items WHERE order_id = ?', [orderId]);

    res.status(201).json({ ...orders[0], items: fetchedItems });
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
}

/**
 * GET /orders/:id — returns order with items
 */
async function getOrderById(req, res, next) {
  try {
    const [orders] = await pool.execute('SELECT * FROM orders WHERE id = ?', [req.params.id]);
    if (orders.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const [items] = await pool.execute('SELECT * FROM order_items WHERE order_id = ?', [req.params.id]);
    res.json({ ...orders[0], items });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /orders?status=&from=&to=&cursor=&limit= — search orders
 */
async function searchOrders(req, res, next) {
  try {
    const { status, from, to, cursor, limit } = req.query;
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

    const [rows] = await pool.execute(query, params);
    const nextCursor = rows.length > 0 ? rows[rows.length - 1].id : null;

    res.json({ data: rows, nextCursor });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /orders/:id/confirm — idempotent confirmation using X-Idempotency-Key header
 */
async function confirmOrder(req, res, next) {
  try {
    const { id } = req.params;
    const idempotencyKey = req.headers['x-idempotency-key'];

    if (!idempotencyKey) {
      return res.status(400).json({ error: 'X-Idempotency-Key header is required' });
    }

    // Check idempotency: if key exists, return stored response
    const existing = await checkIdempotencyKey(idempotencyKey);
    if (existing) {
      return res.status(200).json(JSON.parse(existing.response_body));
    }

    // Get order
    const [orders] = await pool.execute('SELECT * FROM orders WHERE id = ?', [id]);
    if (orders.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const order = orders[0];
    if (order.status !== 'CREATED') {
      return res.status(400).json({ error: `Order cannot be confirmed. Current status: ${order.status}` });
    }

    // Confirm order
    await pool.execute('UPDATE orders SET status = ? WHERE id = ?', ['CONFIRMED', id]);

    // Fetch updated order with items
    const [updatedOrders] = await pool.execute('SELECT * FROM orders WHERE id = ?', [id]);
    const [items] = await pool.execute('SELECT * FROM order_items WHERE order_id = ?', [id]);

    const response = { ...updatedOrders[0], items };

    // Save idempotency key
    await saveIdempotencyKey(idempotencyKey, 'order_confirm', Number(id), 'CONFIRMED', response);

    res.json(response);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /orders/:id/cancel
 * CREATED → cancel + restore stock
 * CONFIRMED → cancel only if created within 10 minutes
 * CANCELED → error
 */
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

    const order = orders[0];

    if (order.status === 'CANCELED') {
      await conn.rollback();
      return res.status(400).json({ error: 'Order is already canceled' });
    }

    if (order.status === 'CONFIRMED') {
      const createdAt = new Date(order.created_at);
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
      if (createdAt < tenMinutesAgo) {
        await conn.rollback();
        return res.status(400).json({
          error: 'Confirmed orders can only be canceled within 10 minutes of creation',
        });
      }
    }

    // Restore stock
    const [items] = await conn.execute('SELECT * FROM order_items WHERE order_id = ?', [id]);
    for (const item of items) {
      await conn.execute(
        'UPDATE products SET stock = stock + ? WHERE id = ?',
        [item.qty, item.product_id]
      );
    }

    // Cancel order
    await conn.execute('UPDATE orders SET status = ? WHERE id = ?', ['CANCELED', id]);

    await conn.commit();

    const [updatedOrders] = await pool.execute('SELECT * FROM orders WHERE id = ?', [id]);
    res.json({ ...updatedOrders[0], items });
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
}

module.exports = { createOrder, getOrderById, searchOrders, confirmOrder, cancelOrder };
