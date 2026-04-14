require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const swaggerUi = require('swagger-ui-express');
const YAML = require('yamljs');

const authRoutes = require('./routes/auth');
const customerRoutes = require('./routes/customers');
const internalRoutes = require('./routes/internal');

const app = express();
const PORT = process.env.PORT || 3001;

// Load OpenAPI spec
const swaggerDocument = YAML.load(path.join(__dirname, '..', 'openapi.yaml'));

app.use(cors());
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json());

// Swagger UI
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'customers-api', timestamp: new Date().toISOString() });
});

// Routes
app.use('/auth', authRoutes);
app.use('/customers', customerRoutes);
app.use('/internal', internalRoutes);

// Global error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({ error: err.message || 'Internal Server Error' });
});

app.listen(PORT, () => {
  console.log(`Customers API running on port ${PORT}`);
});
