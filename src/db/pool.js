const { Pool } = require('pg');

let pool;

function getPool(connectionString) {
  // Return an explicitly injected pool (e.g. test suite) when no override is requested.
  if (pool && connectionString === undefined) {
    return pool;
  }

  const resolvedConnectionString = connectionString || process.env.DATABASE_URL;

  if (!resolvedConnectionString) {
    throw new Error('DATABASE_URL is not set');
  }

  if (!pool || pool.options.connectionString !== resolvedConnectionString) {
    pool = new Pool({ connectionString: resolvedConnectionString });
  }

  return pool;
}

function setPool(customPool) {
  pool = customPool;
}

async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

module.exports = {
  getPool,
  setPool,
  closePool,
};
