const { getPool } = require('../db/pool');
const { isUniqueViolation } = require('../utils/errors');
const { computeAdvancePaise } = require('../utils/money');
const { updateCachedBalance } = require('./walletService');

async function processAdvanceForSale(client, sale) {
  const advancePaise = computeAdvancePaise(sale.earning_paise);

  if (advancePaise <= 0) { 
    return { status: 'skipped', reason: 'advance_amount_zero' };
  }

  try {
    await client.query('BEGIN');

    await client.query(
      `INSERT INTO advance_payouts (sale_id, user_id, amount_paise)
       VALUES ($1, $2, $3)`,
      [sale.id, sale.user_id, advancePaise]
    );

    await client.query(
      `INSERT INTO ledger_entries (
         user_id, amount_paise, entry_type, reference_type, reference_id
       ) VALUES ($1, $2, 'advance_payout', 'sale', $3)`,
      [sale.user_id, advancePaise, sale.id]
    );

    await updateCachedBalance(client, sale.user_id, advancePaise);

    await client.query('COMMIT');

    return { status: 'processed', advancePaise };
  } catch (error) {
    await client.query('ROLLBACK');

    if (isUniqueViolation(error)) {
      return { status: 'skipped', reason: 'already_processed' };
    }

    throw error;
  }
}

async function runAdvancePayoutJob() {
  const pool = getPool();

  const { rows: pendingSales } = await pool.query(
    `SELECT s.id, s.user_id, s.earning_paise
     FROM sales s
     LEFT JOIN advance_payouts ap ON ap.sale_id = s.id
     WHERE s.status = 'pending'
       AND ap.id IS NULL
     ORDER BY s.created_at ASC`
  );

  let processed = 0;
  let skipped = 0;
  let totalAdvancePaidPaise = 0;
  const errors = [];

  for (const sale of pendingSales) {
    const client = await pool.connect();

    try {
      const result = await processAdvanceForSale(client, sale);

      if (result.status === 'processed') {
        processed += 1;
        totalAdvancePaidPaise += result.advancePaise;
      } else {
        skipped += 1;
      }
    } catch (error) {
      errors.push({
        saleId: sale.id,
        error: error.message,
      });
    } finally {
      client.release();
    }
  }

  return {
    processed,
    skipped,
    errors,
    totalAdvancePaidPaise,
  };
}

module.exports = {
  runAdvancePayoutJob,
  processAdvanceForSale,
};
