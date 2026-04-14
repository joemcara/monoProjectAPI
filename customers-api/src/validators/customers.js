const { z } = require('zod');

const createCustomerSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255),
  email: z.string().email('Invalid email format'),
  phone: z.string().max(50).optional(),
});

const updateCustomerSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  email: z.string().email('Invalid email format').optional(),
  phone: z.string().max(50).optional(),
}).refine(data => Object.keys(data).length > 0, {
  message: 'At least one field must be provided',
});

const searchQuerySchema = z.object({
  search: z.string().optional(),
  cursor: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

module.exports = { createCustomerSchema, updateCustomerSchema, searchQuerySchema };
