const express = require('express');
const jwt = require('jsonwebtoken');
const { z } = require('zod');
const pool = require('../config/db');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET;

const loginSchema = z.object({
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
});

async function findUserByCredentials(username, password) {
  const [rows] = await pool.execute(
    'SELECT id, username, role FROM users WHERE username = ? AND password = ?',
    [username, password]
  );
  return rows.length > 0 ? rows[0] : null;
}

function generateToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: '24h' }
  );
}

router.post('/login', async (req, res) => {
  const result = loginSchema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({ error: 'Validation error', details: result.error.issues });
  }

  const user = await findUserByCredentials(result.data.username, result.data.password);
  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = generateToken(user);
  res.json({ token, expiresIn: '24h' });
});

module.exports = router;
