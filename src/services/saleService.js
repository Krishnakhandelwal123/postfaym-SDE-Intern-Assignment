const { getPool } = require('../db/pool');
const { AppError } = require('../utils/errors');
const { paiseToRupeeString } = require('../utils/money');
const { userExists } = require('./userService');
const { brandExists } = require('./brandService');

function mapSale(row) {
  return {
    id: row.id,
    userId: row.user_id,
    brandId: row.brand_id,
    earningPaise: Number(row.earning_paise),
    earningRupee: paiseToRupeeString(row.earning_paise),
    status: row.status,
    createdAt: row.created_at.toISOString(),
    reconciledAt: row.reconciled_at ? row.reconciled_at.toISOString() : null,
  };
}

async function createSale(userId, brandId, earningPaise) {
  if (!userId || !brandId) {
    throw new AppError(400, 'VALIDATION_ERROR', 'userId and brandId are required');
  }

  if (!Number.isInteger(earningPaise) || earningPaise < 0) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'earningPaise must be a non-negative integer'
    );
  }

  const pool = getPool();

  if (!(await userExists(userId))) {
    throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
  }

  if (!(await brandExists(brandId))) {
    throw new AppError(404, 'BRAND_NOT_FOUND', 'Brand not found');
  }

  const { rows } = await pool.query(
    `INSERT INTO sales (user_id, brand_id, earning_paise)
     VALUES ($1, $2, $3)
     RETURNING id, user_id, brand_id, earning_paise, status, created_at, reconciled_at`,
    [userId, brandId, earningPaise]
  );

  return mapSale(rows[0]);
}

async function getSaleById(saleId) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT id, user_id, brand_id, earning_paise, status, created_at, reconciled_at
     FROM sales
     WHERE id = $1`,
    [saleId]
  );

  if (rows.length === 0) {
    throw new AppError(404, 'SALE_NOT_FOUND', 'Sale not found');
  }

  return mapSale(rows[0]);
}

async function getPendingSalesForUser(userId) {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT id, user_id, brand_id, earning_paise, status, created_at, reconciled_at
     FROM sales
     WHERE user_id = $1 AND status = 'pending'
     ORDER BY created_at ASC`,
    [userId]
  );

  return rows.map(mapSale);
}

module.exports = {
  createSale,
  getSaleById,
  getPendingSalesForUser,
  mapSale,
};
