import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.js';
import { originAllowed, apexOf } from '../src/cors.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('quote-service CORS (proxied hub Origin)', () => {
  it('never throws from the cors origin callback (that was HTTP 500)', () => {
    const src = fs.readFileSync(path.join(__dirname, '../src/app.js'), 'utf8');
    assert.doesNotMatch(src, /new Error\(\s*['"]Not allowed by CORS['"]\s*\)/);
    assert.match(src, /originAllowed\(/);
    assert.match(src, /x-forwarded-host/);
  });

  it('allows hub and api on the same apex, not a foreign origin', () => {
    assert.equal(apexOf('hub.example.com'), 'example.com');
    assert.equal(apexOf('api.example.com'), 'example.com');
    assert.equal(
      originAllowed('https://hub.example.com', {
        allowedOrigins: ['https://api.symlavault.com'],
        forwardedHost: 'api.example.com',
      }),
      true
    );
    assert.equal(
      originAllowed('https://hub.example.com', {
        allowedOrigins: ['https://hub.example.com'],
      }),
      true
    );
    assert.equal(
      originAllowed('https://evil.example.net', {
        allowedOrigins: ['https://api.symlavault.com'],
        forwardedHost: 'api.example.com',
      }),
      false
    );
  });
});

describe('POST /skus with hub Origin does not 500', () => {
  const TENANT = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const USER = '11111111-1111-1111-1111-111111111111';
  const pool = {
    connect: async () => ({
      query: async (sql) => {
        const compact = String(sql).replace(/\s+/g, ' ').trim();
        if (compact.includes('INSERT INTO') && compact.includes('.inventory_skus')) {
          return {
            rows: [
              {
                id: 'sku-1',
                name: 'SM58',
                category: null,
                description: null,
                daily_rate: 25,
                active: true,
                created_at: '2026-09-12T00:00:00.000Z',
              },
            ],
          };
        }
        return { rows: [] };
      },
      release() {},
    }),
    query: async () => ({ rows: [] }),
  };

  let server;
  let url;

  before(async () => {
    const app = createApp({
      pool,
      verify: () => ({
        tenantId: TENANT,
        userId: USER,
        role: 'admin',
        email: 'staff@example.com',
        projectId: null,
        impersonatorUserId: null,
        clientIp: '127.0.0.1',
      }),
      allowedOrigins: ['https://api.symlavault.com'],
    });
    server = http.createServer(app);
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    url = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    await new Promise((r) => server.close(r));
  });

  it('same-apex hub Origin via X-Forwarded-Host returns 201 and ACAO', async () => {
    const res = await fetch(`${url}/api/v1/quotes/inventory/skus`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://hub.example.com',
        'X-Forwarded-Host': 'api.example.com',
      },
      body: JSON.stringify({ name: 'SM58', daily_rate: 25 }),
    });
    assert.equal(res.status, 201);
    assert.equal(res.headers.get('access-control-allow-origin'), 'https://hub.example.com');
  });

  it('foreign Origin does not 500', async () => {
    const res = await fetch(`${url}/api/v1/quotes/inventory/skus`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://evil.example.net',
        'X-Forwarded-Host': 'api.example.com',
      },
      body: JSON.stringify({ name: 'SM58', daily_rate: 25 }),
    });
    assert.notEqual(res.status, 500);
    assert.notEqual(res.headers.get('access-control-allow-origin'), 'https://evil.example.net');
  });
});
