import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  dollarsToCents,
  parseSquareSecret,
  paymentLinkBody,
  createSquareRuntime,
} from '../src/square.js';

describe('square helpers', () => {
  it('converts dollars to integer cents', () => {
    assert.equal(dollarsToCents(66.4), 6640);
    assert.equal(dollarsToCents('12.50'), 1250);
    assert.equal(dollarsToCents(0), null);
    assert.equal(dollarsToCents(-1), null);
  });

  it('parses a raw token or JSON {access_token, location_id}', () => {
    assert.deepEqual(parseSquareSecret('sq0at-raw'), { accessToken: 'sq0at-raw', locationId: null });
    assert.deepEqual(parseSquareSecret('{"access_token":"sq0at-json","location_id":"L1"}'), {
      accessToken: 'sq0at-json',
      locationId: 'L1',
    });
    assert.equal(parseSquareSecret('{'), null);
    assert.equal(parseSquareSecret(''), null);
  });

  it('builds a Payment Link body with no PAN fields', () => {
    const body = paymentLinkBody({
      idempotencyKey: 'q1',
      locationId: 'LOC',
      name: 'Rental booking',
      amountCents: 1250,
      redirectUrl: 'https://hub.example.com/#rentals?quote=q1',
      buyerEmail: 'alex@example.com',
      paymentNote: 'q1',
    });
    const json = JSON.stringify(body);
    assert.equal(body.quick_pay.price_money.amount, 1250);
    assert.match(json, /square|payment_note|quick_pay/i);
    assert.doesNotMatch(json, /card_number|cvv|pan|1234 5678/i);
  });

  it('uses vaulted credential then Square locations + payment-links', async () => {
    const calls = [];
    const fetchImpl = async (url, opts = {}) => {
      calls.push({ url, method: opts.method || 'GET', body: opts.body || null });
      if (String(url).includes('metadata.google.internal')) {
        return { ok: true, text: async () => 'oidc-token' };
      }
      if (String(url).includes('/internal/tenant-credentials/')) {
        assert.match(opts.headers.Authorization, /Bearer oidc-token/);
        return {
          ok: true,
          status: 200,
          json: async () => ({ credential: 'sq0at-vault' }),
        };
      }
      if (String(url).includes('/v2/locations')) {
        return {
          ok: true,
          json: async () => ({ locations: [{ id: 'LOC1', status: 'ACTIVE' }] }),
        };
      }
      if (String(url).includes('/v2/online-checkout/payment-links')) {
        const sent = JSON.parse(opts.body);
        assert.equal(sent.quick_pay.location_id, 'LOC1');
        assert.equal(sent.quick_pay.price_money.amount, 5000);
        return {
          ok: true,
          json: async () => ({ payment_link: { id: 'plink', url: 'https://square.link/u/abc' } }),
        };
      }
      throw new Error(`unexpected fetch ${url}`);
    };

    const square = createSquareRuntime({
      consoleServiceUrl: 'https://console-service.example.run.app',
      fetchImpl,
    });
    const link = await square.createPaymentLink('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', {
      idempotencyKey: 'q1',
      name: 'Rental booking',
      amountCents: 5000,
    });
    assert.equal(link.url, 'https://square.link/u/abc');
    assert.ok(calls.some((c) => String(c.url).includes('/internal/tenant-credentials/')));
  });
});
