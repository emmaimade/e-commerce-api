import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config();

const { Pool } = pg;

const db = new Pool({
    // user: process.env.PG_USER,
    // host: process.env.PG_HOST,
    // database: process.env.PG_DATABASE,
    // password: process.env.PG_PASSWORD,
    // port: process.env.PG_PORT,
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

export default db;