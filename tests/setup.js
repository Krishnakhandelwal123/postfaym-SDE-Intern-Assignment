const { Pool } = require('pg');
const { migrate } = require('../src/db/migrate');
const { setPool, closePool } = require('../src/db/pool');

const DEFAULT_TEST_DATABASE_URL =
  'postgresql://postgres:postgres@localhost:5432/payout_test';

function getTestDatabaseUrl() {
  return process.env.TEST_DATABASE_URL || DEFAULT_TEST_DATABASE_URL;
}

function getAdminDatabaseUrl(testDatabaseUrl) {
  const url = new URL(testDatabaseUrl);
  url.pathname = '/postgres';
  return url.toString();
}

async function ensureTestDatabase(testDatabaseUrl) {
  const url = new URL(testDatabaseUrl);
  const databaseName = url.pathname.replace(/^\//, '');

  if (!/^[a-zA-Z0-9_]+$/.test(databaseName)) {
    throw new Error(`Unsafe test database name: ${databaseName}`);
  }

  const adminPool = new Pool({
    connectionString: getAdminDatabaseUrl(testDatabaseUrl),
  });

  try {
    const { rows } = await adminPool.query(
      'SELECT 1 FROM pg_database WHERE datname = $1',
      [databaseName]
    );

    if (rows.length === 0) {
      await adminPool.query(`CREATE DATABASE ${databaseName}`);
    }
  } finally {
    await adminPool.end();
  }
}

async function resetDatabase(pool) {
  await pool.query(`
    TRUNCATE TABLE
      ledger_entries,
      advance_payouts,
      withdrawals,
      sales,
      users,
      brands
    RESTART IDENTITY CASCADE
  `);
}

async function setupTestEnvironment() {
  const testDatabaseUrl = getTestDatabaseUrl();
  process.env.DATABASE_URL = testDatabaseUrl;
  await ensureTestDatabase(testDatabaseUrl);
  await migrate(testDatabaseUrl);

  const pool = new Pool({ connectionString: testDatabaseUrl });
  setPool(pool);
  await resetDatabase(pool);

  return pool;
}

async function teardownTestEnvironment(pool) {
  if (pool) {
    await resetDatabase(pool);
  }
  await closePool();
}

module.exports = {
  setupTestEnvironment,
  teardownTestEnvironment,
  resetDatabase,
  getTestDatabaseUrl,
};
