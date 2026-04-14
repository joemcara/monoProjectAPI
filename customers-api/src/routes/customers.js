const express = require('express');
const authMiddleware = require('../middleware/auth');
const { createCustomerSchema, updateCustomerSchema, searchQuerySchema } = require('../validators/customers');
const {
  createCustomer,
  getCustomerById,
  searchCustomers,
  updateCustomer,
  deleteCustomer,
} = require('../controllers/customers');

const router = express.Router();

// Validation middleware factory
function validate(schema, source = 'body') {
  return (req, res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      return res.status(400).json({ error: 'Validation error', details: result.error.issues });
    }
    req[source] = result.data;
    next();
  };
}

router.use(authMiddleware);

router.post('/', validate(createCustomerSchema), createCustomer);
router.get('/', validate(searchQuerySchema, 'query'), searchCustomers);
router.get('/:id', getCustomerById);
router.put('/:id', validate(updateCustomerSchema), updateCustomer);
router.delete('/:id', deleteCustomer);

module.exports = router;
