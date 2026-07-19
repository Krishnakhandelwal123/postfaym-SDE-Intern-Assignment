const { getPool } = require('../db/pool');
const { AppError } = require('../utils/errors');
const { paiseToRupeeString } = require('../utils/money');
const { updateCachedBalance } = require('./walletService');

const VALID_OUTCOMES = ['success', 'failed', 'cancelled', 'rejected'];

function mapWithdrawal(row) {
  return {
    id: row.id,
    userId: row.user_id,
    amountPaise: Number(row.amount_paise),
    amountRupee: paiseToRupeeString(row.amount_paise),
    status: row.status,
    createdAt: row.created_at.toISOString(),
    resolvedAt: row.resolved_at ? row.resolved_at.toISOString() : null,
  };
}

async function getBalanceForUpdate(client, userId) {
  const { rows } = await client.query(
    `SELECT COALESCE(SUM(amount_paise), 0)::BIGINT AS balance_paise
     FROM ledger_entries
     WHERE user_id = $1`,
    [userId]
  );

  return Number(rows[0].balance_paise);
}

async function assertWithdrawalRateLimit(client, userId) {
  const { rows } = await client.query(
    `SELECT resolved_at
     FROM withdrawals
     WHERE user_id = $1
       AND status = 'success'
     ORDER BY resolved_at DESC
     LIMIT 1`,
    [userId]
  );

  if (rows.length === 0) {
    return;
  }

  const lastSuccessfulAt = rows[0].resolved_at;
  const { rows: rateLimitRows } = await client.query(
    `SELECT
       ($1::timestamptz + interval '24 hours') AS next_eligible_at,
       ($1::timestamptz > now() - interval '24 hours') AS is_rate_limited`,
    [lastSuccessfulAt]
  );

  if (rateLimitRows[0].is_rate_limited) {
    throw new AppError(
      429,
      'WITHDRAWAL_RATE_LIMITED',
      'Only one withdrawal is allowed every 24 hours.',
      {
        nextEligibleAt: new Date(rateLimitRows[0].next_eligible_at).toISOString(),
        lastSuccessfulWithdrawalAt: lastSuccessfulAt.toISOString(),
      }
    );
  }
}

async function initiateWithdrawal(userId, amountPaise) {
  if (!Number.isInteger(amountPaise) || amountPaise <= 0) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'amountPaise must be a positive integer'
    );
  }

  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const { rows: userRows } = await client.query(
      `SELECT id FROM users WHERE id = $1 FOR UPDATE`,
      [userId]
    );

    if (userRows.length === 0) {
      throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
    }

    const balancePaise = await getBalanceForUpdate(client, userId);

    if (amountPaise > balancePaise) {
      throw new AppError(
        400,
        'INSUFFICIENT_BALANCE',
        'Withdrawal amount exceeds available balance'
      );
    }

    await assertWithdrawalRateLimit(client, userId);

    const { rows: withdrawalRows } = await client.query(
      `INSERT INTO withdrawals (user_id, amount_paise, status)
       VALUES ($1, $2, 'initiated')
       RETURNING id, user_id, amount_paise, status, created_at, resolved_at`,
      [userId, amountPaise]
    );

    const withdrawal = withdrawalRows[0];

    await client.query(
      `INSERT INTO ledger_entries (
         user_id, amount_paise, entry_type, reference_type, reference_id
       ) VALUES ($1, $2, 'withdrawal_debit', 'withdrawal', $3)`,
      [userId, -amountPaise, withdrawal.id]
    );

    await updateCachedBalance(client, userId, -amountPaise);

    await client.query('COMMIT');

    return mapWithdrawal(withdrawal);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function resolveWithdrawal(withdrawalId, outcome) {
  if (!VALID_OUTCOMES.includes(outcome)) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'outcome must be one of: success, failed, cancelled, rejected'
    );
  }

  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const { rows: withdrawalRows } = await client.query(
      `SELECT id, user_id, amount_paise, status, created_at, resolved_at
       FROM withdrawals
       WHERE id = $1
       FOR UPDATE`,
      [withdrawalId]
    );

    if (withdrawalRows.length === 0) {
      throw new AppError(404, 'WITHDRAWAL_NOT_FOUND', 'Withdrawal not found');
    }

    const withdrawal = withdrawalRows[0];

    if (withdrawal.status !== 'initiated') {
      if (withdrawal.status === outcome) {
        await client.query('COMMIT');
        return {
          ...mapWithdrawal(withdrawal),
          refundIssued: withdrawal.status !== 'success',
          refundLedgerEntryId: null,
        };
      }

      throw new AppError(
        409,
        'WITHDRAWAL_ALREADY_RESOLVED',
        'Withdrawal has already been resolved'
      );
    }

    const { rows: updatedRows } = await client.query(
      `UPDATE withdrawals
       SET status = $2, resolved_at = now()
       WHERE id = $1
       RETURNING id, user_id, amount_paise, status, created_at, resolved_at`,
      [withdrawalId, outcome]
    );

    let refundLedgerEntryId = null;

    if (outcome !== 'success') {
      const amountPaise = Number(withdrawal.amount_paise);
      const { rows: ledgerRows } = await client.query(
        `INSERT INTO ledger_entries (
           user_id, amount_paise, entry_type, reference_type, reference_id
         ) VALUES ($1, $2, 'withdrawal_refund', 'withdrawal', $3)
         RETURNING id`,
        [withdrawal.user_id, amountPaise, withdrawalId]
      );

      refundLedgerEntryId = ledgerRows[0].id;
      await updateCachedBalance(client, withdrawal.user_id, amountPaise);
    }

    await client.query('COMMIT');

    return {
      ...mapWithdrawal(updatedRows[0]),
      refundIssued: outcome !== 'success',
      refundLedgerEntryId,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  initiateWithdrawal,
  resolveWithdrawal,
  mapWithdrawal,
};
