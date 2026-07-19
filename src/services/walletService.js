const { getPool } = require('../db/pool');
const { AppError } = require('../utils/errors');
const { paiseToRupeeString } = require('../utils/money');
const { userExists } = require('./userService');

function mapLedgerEntry(row) {
  return {
    id: row.id,
    amountPaise: Number(row.amount_paise),
    amountRupee: paiseToRupeeString(row.amount_paise),
    entryType: row.entry_type,
    referenceType: row.reference_type,
    referenceId: row.reference_id,
    createdAt: row.created_at.toISOString(),
  };
}

async function getBalance(userId) {
  if (!(await userExists(userId))) {
    throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
  }

  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(amount_paise), 0)::BIGINT AS balance_paise
     FROM ledger_entries
     WHERE user_id = $1`,
    [userId]
  );

  const balancePaise = Number(rows[0].balance_paise);

  return {
    userId,
    balancePaise,
    balanceRupee: paiseToRupeeString(balancePaise),
  };
}

async function getLedgerHistory(userId, { limit = 50, offset = 0 } = {}) {
  if (!(await userExists(userId))) {
    throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
  }

  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const safeOffset = Math.max(Number(offset) || 0, 0);
  const pool = getPool();

  const [entriesResult, countResult] = await Promise.all([
    pool.query(
      `SELECT id, amount_paise, entry_type, reference_type, reference_id, created_at
       FROM ledger_entries
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, safeLimit, safeOffset]
    ),
    pool.query(
      `SELECT COUNT(*)::INT AS total
       FROM ledger_entries
       WHERE user_id = $1`,
      [userId]
    ),
  ]);

  return {
    userId,
    entries: entriesResult.rows.map(mapLedgerEntry),
    pagination: {
      limit: safeLimit,
      offset: safeOffset,
      total: countResult.rows[0].total,
    },
  };
}

async function updateCachedBalance(client, userId, deltaPaise) {
  await client.query(
    `UPDATE users
     SET cached_balance_paise = cached_balance_paise + $2
     WHERE id = $1`,
    [userId, deltaPaise]
  );
}

module.exports = {
  getBalance,
  getLedgerHistory,
  updateCachedBalance,
};
