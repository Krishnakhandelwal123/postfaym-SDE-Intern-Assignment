const express = require('express');
const { asyncHandler } = require('../middleware/asyncHandler');
const { createBrand } = require('../services/brandService');

const router = express.Router();

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const brand = await createBrand(req.body.name);
    res.status(201).json(brand);
  })
);

module.exports = router;
