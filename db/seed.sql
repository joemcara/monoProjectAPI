USE b2b_orders;

INSERT INTO users (username, password, role) VALUES
  ('admin', 'admin123', 'operator');

INSERT INTO customers (name, email, phone) VALUES
  ('ACME Corp', 'ops@acme.com', '+1-555-0001'),
  ('Beta LLC',  'contact@beta.com', '+1-555-0002');

INSERT INTO products (sku, name, price_cents, stock) VALUES
  ('SKU-001', 'Widget A', 129900, 100),
  ('SKU-002', 'Widget B',  59900,  50),
  ('SKU-003', 'Widget C', 199900,  20);