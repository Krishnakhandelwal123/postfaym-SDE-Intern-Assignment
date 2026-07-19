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

describe('withdrawals', () => {
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

  async function seedUserWithBrand() {
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

  async function fundWallet(userId, brandId, earningPaise = 5000) {
    const saleRes = await request(app)
      .post('/sales')
      .send({ userId, brandId, earningPaise })
      .expect(201);

    await request(app)
      .post(`/admin/sales/${saleRes.body.id}/reconcile`)
      .send({ status: 'approved' })
      .expect(200);
  }

  it('initiates withdrawal, debits balance immediately, and completes on success', async () => {
    const { user, brand } = await seedUserWithBrand();
    await fundWallet(user.id, brand.id, 5000);

    const withdrawalRes = await request(app)
      .post(`/users/${user.id}/withdrawals`)
      .send({ amountPaise: 2000 })
      .expect(201);

    assert.equal(withdrawalRes.body.status, 'initiated');
    assert.equal(withdrawalRes.body.amountPaise, 2000);

    const balanceAfterInitiate = await request(app)
      .get(`/users/${user.id}/balance`)
      .expect(200);

    assert.equal(balanceAfterInitiate.body.balancePaise, 3000);

    const resolveRes = await request(app)
      .post(`/withdrawals/${withdrawalRes.body.id}/resolve`)
      .send({ outcome: 'success' })
      .expect(200);

    assert.equal(resolveRes.body.status, 'success');
    assert.equal(resolveRes.body.refundIssued, false);

    const finalBalance = await request(app)
      .get(`/users/${user.id}/balance`)
      .expect(200);

    assert.equal(finalBalance.body.balancePaise, 3000);
  });

  it('rejects withdrawal when amount exceeds balance', async () => {
    const { user, brand } = await seedUserWithBrand();
    await fundWallet(user.id, brand.id, 1000);

    const response = await request(app)
      .post(`/users/${user.id}/withdrawals`)
      .send({ amountPaise: 2000 })
      .expect(400);

    assert.equal(response.body.error, 'INSUFFICIENT_BALANCE');
  });

  it('refunds balance when withdrawal fails', async () => {
    const { user, brand } = await seedUserWithBrand();
    await fundWallet(user.id, brand.id, 5000);

    const withdrawalRes = await request(app)
      .post(`/users/${user.id}/withdrawals`)
      .send({ amountPaise: 2000 })
      .expect(201);

    const resolveRes = await request(app)
      .post(`/withdrawals/${withdrawalRes.body.id}/resolve`)
      .send({ outcome: 'failed' })
      .expect(200);

    assert.equal(resolveRes.body.status, 'failed');
    assert.equal(resolveRes.body.refundIssued, true);
    assert.ok(resolveRes.body.refundLedgerEntryId);

    const balance = await request(app)
      .get(`/users/${user.id}/balance`)
      .expect(200);

    assert.equal(balance.body.balancePaise, 5000);
  });

  it('enforces 24h rate limit after a successful withdrawal', async () => {
    const { user, brand } = await seedUserWithBrand();
    await fundWallet(user.id, brand.id, 10000);

    const firstWithdrawal = await request(app)
      .post(`/users/${user.id}/withdrawals`)
      .send({ amountPaise: 1000 })
      .expect(201);

    await request(app)
      .post(`/withdrawals/${firstWithdrawal.body.id}/resolve`)
      .send({ outcome: 'success' })
      .expect(200);

    const secondAttempt = await request(app)
      .post(`/users/${user.id}/withdrawals`)
      .send({ amountPaise: 1000 })
      .expect(429);

    assert.equal(secondAttempt.body.error, 'WITHDRAWAL_RATE_LIMITED');
    assert.ok(secondAttempt.body.details.nextEligibleAt);
    assert.ok(secondAttempt.body.details.lastSuccessfulWithdrawalAt);
  });

  it('allows immediate retry after a failed withdrawal', async () => {
    const { user, brand } = await seedUserWithBrand();
    await fundWallet(user.id, brand.id, 5000);

    const failedWithdrawal = await request(app)
      .post(`/users/${user.id}/withdrawals`)
      .send({ amountPaise: 1000 })
      .expect(201);

    await request(app)
      .post(`/withdrawals/${failedWithdrawal.body.id}/resolve`)
      .send({ outcome: 'failed' })
      .expect(200);

    const retryWithdrawal = await request(app)
      .post(`/users/${user.id}/withdrawals`)
      .send({ amountPaise: 1000 })
      .expect(201);

    assert.equal(retryWithdrawal.body.status, 'initiated');
  });

  it('allows withdrawal after 24h window from last successful withdrawal', async () => {
    const { user, brand } = await seedUserWithBrand();
    await fundWallet(user.id, brand.id, 10000);

    const firstWithdrawal = await request(app)
      .post(`/users/${user.id}/withdrawals`)
      .send({ amountPaise: 1000 })
      .expect(201);

    await request(app)
      .post(`/withdrawals/${firstWithdrawal.body.id}/resolve`)
      .send({ outcome: 'success' })
      .expect(200);

    await pool.query(
      `UPDATE withdrawals
       SET resolved_at = now() - interval '25 hours'
       WHERE id = $1`,
      [firstWithdrawal.body.id]
    );

    await request(app)
      .post(`/users/${user.id}/withdrawals`)
      .send({ amountPaise: 1000 })
      .expect(201);
  });

  it('is idempotent when resolve webhook is replayed with same outcome', async () => {
    const { user, brand } = await seedUserWithBrand();
    await fundWallet(user.id, brand.id, 5000);

    const withdrawalRes = await request(app)
      .post(`/users/${user.id}/withdrawals`)
      .send({ amountPaise: 1000 })
      .expect(201);

    await request(app)
      .post(`/withdrawals/${withdrawalRes.body.id}/resolve`)
      .send({ outcome: 'failed' })
      .expect(200);

    const replay = await request(app)
      .post(`/withdrawals/${withdrawalRes.body.id}/resolve`)
      .send({ outcome: 'failed' })
      .expect(200);

    assert.equal(replay.body.status, 'failed');
    assert.equal(replay.body.refundIssued, true);

    const ledgerCount = await pool.query(
      `SELECT COUNT(*)::INT AS count
       FROM ledger_entries
       WHERE reference_type = 'withdrawal'
         AND reference_id = $1
         AND entry_type = 'withdrawal_refund'`,
      [withdrawalRes.body.id]
    );

    assert.equal(ledgerCount.rows[0].count, 1);
  });

  it('rejects resolve with different outcome after withdrawal is already resolved', async () => {
    const { user, brand } = await seedUserWithBrand();
    await fundWallet(user.id, brand.id, 5000);

    const withdrawalRes = await request(app)
      .post(`/users/${user.id}/withdrawals`)
      .send({ amountPaise: 1000 })
      .expect(201);

    await request(app)
      .post(`/withdrawals/${withdrawalRes.body.id}/resolve`)
      .send({ outcome: 'success' })
      .expect(200);

    const response = await request(app)
      .post(`/withdrawals/${withdrawalRes.body.id}/resolve`)
      .send({ outcome: 'failed' })
      .expect(409);

    assert.equal(response.body.error, 'WITHDRAWAL_ALREADY_RESOLVED');
  });

  it('rejects invalid withdrawal amount', async () => {
    const { user, brand } = await seedUserWithBrand();
    await fundWallet(user.id, brand.id, 5000);

    const response = await request(app)
      .post(`/users/${user.id}/withdrawals`)
      .send({ amountPaise: 0 })
      .expect(400);

    assert.equal(response.body.error, 'VALIDATION_ERROR');
  });

  it('returns 404 for unknown withdrawal on resolve', async () => {
    const response = await request(app)
      .post(`/withdrawals/${randomUUID()}/resolve`)
      .send({ outcome: 'success' })
      .expect(404);

    assert.equal(response.body.error, 'WITHDRAWAL_NOT_FOUND');
  });
});
