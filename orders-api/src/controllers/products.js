const pool = require('../config/db');

const ALLOWED_UPDATE_FIELDS = ['name', 'price_cents', 'stock'];

async function findProductById(id) {
  const [rows] = await pool.execute('SELECT * FROM products WHERE id = ?', [id]);
  return rows.length > 0 ? rows[0] : null;
}

async function insertProduct({ sku, name, price_cents, stock }) {
  const [result] = await pool.execute(
    'INSERT INTO products (sku, name, price_cents, stock) VALUES (?, ?, ?, ?)',
    [sku, name, price_cents, stock]
  );
  return findProductById(result.insertId);
}

function buildUpdateQuery(fields, allowedFields) {
  const setClauses = [];
  const params = [];

  for (const [key, value] of Object.entries(fields)) {
    if (allowedFields.includes(key)) {
      setClauses.push(`${key} = ?`);
      params.push(value);
    }
  }

  return { setClauses, params };
}

function buildProductSearchQuery(filters) {
  const { search, cursor, limit } = filters;
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

  return { query, params };
}

// Controllers

async function createProduct(req, res, next) {
  try {
    const product = await insertProduct(req.body);
    res.status(201).json(product);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'SKU already exists' });
    }
    next(err);
  }
}

async function getProductById(req, res, next) {
  try {
    const product = await findProductById(req.params.id);
    if (!product) {
      return res.status(404).json({ error: 'Product not found' });
    }
    res.json(product);
  } catch (err) {
    next(err);
  }
}

async function searchProducts(req, res, next) {
  try {
    const { query, params } = buildProductSearchQuery(req.query);
    const [rows] = await pool.query(query, params);
    const nextCursor = rows.length > 0 ? rows[rows.length - 1].id : null;

    res.json({ data: rows, nextCursor });
  } catch (err) {
    next(err);
  }
}

async function updateProduct(req, res, next) {
  try {
    const { id } = req.params;
    const { setClauses, params } = buildUpdateQuery(req.body, ALLOWED_UPDATE_FIELDS);

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

    const updatedProduct = await findProductById(id);
    res.json(updatedProduct);
  } catch (err) {
    next(err);
  }
}

module.exports = { createProduct, getProductById, searchProducts, updateProduct };
