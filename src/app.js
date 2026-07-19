const express = require('express');
const usersRouter = require('./routes/users');
const brandsRouter = require('./routes/brands');
const salesRouter = require('./routes/sales');
const adminRouter = require('./routes/admin');
const walletRouter = require('./routes/wallet');
const withdrawalsRouter = require('./routes/withdrawals');
const errorHandler = require('./middleware/errorHandler');

function createApp() {
  const app = express();

  app.use(express.json());

  app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  app.use('/users', usersRouter);
  app.use('/users/:userId', walletRouter);
  app.use('/brands', brandsRouter);
  app.use('/sales', salesRouter);
  app.use('/admin', adminRouter);
  app.use('/withdrawals', withdrawalsRouter);

  app.use(errorHandler);

  return app;
}

module.exports = createApp;
