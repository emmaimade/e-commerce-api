import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config();

const { Pool } = pg;

// Hosted databases (Supabase, Render) require SSL; a local Postgres usually doesn't support it
const isLocalDb = /@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL || '');

const db = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: isLocalDb ? false : { rejectUnauthorized: false }
});

// Test the database connection
db.on('connect', () => {
    console.log('Connected to PostgreSQL database');
});

db.on('error', (err) => {
    console.error('Database connection error:', err);
});

export default db;