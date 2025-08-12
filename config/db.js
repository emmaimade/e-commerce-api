import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config();

const { Pool } = pg;

const db = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Test the database connection
db.on('connect', () => {
    console.log('Connected to PostgreSQL database');
});

db.on('error', (err) => {
    console.error('Database connection error:', err);
});

export default db;