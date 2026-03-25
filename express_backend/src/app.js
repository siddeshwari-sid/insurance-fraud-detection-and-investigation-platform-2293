const cors = require('cors');
const express = require('express');
const routes = require('./routes');
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('../swagger');
const { toErrorResponse } = require('./middleware/errors');

// Initialize express app
const app = express();

// CORS configuration:
// - Set FRONTEND_ORIGIN to a single origin or a comma-separated allowlist.
//   Example: FRONTEND_ORIGIN=https://myapp.com,https://staging.myapp.com
// - If not set, default to reflecting the request origin (dev-friendly).
const frontendOrigin = process.env.FRONTEND_ORIGIN;

const allowedOrigins = (frontendOrigin || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: (origin, cb) => {
      // Non-browser clients (no Origin) should be allowed.
      if (!origin) return cb(null, true);

      // If no explicit allowlist, reflect origin (useful for dev/previews).
      if (allowedOrigins.length === 0) return cb(null, true);

      if (allowedOrigins.includes(origin)) return cb(null, true);

      return cb(new Error(`CORS blocked for origin: ${origin}`), false);
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
  })
);

app.set('trust proxy', true);

app.use('/docs', swaggerUi.serve, (req, res, next) => {
  const host = req.get('host'); // may or may not include port
  let protocol = req.protocol; // http or https

  const actualPort = req.socket.localPort;
  const hasPort = host.includes(':');

  const needsPort =
    !hasPort &&
    ((protocol === 'http' && actualPort !== 80) || (protocol === 'https' && actualPort !== 443));
  const fullHost = needsPort ? `${host}:${actualPort}` : host;
  protocol = req.secure ? 'https' : protocol;

  const dynamicSpec = {
    ...swaggerSpec,
    servers: [
      {
        url: `${protocol}://${fullHost}`
      }
    ]
  };
  swaggerUi.setup(dynamicSpec)(req, res, next);
});

// Parse JSON request body
app.use(express.json());

// Mount routes
app.use('/', routes);

// Error handling middleware (last)
app.use((err, req, res, next) => {
  console.error(err);
  const { statusCode, body } = toErrorResponse(err);
  res.status(statusCode).json(body);
});

module.exports = app;
