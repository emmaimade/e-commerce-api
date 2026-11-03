// Runs a SQL migration file against DATABASE_URL (no psql needed).
// Usage: npm run migrate -- migrations/001_add_inventory_reserved.sql
import fs from "fs";
import db from "../config/db.js";

const file = process.argv[2];

if (!file) {
  console.error("Usage: npm run migrate -- <path/to/migration.sql>");
  process.exit(1);
}

try {
  const sql = fs.readFileSync(file, "utf8");
  await db.query(sql);
  console.log(`Applied ${file}`);
} catch (err) {
  console.error(`Migration failed: ${err.message}`);
  process.exitCode = 1;
} finally {
  await db.end();
}
