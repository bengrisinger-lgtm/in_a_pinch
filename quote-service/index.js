/**
 * Tenant quote store. Staff session is verified at the gateway; this
 * process checks HMAC with HMAC_SECRET from POST /auth/services.
 * Never COOKIE_SECRET. Register path_prefix /api/v1/quotes.
 */

import pg from 'pg';
import { createServerClient } from '@securedbackend/sdk/server';
import { createApp } from './src/app.js';
import { createSquareRuntime } from './src/square.js';
import { createCalendarRuntime } from './src/calendar.js';

const REQUIRED = ['HMAC_SECRET', 'DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'];
for (const key of REQUIRED) {
  if (!process.env[key]) {
    console.error(`FATAL: ${key} is required`);
    process.exit(1);
  }
}

if (process.env.COOKIE_SECRET) {
  console.error('FATAL: COOKIE_SECRET must not be mounted on a tenant backend');
  process.exit(1);
}

const server = createServerClient({ hmacSecret: process.env.HMAC_SECRET });

let dbHost = (process.env.DB_HOST || '').trim();
if (dbHost && !dbHost.startsWith('/') && dbHost.includes(':')) {
  dbHost = `/cloudsql/${dbHost}`;
}

const pool = new pg.Pool({
  host: dbHost,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const app = createApp({
  pool,
  verify: (req) => server.auth.verifyGatewayHmac(req),
  expectedTenantId: process.env.TENANT_ID || undefined,
  allowedOrigins,
  square: createSquareRuntime({
    consoleServiceUrl: process.env.CONSOLE_SERVICE_URL,
    envAccessToken: process.env.SQUARE_ACCESS_TOKEN,
    envLocationId: process.env.SQUARE_LOCATION_ID,
    apiBase: process.env.SQUARE_API_BASE || 'https://connect.squareup.com',
  }),
  calendar: createCalendarRuntime({
    integrationsServiceUrl: process.env.INTEGRATIONS_SERVICE_URL,
    calendarUserId: process.env.CALENDAR_USER_ID,
    calendarProjectId: process.env.CALENDAR_PROJECT_ID,
    timeZone: process.env.CALENDAR_TIMEZONE || 'America/Denver',
  }),
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`quote-service listening on ${PORT}`);
});
