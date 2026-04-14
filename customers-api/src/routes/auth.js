const express = require('express');
const jwt = require('jsonwebtoken');
const { z } = require('zod');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'supersecret';

// Hardcoded users for the technical test
const USERS = [
  { id: 1, username: 'admin', password: 'admin123', role: 'operator' },
];

const loginSchema = z.object({
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
});

router.post('/login', (req, res) => {
  const result = loginSchema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({ error: 'Validation error', details: result.error.issues });
  }

  const { username, password } = result.data;
  const user = USERS.find(u => u.username === username && u.password === password);

  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: '24h' }
  );

  res.json({ token, expiresIn: '24h' });
});

module.exports = router;
