import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { bookingSummary, pushPaidBooking } from '../src/calendar.js';

describe('calendar push helpers', () => {
  it('does not put a vendor brand in the event title', () => {
    const title = bookingSummary({
      customer_name: 'Ada',
      event_type: 'Wedding',
      email: 'ada@example.com',
    });
    assert.match(title, /Ada/);
    assert.doesNotMatch(title, /Outlook|Google|Cal\.com/i);
  });

  it('posts a normalized booking to integrations-service and never throws', async () => {
    const posts = [];
    const result = await pushPaidBooking(
      {
        integrationsServiceUrl: 'https://integrations.example.run.app',
        timeZone: 'America/Denver',
        fetchImpl: async (url, opts) => {
          posts.push({ url, opts });
          if (String(url).includes('identity')) return { ok: true, text: async () => 'oidc' };
          return {
            ok: true,
            json: async () => ({ pushed: true, provider: 'outlook', eventId: 'e1' }),
          };
        },
      },
      {
        tenantId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        projectId: '22222222-2222-2222-2222-222222222222',
        userId: '11111111-1111-1111-1111-111111111111',
        quote: {
          id: 'aaaaaaaa-0000-4000-8000-000000000099',
          starts_on: '2026-09-12',
          ends_on: '2026-09-13',
          customer_name: 'Ada',
          fulfillment: 'pickup',
        },
      }
    );
    assert.equal(result.pushed, true);
    const call = posts.find((p) => String(p.url).includes('/internal/calendar/events'));
    const body = JSON.parse(call.opts.body);
    assert.equal(body.booking.starts_on, '2026-09-12');
    assert.equal(body.booking.ends_on, '2026-09-13');
    assert.equal(body.project_id, '22222222-2222-2222-2222-222222222222');
    assert.doesNotMatch(call.opts.body, /COOKIE_SECRET|TOKEN_ENCRYPTION_KEY/);
  });

  it('returns pushed false when the calendar service is down', async () => {
    const result = await pushPaidBooking(
      {
        integrationsServiceUrl: 'https://integrations.example.run.app',
        fetchImpl: async () => {
          throw new Error('network');
        },
      },
      {
        tenantId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        quote: { id: 'aaaaaaaa-0000-4000-8000-000000000099', starts_on: '2026-09-12', ends_on: '2026-09-13' },
      }
    );
    assert.equal(result.pushed, false);
    assert.equal(result.reason, 'push_failed');
  });
});
