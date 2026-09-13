import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { requireStaff } from './auth.js';
import { quoteRoutes } from './routes.js';
import { inventoryRoutes } from './inventory.js';
import { originAllowed } from './cors.js';

export function createApp({ pool, verify, expectedTenantId, allowedOrigins = [], square, calendar } = {}) {
  if (!pool || typeof verify !== 'function') {
    throw new Error('createApp requires pool and verify');
  }

  const app = express();
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use((req, res, next) => {
    cors({
      origin(origin, cb) {
        try {
          const ok = originAllowed(origin, {
            allowedOrigins,
            forwardedHost: req.headers['x-forwarded-host'],
            host: req.headers.host,
          });
          return cb(null, ok);
        } catch {
          return cb(null, false);
        }
      },
      credentials: true,
    })(req, res, next);
  });
  app.use(express.json({ limit: '32kb' }));
  app.use((req, _res, next) => {
    req.log = req.log || { error() {}, info() {}, warn() {} };
    next();
  });

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'quote-service' });
  });

  const gated = requireStaff({ verify, expectedTenantId });
  const inv = inventoryRoutes({ pool });
  const routes = quoteRoutes({
    pool,
    allowedOrigins,
    square,
    calendar,
  });
  app.use('/api/v1/quotes/inventory', gated, inv);
  app.use('/inventory', gated, inv);
  app.use('/api/v1/quotes', gated, routes);
  app.use('/', gated, routes);

  return app;
}
