const express = require('express');
const authMiddleware = require('../middleware/auth');
const { createOrderSchema, searchOrdersQuerySchema } = require('../validators/orders');
const { createOrder, getOrderById, searchOrders, confirmOrder, cancelOrder } = require('../controllers/orders');

const router = express.Router();

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

router.post('/', validate(createOrderSchema), createOrder);
router.get('/', validate(searchOrdersQuerySchema, 'query'), searchOrders);
router.get('/:id', getOrderById);
router.post('/:id/confirm', confirmOrder);
router.post('/:id/cancel', cancelOrder);

module.exports = router;
