const axios = require('axios');

const CUSTOMERS_API_BASE = process.env.CUSTOMERS_API_BASE || 'http://localhost:3001';
const SERVICE_TOKEN = process.env.SERVICE_TOKEN || 'internal-service-token';

/**
 * Validates that a customer exists by calling Customers API /internal endpoint.
 * @param {number} customerId
 * @returns {object|null} customer data or null if not found
 */
async function validateCustomer(customerId) {
  try {
    const response = await axios.get(
      `${CUSTOMERS_API_BASE}/internal/customers/${customerId}`,
      { headers: { Authorization: `Bearer ${SERVICE_TOKEN}` } }
    );
    return response.data;
  } catch (err) {
    if (err.response && err.response.status === 404) {
      return null;
    }
    throw err;
  }
}

module.exports = { validateCustomer };
