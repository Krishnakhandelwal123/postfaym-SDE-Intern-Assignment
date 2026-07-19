require('dotenv').config();

const createApp = require('./app');
const { getPool } = require('./db/pool');

const PORT = process.env.PORT || 3000;

async function start() {
  getPool();
  const app = createApp();

  app.listen(PORT, () => {
    console.log(`Payout system listening on port ${PORT}`);
  });
}

start().catch((error) => {
  console.error('Failed to start server:', error.message);
  process.exit(1);
});
