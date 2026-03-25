const { ZodError } = require('zod');

class ApiError extends Error {
  constructor(statusCode, message, details) {
    super(message);
    this.statusCode = statusCode;
    this.details = details || null;
  }
}

class ConfigError extends Error {
  constructor(message, details) {
    super(message);
    this.name = 'ConfigError';
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
function serviceUnavailable(message, details) {
  /** Creates a 503 error (useful for missing configuration or unavailable dependencies). */
  return new ApiError(503, message || 'Service unavailable', details);
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

  // Treat missing env / configuration as a dependency error, not a generic 500.
  if (err && (err.name === 'ConfigError' || /Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY/.test(err.message || ''))) {
    return {
      statusCode: 503,
      body: {
        status: 'error',
        message: err.message || 'Service configuration missing',
        details: err.details || null
      }
    };
  }

  // CORS blocks should be explicit for easier debugging.
  if (err && typeof err.message === 'string' && err.message.startsWith('CORS blocked for origin:')) {
    return {
      statusCode: 403,
      body: {
        status: 'error',
        message: err.message
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
  ConfigError,
  notFound,
  badRequest,
  serviceUnavailable,
  toErrorResponse
};
