const { getPool } = require('../db/pool');
const { AppError } = require('../utils/errors');
const { paiseToRupeeString } = require('../utils/money');
const { mapSale } = require('./saleService');
const { getBalance, updateCachedBalance } = require('./walletService');

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

async function reconcileSale(saleId, newStatus) {
  if (newStatus !== 'approved' && newStatus !== 'rejected') {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'status must be "approved" or "rejected"'
    );
  }

  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const { rows: saleRows } = await client.query(
      `SELECT id, user_id, brand_id, earning_paise, status, created_at, reconciled_at
       FROM sales
       WHERE id = $1
       FOR UPDATE`,
      [saleId]
    );

    if (saleRows.length === 0) {
      throw new AppError(404, 'SALE_NOT_FOUND', 'Sale not found');
    }

    const sale = saleRows[0];

    if (sale.status !== 'pending') {
      throw new AppError(
        409,
        'SALE_ALREADY_RECONCILED',
        'Sale has already been reconciled'
      );
    }

    const { rows: advanceRows } = await client.query(
      `SELECT amount_paise
       FROM advance_payouts
       WHERE sale_id = $1`,
      [saleId]
    );

    const advancePaise =
      advanceRows.length > 0 ? Number(advanceRows[0].amount_paise) : 0;

    let ledgerEntry = null;
    let ledgerDeltaPaise = 0;

    if (newStatus === 'approved') {
      const creditPaise = Number(sale.earning_paise) - advancePaise;

      if (creditPaise !== 0) {
        const { rows: ledgerRows } = await client.query(
          `INSERT INTO ledger_entries (
             user_id, amount_paise, entry_type, reference_type, reference_id
           ) VALUES ($1, $2, 'final_approval_credit', 'sale', $3)
           RETURNING id, amount_paise, entry_type, reference_type, reference_id, created_at`,
          [sale.user_id, creditPaise, saleId]
        );

        ledgerEntry = mapLedgerEntry(ledgerRows[0]);
        ledgerDeltaPaise = creditPaise;
      }
    } else if (advancePaise > 0) {
      const { rows: ledgerRows } = await client.query(
        `INSERT INTO ledger_entries (
           user_id, amount_paise, entry_type, reference_type, reference_id
         ) VALUES ($1, $2, 'rejection_adjustment', 'sale', $3)
         RETURNING id, amount_paise, entry_type, reference_type, reference_id, created_at`,
        [sale.user_id, -advancePaise, saleId]
      );

      ledgerEntry = mapLedgerEntry(ledgerRows[0]);
      ledgerDeltaPaise = -advancePaise;
    }

    const { rows: updatedSaleRows } = await client.query(
      `UPDATE sales
       SET status = $2, reconciled_at = now()
       WHERE id = $1
       RETURNING id, user_id, brand_id, earning_paise, status, created_at, reconciled_at`,
      [saleId, newStatus]
    );

    if (ledgerDeltaPaise !== 0) {
      await updateCachedBalance(client, sale.user_id, ledgerDeltaPaise);
    }

    await client.query('COMMIT');

    const balance = await getBalance(sale.user_id);

    return {
      sale: mapSale(updatedSaleRows[0]),
      ledgerEntry,
      userBalancePaise: balance.balancePaise,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  reconcileSale,
};
