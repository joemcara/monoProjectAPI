CREATE DATABASE IF NOT EXISTS b2b_orders;
USE b2b_orders;

CREATE TABLE users (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  username     VARCHAR(100) NOT NULL UNIQUE,
  password     VARCHAR(255) NOT NULL,
  role         VARCHAR(50)  NOT NULL DEFAULT 'operator',
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE customers (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  name         VARCHAR(255) NOT NULL,
  email        VARCHAR(255) NOT NULL UNIQUE,
  phone        VARCHAR(50),
  deleted_at   DATETIME DEFAULT NULL,
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE products (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  sku          VARCHAR(100) NOT NULL UNIQUE,
  name         VARCHAR(255) NOT NULL,
  price_cents  INT NOT NULL,
  stock        INT NOT NULL DEFAULT 0,
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE orders (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  customer_id  INT NOT NULL,
  status       ENUM('CREATED','CONFIRMED','CANCELED') NOT NULL DEFAULT 'CREATED',
  total_cents  INT NOT NULL DEFAULT 0,
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);

CREATE TABLE order_items (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  order_id         INT NOT NULL,
  product_id       INT NOT NULL,
  qty              INT NOT NULL,
  unit_price_cents INT NOT NULL,
  subtotal_cents   INT NOT NULL,
  FOREIGN KEY (order_id) REFERENCES orders(id),
  FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE TABLE idempotency_keys (
  `key`        VARCHAR(255) PRIMARY KEY,
  target_type  VARCHAR(50),
  target_id    INT,
  status       VARCHAR(50),
  response_body LONGTEXT,
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at   DATETIME
);