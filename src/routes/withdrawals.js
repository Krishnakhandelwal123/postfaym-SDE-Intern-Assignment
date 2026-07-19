const express = require('express');
const { asyncHandler } = require('../middleware/asyncHandler');
const { resolveWithdrawal } = require('../services/withdrawalService');

const router = express.Router();

router.post(
  '/:withdrawalId/resolve',
  asyncHandler(async (req, res) => {
    const result = await resolveWithdrawal(req.params.withdrawalId, req.body.outcome);
    res.status(200).json(result);
  })
);

module.exports = router;
