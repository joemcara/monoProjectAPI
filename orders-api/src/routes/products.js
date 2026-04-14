const express = require('express');
const authMiddleware = require('../middleware/auth');
const { createProductSchema, updateProductSchema, searchProductsQuerySchema } = require('../validators/products');
const { createProduct, getProductById, searchProducts, updateProduct } = require('../controllers/products');

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

router.post('/', validate(createProductSchema), createProduct);
router.get('/', validate(searchProductsQuerySchema, 'query'), searchProducts);
router.get('/:id', getProductById);
router.patch('/:id', validate(updateProductSchema), updateProduct);

module.exports = router;
