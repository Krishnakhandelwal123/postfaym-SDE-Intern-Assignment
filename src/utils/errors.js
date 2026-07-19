class AppError extends Error {
  constructor(statusCode, code, message, details = {}) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

function isUniqueViolation(error) {
  return error && error.code === '23505';
}

module.exports = {
  AppError,
  isUniqueViolation,
};
