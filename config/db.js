import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config();

const { Pool } = pg;

// Hosted databases (Supabase, Render) require TLS; a local Postgres usually doesn't
// support it. Without their CA certificate the connection is encrypted, but the
// server's identity isn't checked. The CA can be a one-line env var with \n breaks.
export const sslConfig = (url = '', ca) => {
    if (/@(localhost|127\.0\.0\.1)[:/]/.test(url)) return false;

    if (ca) return { rejectUnauthorized: true, ca: ca.replace(/\\n/g, '\n') };

    return { rejectUnauthorized: false };
};

const db = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: sslConfig(process.env.DATABASE_URL, process.env.DATABASE_CA_CERT)
});

// Test the database connection
db.on('connect', () => {
    console.log('Connected to PostgreSQL database');
});

db.on('error', (err) => {
    console.error('Database connection error:', err);
});

export default db;
