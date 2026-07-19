const express = require('express');
const { asyncHandler } = require('../middleware/asyncHandler');
const { getBalance, getLedgerHistory } = require('../services/walletService');
const { initiateWithdrawal } = require('../services/withdrawalService');

const router = express.Router({ mergeParams: true });

router.get(
  '/balance',
  asyncHandler(async (req, res) => {
    const balance = await getBalance(req.params.userId);
    res.status(200).json(balance);
  })
);

router.get(
  '/ledger',
  asyncHandler(async (req, res) => {
    const history = await getLedgerHistory(req.params.userId, {
      limit: req.query.limit,
      offset: req.query.offset,
    });
    res.status(200).json(history);
  })
);

router.post(
  '/withdrawals',
  asyncHandler(async (req, res) => {
    const withdrawal = await initiateWithdrawal(
      req.params.userId,
      req.body.amountPaise
    );
    res.status(201).json(withdrawal);
  })
);

module.exports = router;
