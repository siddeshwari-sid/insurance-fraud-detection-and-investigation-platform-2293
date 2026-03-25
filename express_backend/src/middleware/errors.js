const { ZodError } = require('zod');

class ApiError extends Error {
  constructor(statusCode, message, details) {
    super(message);
    this.statusCode = statusCode;
    this.details = details || null;
  }
}

// PUBLIC_INTERFACE
function notFound(message) {
  /** Creates a 404 error. */
  return new ApiError(404, message || 'Not found');
}

// PUBLIC_INTERFACE
function badRequest(message, details) {
  /** Creates a 400 error. */
  return new ApiError(400, message || 'Bad request', details);
}

// PUBLIC_INTERFACE
function toErrorResponse(err) {
  /** Converts internal errors (including Zod) into HTTP response payloads. */
  if (err instanceof ApiError) {
    return {
      statusCode: err.statusCode,
      body: {
        status: 'error',
        message: err.message,
        details: err.details
      }
    };
  }

  if (err instanceof ZodError) {
    return {
      statusCode: 400,
      body: {
        status: 'error',
        message: 'Validation error',
        details: err.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message
        }))
      }
    };
  }

  return {
    statusCode: 500,
    body: {
      status: 'error',
      message: 'Internal Server Error'
    }
  };
}

module.exports = {
  ApiError,
  notFound,
  badRequest,
  toErrorResponse
};
