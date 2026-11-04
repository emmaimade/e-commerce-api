// Runs SQL migrations against DATABASE_URL (no psql needed) and records them
// in schema_migrations, so each one runs once per database.
//   npm run migrate                  run every migration not yet applied
//   npm run migrate -- path/to.sql   run one SQL file without recording it
import fs from "fs";
import path from "path";
import db from "../config/db.js";

const MIGRATIONS_DIR = "migrations";

const runPending = async () => {
  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    ALTER TABLE schema_migrations ENABLE ROW LEVEL SECURITY;
  `);

  const applied = await db.query("SELECT name FROM schema_migrations");
  const appliedNames = new Set(applied.rows.map((row) => row.name));

  const pending = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith(".sql") && !appliedNames.has(file))
    .sort();

  for (const file of pending) {
    await db.query(fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));
    await db.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
    console.log(`Applied ${file}`);
  }

  console.log(pending.length ? "Migrations complete" : "Nothing to migrate");
};

try {
  const file = process.argv[2];

  if (file) {
    await db.query(fs.readFileSync(file, "utf8"));
    console.log(`Applied ${file}`);
  } else {
    await runPending();
  }
} catch (err) {
  console.error(`Migration failed: ${err.message}`);
  process.exitCode = 1;
} finally {
  await db.end();
}
