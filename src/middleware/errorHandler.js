const { AppError } = require('../utils/errors');

function errorHandler(error, req, res, next) {
  if (error instanceof AppError) {
    return res.status(error.statusCode).json({
      error: error.code,
      message: error.message,
      details: Object.keys(error.details).length > 0 ? error.details : undefined,
    });
  }

  console.error(error);
  return res.status(500).json({
    error: 'INTERNAL_SERVER_ERROR',
    message: 'An unexpected error occurred',
  });
}

module.exports = errorHandler;
