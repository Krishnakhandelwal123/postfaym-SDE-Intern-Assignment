const express = require('express');
const { asyncHandler } = require('../middleware/asyncHandler');
const { createSale } = require('../services/saleService');

const router = express.Router();

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const { userId, brandId, earningPaise } = req.body;
    const sale = await createSale(userId, brandId, earningPaise);
    res.status(201).json(sale);
  })
);

module.exports = router;
