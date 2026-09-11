import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { requireStaff } from './auth.js';
import { quoteRoutes } from './routes.js';
import { inventoryRoutes } from './inventory.js';

export function createApp({ pool, verify, expectedTenantId, allowedOrigins = [] } = {}) {
  if (!pool || typeof verify !== 'function') {
    throw new Error('createApp requires pool and verify');
  }

  const app = express();
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(
    cors({
      origin(origin, cb) {
        if (!origin) return cb(null, true);
        if (allowedOrigins.includes(origin)) return cb(null, true);
        return cb(new Error('Not allowed by CORS'));
      },
      credentials: true,
    })
  );
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
  const routes = quoteRoutes({ pool });
  app.use('/api/v1/quotes/inventory', gated, inv);
  app.use('/inventory', gated, inv);
  app.use('/api/v1/quotes', gated, routes);
  app.use('/', gated, routes);

  return app;
}
