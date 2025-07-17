CREATE DATABASE ecommerce;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	name TEXT NOT NULL,
	email TEXT UNIQUE NOT NULL,
	password TEXT NOT NULL,
	role TEXT NOT NULL DEFAULT 'customer',
	reset_password_token VARCHAR(255),
	reset_token_expiry TIMESTAMP,
	created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE products (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	name TEXT NOT NULL,
	description TEXT,
	price INTEGER NOT NULL,
	inventory_qty INTEGER NOT NULL,
	status VARCHAR(20) DEFAULT 'active',
	images JSONB DEFAULT '[]',
	created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
	updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE carts (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id UUID REFERENCES users(id) ON DELETE CASCADE,
	created_at TIMESTAMPTZ DEFAULT now(),
	updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE cart_items (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	cart_id UUID REFERENCES carts(id) ON DELETE CASCADE,
	product_id UUID REFERENCES products(id),
	quantity INTEGER NOT NULL,
	added_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE orders (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id UUID REFERENCES users(id),
	total INTEGER NOT NULL,
	status TEXT NOT NULL DEFAULT 'pending',
	payment_ref TEXT,
	shipping_address_id UUID REFERENCES addresses(id);
	payment_method TEXT;
	placed_at TIMESTAMPTZ DEFAULT now(),
	updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE order_items (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
	product_id UUID REFERENCES products(id),
	quantity INTEGER NOT NULL,
	price INTEGER NOT NULL,
);

CREATE TABLE order_status_history (
id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
status TEXT NOT NULL,
notes TEXT,
updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE addresses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  line1 TEXT NOT NULL,
  line2 TEXT,
  city TEXT NOT NULL,
  state TEXT,
  postal_code TEXT NOT NULL,
  country TEXT NOT NULL,
  phone TEXT NOT NULL, 
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);


CREATE TABLE payment_logs (
  id SERIAL PRIMARY KEY,
  order_id INTEGER REFERENCES orders(id),
  payment_reference VARCHAR(255) UNIQUE NOT NULL,
  status VARCHAR(50) NOT NULL, -- 'paid', 'failed', 'pending'
  amount INTEGER, -- Amount in kobo
  payment_method VARCHAR(50), -- 'card', 'bank', 'ussd', etc.
  processed_by VARCHAR(50), -- 'webhook', 'admin', 'user'
  failure_reason TEXT, -- For failed payments
  gateway_response JSONB, -- Store full Paystack response
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

-- Indexes for better performance
CREATE INDEX idx_payment_logs_reference ON payment_logs(payment_reference);
CREATE INDEX idx_payment_logs_order_id ON payment_logs(order_id);
CREATE INDEX idx_payment_logs_status ON payment_logs(status);
CREATE INDEX IF NOT EXISTS idx_order_status_history_order_id ON order_status_history(order_id);
CREATE INDEX IF NOT EXISTS idx_orders_order_status ON orders(order_status);
