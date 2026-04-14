const pool = require('../config/db');

async function createProduct(req, res, next) {
  try {
    const { sku, name, price_cents, stock } = req.body;
    const [result] = await pool.execute(
      'INSERT INTO products (sku, name, price_cents, stock) VALUES (?, ?, ?, ?)',
      [sku, name, price_cents, stock]
    );
    const [rows] = await pool.execute('SELECT * FROM products WHERE id = ?', [result.insertId]);
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'SKU already exists' });
    }
    next(err);
  }
}

async function getProductById(req, res, next) {
  try {
    const [rows] = await pool.execute('SELECT * FROM products WHERE id = ?', [req.params.id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
}

async function searchProducts(req, res, next) {
  try {
    const { search, cursor, limit } = req.query;
    let query = 'SELECT * FROM products WHERE 1=1';
    const params = [];

    if (search) {
      query += ' AND (name LIKE ? OR sku LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
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

async function updateProduct(req, res, next) {
  try {
    const { id } = req.params;
    const fields = req.body;

    const setClauses = [];
    const params = [];
    for (const [key, value] of Object.entries(fields)) {
      if (['name', 'price_cents', 'stock'].includes(key)) {
        setClauses.push(`${key} = ?`);
        params.push(value);
      }
    }

    if (setClauses.length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    params.push(id);
    const [result] = await pool.execute(
      `UPDATE products SET ${setClauses.join(', ')} WHERE id = ?`,
      params
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const [rows] = await pool.execute('SELECT * FROM products WHERE id = ?', [id]);
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
}

module.exports = { createProduct, getProductById, searchProducts, updateProduct };
