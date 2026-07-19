require('dotenv').config();

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { randomUUID } = require('crypto');
const {
  setupTestEnvironment,
  teardownTestEnvironment,
  resetDatabase,
  getTestDatabaseUrl,
} = require('./setup');

process.env.DATABASE_URL = getTestDatabaseUrl();

const createApp = require('../src/app');

describe('reconciliation', () => {
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

  async function seedUserAndBrand() {
    const suffix = randomUUID().slice(0, 8);

    const userRes = await request(app)
      .post('/users')
      .send({ externalId: `user_${suffix}` })
      .expect(201);

    const brandRes = await request(app)
      .post('/brands')
      .send({ name: `brand_${suffix}` })
      .expect(201);

    return { user: userRes.body, brand: brandRes.body };
  }

  async function createSale(userId, brandId, earningPaise = 4000) {
    const saleRes = await request(app)
      .post('/sales')
      .send({ userId, brandId, earningPaise })
      .expect(201);

    return saleRes.body;
  }

  it('PDF fixture: advance + reconcile produces 6800 reconciliation delta and 8000 balance', async () => {
    const { user, brand } = await seedUserAndBrand();

    const sale1 = await createSale(user.id, brand.id);
    const sale2 = await createSale(user.id, brand.id);
    const sale3 = await createSale(user.id, brand.id);

    await request(app).post('/admin/advance-payout-job/run').expect(200);

    const balanceAfterAdvance = await request(app)
      .get(`/users/${user.id}/balance`)
      .expect(200);

    assert.equal(balanceAfterAdvance.body.balancePaise, 1200);

    const rejectRes = await request(app)
      .post(`/admin/sales/${sale1.id}/reconcile`)
      .send({ status: 'rejected' })
      .expect(200);

    assert.equal(rejectRes.body.ledgerEntry.entryType, 'rejection_adjustment');
    assert.equal(rejectRes.body.ledgerEntry.amountPaise, -400);

    const approve2 = await request(app)
      .post(`/admin/sales/${sale2.id}/reconcile`)
      .send({ status: 'approved' })
      .expect(200);

    assert.equal(approve2.body.ledgerEntry.entryType, 'final_approval_credit');
    assert.equal(approve2.body.ledgerEntry.amountPaise, 3600);

    const approve3 = await request(app)
      .post(`/admin/sales/${sale3.id}/reconcile`)
      .send({ status: 'approved' })
      .expect(200);

    assert.equal(approve3.body.ledgerEntry.amountPaise, 3600);

    const reconciliationDelta =
      rejectRes.body.ledgerEntry.amountPaise +
      approve2.body.ledgerEntry.amountPaise +
      approve3.body.ledgerEntry.amountPaise;

    assert.equal(reconciliationDelta, 6800);

    const finalBalance = await request(app)
      .get(`/users/${user.id}/balance`)
      .expect(200);

    assert.equal(finalBalance.body.balancePaise, 8000);
    assert.equal(finalBalance.body.balanceRupee, '80.00');
  });

  it('rejects double reconciliation with 409', async () => {
    const { user, brand } = await seedUserAndBrand();
    const sale = await createSale(user.id, brand.id);

    await request(app).post('/admin/advance-payout-job/run').expect(200);

    await request(app)
      .post(`/admin/sales/${sale.id}/reconcile`)
      .send({ status: 'approved' })
      .expect(200);

    const secondAttempt = await request(app)
      .post(`/admin/sales/${sale.id}/reconcile`)
      .send({ status: 'rejected' })
      .expect(409);

    assert.equal(secondAttempt.body.error, 'SALE_ALREADY_RECONCILED');
  });

  it('approves sale with no prior advance and credits full earning', async () => {
    const { user, brand } = await seedUserAndBrand();
    const sale = await createSale(user.id, brand.id, 5000);

    const result = await request(app)
      .post(`/admin/sales/${sale.id}/reconcile`)
      .send({ status: 'approved' })
      .expect(200);

    assert.equal(result.body.ledgerEntry.amountPaise, 5000);
    assert.equal(result.body.userBalancePaise, 5000);
  });

  it('rejects sale with no prior advance and creates no ledger entry', async () => {
    const { user, brand } = await seedUserAndBrand();
    const sale = await createSale(user.id, brand.id, 5000);

    const result = await request(app)
      .post(`/admin/sales/${sale.id}/reconcile`)
      .send({ status: 'rejected' })
      .expect(200);

    assert.equal(result.body.ledgerEntry, null);
    assert.equal(result.body.userBalancePaise, 0);

    const ledgerCount = await pool.query(
      'SELECT COUNT(*)::INT AS count FROM ledger_entries'
    );
    assert.equal(ledgerCount.rows[0].count, 0);
  });

  it('returns 404 for unknown sale', async () => {
    const response = await request(app)
      .post(`/admin/sales/${randomUUID()}/reconcile`)
      .send({ status: 'approved' })
      .expect(404);

    assert.equal(response.body.error, 'SALE_NOT_FOUND');
  });

  it('returns 400 for invalid reconcile status', async () => {
    const { user, brand } = await seedUserAndBrand();
    const sale = await createSale(user.id, brand.id);

    const response = await request(app)
      .post(`/admin/sales/${sale.id}/reconcile`)
      .send({ status: 'maybe' })
      .expect(400);

    assert.equal(response.body.error, 'VALIDATION_ERROR');
  });

  it('excludes reconciled sales from advance payout job', async () => {
    const { user, brand } = await seedUserAndBrand();
    const sale = await createSale(user.id, brand.id);

    await request(app)
      .post(`/admin/sales/${sale.id}/reconcile`)
      .send({ status: 'approved' })
      .expect(200);

    const jobRes = await request(app)
      .post('/admin/advance-payout-job/run')
      .expect(200);

    assert.equal(jobRes.body.processed, 0);

    const advanceCount = await pool.query(
      'SELECT COUNT(*)::INT AS count FROM advance_payouts'
    );
    assert.equal(advanceCount.rows[0].count, 0);
  });
});
