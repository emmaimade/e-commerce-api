import db from "../config/db.js";

// Runs `work` in a transaction: commits if it finishes, rolls back if it throws,
// and always returns the connection to the pool
export const withTransaction = async (work) => {
  const client = await db.connect();

  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};
