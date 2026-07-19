const { getPool } = require('../db/pool');
const { AppError } = require('../utils/errors');

function mapBrand(row) {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at.toISOString(),
  };
}

async function createBrand(name) {
  if (!name || typeof name !== 'string' || !name.trim()) {
    throw new AppError(400, 'VALIDATION_ERROR', 'name is required');
  }

  const pool = getPool();

  try {
    const { rows } = await pool.query(
      `INSERT INTO brands (name)
       VALUES ($1)
       RETURNING id, name, created_at`,
      [name.trim()]
    );
    return mapBrand(rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      throw new AppError(409, 'DUPLICATE_BRAND', 'Brand with this name already exists');
    }
    throw error;
  }
}

async function brandExists(brandId, client = getPool()) {
  const { rows } = await client.query('SELECT 1 FROM brands WHERE id = $1', [brandId]);
  return rows.length > 0;
}

module.exports = {
  createBrand,
  brandExists,
};
