const express = require('express');
const { asyncHandler } = require('../middleware/asyncHandler');
const { runAdvancePayoutJob } = require('../services/advancePayoutService');
const { reconcileSale } = require('../services/reconciliationService');

const router = express.Router();

router.post(
  '/advance-payout-job/run',
  asyncHandler(async (req, res) => {
    const result = await runAdvancePayoutJob();
    res.status(200).json(result);
  })
);

router.post(
  '/sales/:saleId/reconcile',
  asyncHandler(async (req, res) => {
    const result = await reconcileSale(req.params.saleId, req.body.status);
    res.status(200).json(result);
  })
);

module.exports = router;
