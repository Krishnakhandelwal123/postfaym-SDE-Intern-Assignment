# User Payout Management System

**Demo:** [Watch on Loom](https://www.loom.com/share/e0d17b2890c5434ca5eb3eae741112bf)

## Overview

Backend service for managing user earnings from brand sales through a multi-stage payout lifecycle: advance payouts (10%), admin reconciliation, and user withdrawals. Wallet balance is derived from an **append-only ledger** — never a mutable balance column.

See [DESIGN.md](./DESIGN.md) for the full low-level design, schema rationale, and edge cases.

**Key design decision:** Every money movement (advance, reconciliation, withdrawal, refund) is an immutable ledger entry. Balance = `SUM(ledger_entries)`.

## Features

- Create users, brands, and pending sales
- Idempotent advance payout batch job (10% of sale earning)
- Admin reconciliation (approve / reject) with net payout calculation
- User withdrawals with immediate debit and payment-provider resolution
- 24-hour rate limit on **successful** withdrawals only
- Failed payout recovery via ledger refund entries
- Full audit trail via paginated ledger history

## Setup

**Prerequisites:** Node.js 18+, Docker Desktop

```bash
# 1. Start PostgreSQL
docker-compose up -d

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env

# 4. Run migrations
npm run migrate

# 5. Start the server
npm start
```

Server runs at `http://localhost:3000`.

Health check: `GET http://localhost:3000/health`

## Running tests

Ensure Docker Postgres is running:

```bash
npm test
```

Tests use a separate database (`payout_test`) created automatically. All test suites run serially to avoid database race conditions.

**Assignment fixture:** The reconciliation test suite verifies the PDF example — 3 sales × ₹40, advance job, reconcile (reject, approve, approve) → **₹68** reconciliation delta and **₹80** total balance.

## API reference

| Method | Endpoint | Purpose |
|---|---|---|
| `POST` | `/users` | Create user |
| `POST` | `/brands` | Create brand |
| `POST` | `/sales` | Create sale (`pending`) |
| `POST` | `/admin/advance-payout-job/run` | Run advance payout batch job |
| `POST` | `/admin/sales/:saleId/reconcile` | Approve or reject a sale |
| `GET` | `/users/:userId/balance` | Current wallet balance |
| `GET` | `/users/:userId/ledger` | Paginated transaction history |
| `POST` | `/users/:userId/withdrawals` | Initiate withdrawal |
| `POST` | `/withdrawals/:withdrawalId/resolve` | Resolve withdrawal (webhook simulator) |

Import [postman_collection.json](./postman_collection.json) into Postman or Thunder Client for one-click testing.

### Example requests

**Create user**
```json
POST /users
{ "externalId": "john_doe" }
```

**Create sale**
```json
POST /sales
{ "userId": "<uuid>", "brandId": "<uuid>", "earningPaise": 4000 }
```

**Reconcile sale**
```json
POST /admin/sales/:saleId/reconcile
{ "status": "approved" }
```

**Initiate withdrawal**
```json
POST /users/:userId/withdrawals
{ "amountPaise": 2000 }
```

**Resolve withdrawal**
```json
POST /withdrawals/:withdrawalId/resolve
{ "outcome": "success" }
```

### PowerShell quick test

On Windows, use `Invoke-RestMethod` with single-quoted JSON:

```powershell
Invoke-RestMethod -Uri http://localhost:3000/users -Method POST -ContentType "application/json" -Body '{"externalId":"john_doe"}'
```

## Project structure

```
src/
├── db/           # Pool, migrations
├── services/     # Business logic
├── routes/       # HTTP handlers
├── middleware/   # Error handling
└── utils/        # Money helpers, AppError
tests/
├── advancePayout.test.js
├── reconciliation.test.js
└── withdrawals.test.js
```

## Design trade-offs

| Decision | Choice | Why |
|---|---|---|
| Balance storage | Append-only ledger | Auditability, idempotency, concurrency safety |
| Money type | Integer paise (`BIGINT`) | No floating-point precision errors |
| Advance idempotency | `UNIQUE(sale_id)` on `advance_payouts` | DB-level guard against duplicate payouts under concurrent job runs |
| Withdrawal debit timing | Immediate on initiate | Prevents double-spend; refund on failure |
| 24h withdrawal window | Based on last **success** only | Fairness when payment provider fails |
| Negative balance | Allowed on rejection clawback | Nets against future earnings instead of blocking reconciliation |
| Batch job transactions | Per-sale, not whole batch | Partial failure recovery without rolling back entire job |

## What I'd add with more time

- Authentication / authorization for admin endpoints
- Distributed locking for multi-instance deployment (currently Postgres row locks)
- Job queue (Bull / SQS) for advance payout at scale
- Rate limiting on withdrawal **attempts** (abuse prevention alongside 24h success rule)
- Outbox pattern for reliable async payment provider dispatch
- Admin audit log with actor attribution for reconciliation actions
- Partition `ledger_entries` by user or time for query performance at scale

## Design

See [DESIGN.md](./DESIGN.md) for the complete LLD including schema, API spec, process flows, and edge cases.
