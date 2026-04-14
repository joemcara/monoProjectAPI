const { z } = require('zod');

const createOrderSchema = z.object({
  customer_id: z.number().int().positive('Customer ID is required'),
  items: z.array(z.object({
    product_id: z.number().int().positive('Product ID is required'),
    qty: z.number().int().positive('Quantity must be at least 1'),
  })).min(1, 'At least one item is required'),
});

const searchOrdersQuerySchema = z.object({
  status: z.enum(['CREATED', 'CONFIRMED', 'CANCELED']).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  cursor: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

module.exports = { createOrderSchema, searchOrdersQuerySchema };
