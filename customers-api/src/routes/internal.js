const express = require('express');
const serviceAuthMiddleware = require('../middleware/serviceAuth');
const pool = require('../config/db');

const router = express.Router();

router.use(serviceAuthMiddleware);

router.get('/customers/:id', async (req, res, next) => {
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
});

module.exports = router;
