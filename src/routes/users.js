const express = require('express');
const { asyncHandler } = require('../middleware/asyncHandler');
const { createUser } = require('../services/userService');

const router = express.Router();

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const user = await createUser(req.body.externalId);
    res.status(201).json(user);
  })
);

module.exports = router;
