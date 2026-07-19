const { getPool } = require('../db/pool');
const { AppError } = require('../utils/errors');
const { paiseToRupeeString } = require('../utils/money');

function mapUser(row) {
  return {
    id: row.id,
    externalId: row.external_id,
    balancePaise: Number(row.cached_balance_paise),
    balanceRupee: paiseToRupeeString(row.cached_balance_paise),
    createdAt: row.created_at.toISOString(),
  };
}

async function createUser(externalId) {
  if (!externalId || typeof externalId !== 'string' || !externalId.trim()) {
    throw new AppError(400, 'VALIDATION_ERROR', 'externalId is required');
  }

  const pool = getPool();

  try {
    const { rows } = await pool.query(
      `INSERT INTO users (external_id)
       VALUES ($1)
       RETURNING id, external_id, cached_balance_paise, created_at`,
      [externalId.trim()]
    );
    return mapUser(rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      throw new AppError(409, 'DUPLICATE_USER', 'User with this externalId already exists');
    }
    throw error;
  }
}

async function getUserById(userId) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT id, external_id, cached_balance_paise, created_at
     FROM users
     WHERE id = $1`,
    [userId]
  );

  if (rows.length === 0) {
    throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
  }

  return mapUser(rows[0]);
}

async function userExists(userId, client = getPool()) {
  const { rows } = await client.query('SELECT 1 FROM users WHERE id = $1', [userId]);
  return rows.length > 0;
}

module.exports = {
  createUser,
  getUserById,
  userExists,
};
