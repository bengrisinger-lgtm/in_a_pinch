import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../src/app.js';
import {
  reservationBlockingClause,
  schemaNameFromTenantId,
  skuCatalogSelectProjection,
} from '../src/schema.js';

const TENANT = '987bcdaf-320d-46bf-bfb3-4bdcdffe1de1';
const SCHEMA = schemaNameFromTenantId(TENANT);

function mockPool({ reservationColumns, skuColumns }) {
  const resCols = new Set(reservationColumns);
  const skuCols = new Set(skuColumns);
  async function handleQuery(sql, params) {
    const s = String(sql);
    if (s.includes('information_schema.columns')) {
      const table = params[1];
      const col = params[2];
      if (table === 'inventory_reservations' && resCols.has(col)) {
        return { rows: [{ '1': 1 }] };
      }
      if (table === 'inventory_skus' && skuCols.has(col)) {
        return { rows: [{ '1': 1 }] };
      }
      return { rows: [] };
    }
    if (s.includes('FROM') && s.includes('.inventory_skus s') && s.includes('ORDER BY s.name')) {
      return {
        rows: [
          {
            id: 's0000000-0000-0000-0000-000000000001',
            name: 'SM58',
            category: 'Mics',
            description: null,
            image_url: null,
            daily_rate: 25,
            active: true,
            created_at: '2026-09-11T00:00:00.000Z',
            units_total: 1,
          },
        ],
      };
    }
    if (s.includes('inventory_reservations r') && s.includes('GROUP BY u.sku_id')) {
      return { rows: [] };
    }
    if (
      s.startsWith('BEGIN') ||
      s.startsWith('COMMIT') ||
      s.startsWith('ROLLBACK') ||
      s.startsWith('SELECT set_config')
    ) {
      return { rows: [] };
    }
    return { rows: [] };
  }
  return {
    query: handleQuery,
    async connect() {
      return { query: handleQuery, release() {} };
    },
  };
}

describe('§1 catalog shims (pre-owner-migrate schema)', () => {
  it('reservationBlockingClause omits held_until when column missing', async () => {
    const pool = mockPool({
      reservationColumns: ['status'],
      skuColumns: ['description', 'image_url'],
    });
    const clause = await reservationBlockingClause(pool, SCHEMA);
    assert.doesNotMatch(clause, /held_until/);
    assert.match(clause, /r\.status = 'held'/);
  });

  it('skuCatalogSelectProjection uses NULL aliases for missing sku columns', async () => {
    const pool = mockPool({
      reservationColumns: ['status', 'held_until'],
      skuColumns: [],
    });
    const proj = await skuCatalogSelectProjection(pool, SCHEMA);
    assert.match(proj, /NULL::text AS description/);
    assert.match(proj, /NULL::text AS image_url/);
  });

  it('GET /inventory/skus?starts_on&ends_on does not 500 without held_until column', async () => {
    const pool = mockPool({
      reservationColumns: ['status'],
      skuColumns: [],
    });
    const app = createApp({
      pool,
      verify: () => ({ tenantId: TENANT, userId: null, role: 'guest', sessionId: 'guest' }),
      allowedOrigins: ['https://inapinchav.com'],
    });
    const server = http.createServer(app);
    await new Promise((r) => server.listen(0, r));
    const { port } = server.address();
    try {
      const res = await fetch(
        `http://127.0.0.1:${port}/api/v1/quotes/inventory/skus?starts_on=2026-09-24&ends_on=2026-09-24`
      );
      const text = await res.text();
      assert.equal(res.status, 200, text);
      const body = JSON.parse(text);
      assert.equal(body.skus.length, 1);
      assert.equal(body.starts_on, '2026-09-24');
    } finally {
      await new Promise((r) => server.close(r));
    }
  });
});
