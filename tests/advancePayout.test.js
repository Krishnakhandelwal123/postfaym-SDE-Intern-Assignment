require('dotenv').config();

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { randomUUID } = require('crypto');
const { getPool } = require('../src/db/pool');
const {
  setupTestEnvironment,
  teardownTestEnvironment,
  resetDatabase,
  getTestDatabaseUrl,
} = require('./setup');

process.env.DATABASE_URL = getTestDatabaseUrl();

const createApp = require('../src/app');

describe('sales and advance payout job', () => {
  let app;
  let pool;

  before(async () => {
    pool = await setupTestEnvironment();
    app = createApp();
  });

  after(async () => {
    await teardownTestEnvironment(pool);
  });

  beforeEach(async () => {
    await resetDatabase(pool);
  });

  async function seedUserBrandSale(earningPaise = 4000) {
    const suffix = randomUUID().slice(0, 8);

    const userRes = await request(app)
      .post('/users')
      .send({ externalId: `john_doe_${suffix}` })
      .expect(201);

    const brandRes = await request(app)
      .post('/brands')
      .send({ name: `brand_1_${suffix}` })
      .expect(201);

    const saleRes = await request(app)
      .post('/sales')
      .send({
        userId: userRes.body.id,
        brandId: brandRes.body.id,
        earningPaise,
      })
      .expect(201);

    return {
      user: userRes.body,
      brand: brandRes.body,
      sale: saleRes.body,
    };
  }

  it('creates user, brand, and pending sale', async () => {
    const { user, brand, sale } = await seedUserBrandSale();

    assert.match(user.externalId, /^john_doe_/);
    assert.equal(user.balancePaise, 0);
    assert.match(brand.name, /^brand_1_/);
    assert.equal(sale.status, 'pending');
    assert.equal(sale.earningPaise, 4000);
    assert.equal(sale.earningRupee, '40.00');
  });

  it('runs advance payout job and credits 10% to ledger', async () => {
    const { user } = await seedUserBrandSale();

    const jobRes = await request(app)
      .post('/admin/advance-payout-job/run')
      .expect(200);

    assert.equal(jobRes.body.processed, 1);
    assert.equal(jobRes.body.skipped, 0);
    assert.equal(jobRes.body.totalAdvancePaidPaise, 400);
    assert.deepEqual(jobRes.body.errors, []);

    const balanceRes = await request(app)
      .get(`/users/${user.id}/balance`)
      .expect(200);

    assert.equal(balanceRes.body.balancePaise, 400);
    assert.equal(balanceRes.body.balanceRupee, '4.00');

    const ledgerRes = await request(app)
      .get(`/users/${user.id}/ledger`)
      .expect(200);

    assert.equal(ledgerRes.body.entries.length, 1);
    assert.equal(ledgerRes.body.entries[0].entryType, 'advance_payout');
    assert.equal(ledgerRes.body.entries[0].amountPaise, 400);

    const advanceRows = await pool.query('SELECT * FROM advance_payouts');
    assert.equal(advanceRows.rows.length, 1);
    assert.equal(Number(advanceRows.rows[0].amount_paise), 400);
  });

  it('is idempotent when advance payout job is run twice', async () => {
    const { user } = await seedUserBrandSale();

    await request(app).post('/admin/advance-payout-job/run').expect(200);

    const secondRun = await request(app)
      .post('/admin/advance-payout-job/run')
      .expect(200);

    assert.equal(secondRun.body.processed, 0);
    assert.equal(secondRun.body.skipped, 0);

    const balanceRes = await request(app)
      .get(`/users/${user.id}/balance`)
      .expect(200);

    assert.equal(balanceRes.body.balancePaise, 400);

    const ledgerCount = await pool.query(
      'SELECT COUNT(*)::INT AS count FROM ledger_entries'
    );
    assert.equal(ledgerCount.rows[0].count, 1);

    const advanceCount = await pool.query(
      'SELECT COUNT(*)::INT AS count FROM advance_payouts'
    );
    assert.equal(advanceCount.rows[0].count, 1);
  });

  it('processes multiple pending sales in one job run', async () => {
    const suffix = randomUUID().slice(0, 8);

    const userRes = await request(app)
      .post('/users')
      .send({ externalId: `john_doe_${suffix}` })
      .expect(201);

    const brandRes = await request(app)
      .post('/brands')
      .send({ name: `brand_1_${suffix}` })
      .expect(201);

    for (let i = 0; i < 3; i += 1) {
      await request(app)
        .post('/sales')
        .send({
          userId: userRes.body.id,
          brandId: brandRes.body.id,
          earningPaise: 4000,
        })
        .expect(201);
    }

    const jobRes = await request(app)
      .post('/admin/advance-payout-job/run')
      .expect(200);

    assert.equal(jobRes.body.processed, 3);
    assert.equal(jobRes.body.totalAdvancePaidPaise, 1200);

    const balanceRes = await request(app)
      .get(`/users/${userRes.body.id}/balance`)
      .expect(200);

    assert.equal(balanceRes.body.balancePaise, 1200);
    assert.equal(balanceRes.body.balanceRupee, '12.00');
  });

  it('skips sales where 10% advance rounds to zero', async () => {
    await seedUserBrandSale(5);

    const jobRes = await request(app)
      .post('/admin/advance-payout-job/run')
      .expect(200);

    assert.equal(jobRes.body.processed, 0);
    assert.equal(jobRes.body.skipped, 1);
    assert.equal(jobRes.body.totalAdvancePaidPaise, 0);

    const advanceCount = await pool.query(
      'SELECT COUNT(*)::INT AS count FROM advance_payouts'
    );
    assert.equal(advanceCount.rows[0].count, 0);
  });

  it('returns validation errors for invalid sale input', async () => {
    const suffix = randomUUID().slice(0, 8);

    const userRes = await request(app)
      .post('/users')
      .send({ externalId: `john_doe_${suffix}` })
      .expect(201);

    const brandRes = await request(app)
      .post('/brands')
      .send({ name: `brand_1_${suffix}` })
      .expect(201);

    const invalidRes = await request(app)
      .post('/sales')
      .send({
        userId: userRes.body.id,
        brandId: brandRes.body.id,
        earningPaise: -100,
      })
      .expect(400);

    assert.equal(invalidRes.body.error, 'VALIDATION_ERROR');
  });

  it('updates cached balance in users table alongside ledger', async () => {
    const { user } = await seedUserBrandSale();

    await request(app).post('/admin/advance-payout-job/run').expect(200);

    const { rows } = await getPool().query(
      'SELECT cached_balance_paise FROM users WHERE id = $1',
      [user.id]
    );

    assert.equal(Number(rows[0].cached_balance_paise), 400);
  });
});
