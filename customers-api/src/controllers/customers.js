const pool = require('../config/db');

async function createCustomer(req, res, next) {
  try {
    const { name, email, phone } = req.body;
    const [result] = await pool.execute(
      'INSERT INTO customers (name, email, phone) VALUES (?, ?, ?)',
      [name, email, phone || null]
    );
    const [rows] = await pool.execute(
      'SELECT id, name, email, phone, created_at FROM customers WHERE id = ?',
      [result.insertId]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Email already exists' });
    }
    next(err);
  }
}

async function getCustomerById(req, res, next) {
  try {
    const [rows] = await pool.execute(
      'SELECT id, name, email, phone, created_at FROM customers WHERE id = ? AND deleted_at IS NULL',
      [req.params.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Customer not found' });
    }
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
}

async function searchCustomers(req, res, next) {
  try {
    const { search, cursor, limit } = req.query;
    let query = 'SELECT id, name, email, phone, created_at FROM customers WHERE deleted_at IS NULL';
    const params = [];

    if (search) {
      query += ' AND (name LIKE ? OR email LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }
    if (cursor) {
      query += ' AND id > ?';
      params.push(Number(cursor));
    }

    query += ' ORDER BY id ASC LIMIT ?';
    params.push(Number(limit) || 20);

    const [rows] = await pool.query(query, params);
    const nextCursor = rows.length > 0 ? rows[rows.length - 1].id : null;

    res.json({ data: rows, nextCursor });
  } catch (err) {
    next(err);
  }
}

async function updateCustomer(req, res, next) {
  try {
    const { id } = req.params;
    const fields = req.body;

    const setClauses = [];
    const params = [];
    for (const [key, value] of Object.entries(fields)) {
      if (['name', 'email', 'phone'].includes(key)) {
        setClauses.push(`${key} = ?`);
        params.push(value);
      }
    }

    if (setClauses.length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    params.push(id);
    const [result] = await pool.execute(
      `UPDATE customers SET ${setClauses.join(', ')} WHERE id = ? AND deleted_at IS NULL`,
      params
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    const [rows] = await pool.execute(
      'SELECT id, name, email, phone, created_at FROM customers WHERE id = ?',
      [id]
    );
    res.json(rows[0]);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Email already exists' });
    }
    next(err);
  }
}

async function deleteCustomer(req, res, next) {
  try {
    const [result] = await pool.execute(
      'UPDATE customers SET deleted_at = NOW() WHERE id = ? AND deleted_at IS NULL',
      [req.params.id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Customer not found' });
    }
    res.json({ message: 'Customer deleted' });
  } catch (err) {
    next(err);
  }
}

module.exports = { createCustomer, getCustomerById, searchCustomers, updateCustomer, deleteCustomer };
