const { z } = require('zod');

const createProductSchema = z.object({
  sku: z.string().min(1, 'SKU is required').max(100),
  name: z.string().min(1, 'Name is required').max(255),
  price_cents: z.number().int().positive('Price must be positive'),
  stock: z.number().int().min(0, 'Stock cannot be negative'),
});

const updateProductSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  price_cents: z.number().int().positive().optional(),
  stock: z.number().int().min(0).optional(),
}).refine(data => Object.keys(data).length > 0, {
  message: 'At least one field must be provided',
});

const searchProductsQuerySchema = z.object({
  search: z.string().optional(),
  cursor: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

module.exports = { createProductSchema, updateProductSchema, searchProductsQuerySchema };
