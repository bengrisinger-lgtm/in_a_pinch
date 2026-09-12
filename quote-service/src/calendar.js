/**
 * One-way copy of a paid IAP booking onto the tenant's connected calendar.
 * Tokens stay in integrations-service. This spoke mints OIDC only —
 * never COOKIE_SECRET or TOKEN_ENCRYPTION_KEY.
 *
 * Failure must not un-pay. IAP serial calendar stays source of truth.
 */

async function mintIdentityToken(audience, fetchImpl) {
  const meta =
    'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity' +
    `?audience=${encodeURIComponent(audience)}`;
  const res = await fetchImpl(meta, { headers: { 'Metadata-Flavor': 'Google' } });
  if (!res.ok) {
    throw new Error('Could not mint service identity token');
  }
  return res.text();
}

export function bookingSummary(quote) {
  const who = quote.customer_name || quote.email || 'renter';
  const kind = quote.event_type ? ` (${quote.event_type})` : '';
  return `Rental — ${who}${kind}`;
}

export function bookingDescription(quote) {
  const lines = [
    quote.quote_id ? `Quote ${quote.quote_id}` : null,
    quote.fulfillment ? `Fulfillment: ${quote.fulfillment}` : null,
    quote.notes || null,
  ].filter(Boolean);
  return lines.join('\n');
}

export async function pushPaidBooking(
  {
    integrationsServiceUrl,
    calendarUserId,
    calendarProjectId,
    timeZone = 'UTC',
    fetchImpl = fetch,
    mintToken = mintIdentityToken,
  },
  { tenantId, projectId, userId, quote }
) {
  const base = String(integrationsServiceUrl || '').replace(/\/$/, '');
  if (!base) {
    return { pushed: false, reason: 'not_configured' };
  }
  if (!quote?.starts_on || !quote?.ends_on) {
    return { pushed: false, reason: 'dates_missing' };
  }

  try {
    const token = await mintToken(base, fetchImpl);
    const res = await fetchImpl(`${base}/internal/calendar/events`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        tenant_id: tenantId,
        project_id: calendarProjectId || projectId || undefined,
        user_id: calendarUserId || userId || quote.created_by || undefined,
        event_id: quote.calendar_event_id || undefined,
        time_zone: timeZone,
        booking: {
          summary: bookingSummary(quote),
          description: bookingDescription({ ...quote, quote_id: quote.id }),
          location: quote.delivery_address || (quote.fulfillment === 'pickup' ? 'Pickup' : ''),
          starts_on: String(quote.starts_on).slice(0, 10),
          ends_on: String(quote.ends_on).slice(0, 10),
          quote_id: quote.id,
        },
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (body && body.pushed === true && body.eventId) {
      return {
        pushed: true,
        provider: body.provider,
        eventId: body.eventId,
        htmlLink: body.htmlLink || body.webLink || null,
      };
    }
    return {
      pushed: false,
      reason: body.reason || `http_${res.status}`,
    };
  } catch {
    return { pushed: false, reason: 'push_failed' };
  }
}

export function createCalendarRuntime(opts = {}) {
  return {
    pushPaidBooking(input) {
      return pushPaidBooking(opts, input);
    },
  };
}
