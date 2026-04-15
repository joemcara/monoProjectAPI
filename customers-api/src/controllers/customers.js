const pool = require('../config/db');

const CUSTOMER_FIELDS = 'id, name, email, phone, created_at';
const ALLOWED_UPDATE_FIELDS = ['name', 'email', 'phone'];

async function findCustomerById(id) {
  const [rows] = await pool.execute(
    `SELECT ${CUSTOMER_FIELDS} FROM customers WHERE id = ? AND deleted_at IS NULL`,
    [id]
  );
  return rows.length > 0 ? rows[0] : null;
}

async function insertCustomer({ name, email, phone }) {
  const [result] = await pool.execute(
    'INSERT INTO customers (name, email, phone) VALUES (?, ?, ?)',
    [name, email, phone || null]
  );
  const [rows] = await pool.execute(
    `SELECT ${CUSTOMER_FIELDS} FROM customers WHERE id = ?`,
    [result.insertId]
  );
  return rows[0];
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

function buildCustomerSearchQuery(filters) {
  const { search, cursor, limit } = filters;
  let query = `SELECT ${CUSTOMER_FIELDS} FROM customers WHERE deleted_at IS NULL`;
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

  return { query, params };
}


async function createCustomer(req, res, next) {
  try {
    const customer = await insertCustomer(req.body);
    res.status(201).json(customer);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Email already exists' });
    }
    next(err);
  }
}

async function getCustomerById(req, res, next) {
  try {
    const customer = await findCustomerById(req.params.id);
    if (!customer) {
      return res.status(404).json({ error: 'Customer not found' });
    }
    res.json(customer);
  } catch (err) {
    next(err);
  }
}

async function searchCustomers(req, res, next) {
  try {
    const { query, params } = buildCustomerSearchQuery(req.query);
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
    const { setClauses, params } = buildUpdateQuery(req.body, ALLOWED_UPDATE_FIELDS);

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

    const updatedCustomer = await findCustomerById(id);
    res.json(updatedCustomer);
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
