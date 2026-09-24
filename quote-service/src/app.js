import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { requireStaff, requireTenant } from './auth.js';
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
      allowedHeaders: ['Content-Type', 'Accept', 'X-CSRF-Token', 'X-SymlaVault-Client'],
    })(req, res, next);
  });
  app.use((req, res, next) => {
    const largeBody =
      req.method === 'POST' &&
      /\/inventory\/skus\/[0-9a-f-]{36}\/catalog-image$/i.test(req.path || req.url || '');
    express.json({ limit: largeBody ? '3mb' : '32kb' })(req, res, next);
  });
  app.use((req, _res, next) => {
    req.log = req.log || { error() {}, info() {}, warn() {} };
    next();
  });

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'quote-service' });
  });

  const tenant = requireTenant({ verify, expectedTenantId });
  const staff = requireStaff({ verify, expectedTenantId });
  const inv = inventoryRoutes({ pool, staff });
  const routes = quoteRoutes({
    pool,
    staff,
    allowedOrigins,
    square,
    calendar,
  });
  app.use('/api/v1/quotes/inventory', tenant, inv);
  app.use('/inventory', tenant, inv);
  app.use('/api/v1/quotes', tenant, routes);
  app.use('/', tenant, routes);

  return app;
}
