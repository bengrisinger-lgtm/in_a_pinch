/**
 * Staff mark-paid (and later Square webhooks). Confirms attached holds.
 * Calendar copy runs after this commit (playbook 11b). Do not un-pay
 * if that push fails.
 */

export async function applyPaidQuote(client, { schema, tenantId, quoteId, amount, method, externalId, recordedBy }) {
  const quote = await client.query(
    `SELECT id, status, total
       FROM ${schema}.quotes
      WHERE id = $1 AND tenant_id = $2
      FOR UPDATE`,
    [quoteId, tenantId]
  );
  if (!quote.rows[0]) {
    const err = new Error('Quote not found');
    err.status = 404;
    throw err;
  }

  if (quote.rows[0].status === 'paid') {
    const existing = await client.query(
      `SELECT id, amount, status, method, external_id, created_at
         FROM ${schema}.payments
        WHERE quote_id = $1 AND tenant_id = $2 AND status = 'paid'
        ORDER BY created_at DESC
        LIMIT 1`,
      [quoteId, tenantId]
    );
    return { quote: quote.rows[0], payment: existing.rows[0] || null, alreadyPaid: true };
  }

  const holds = await client.query(
    `SELECT id, status, held_until
       FROM ${schema}.inventory_reservations
      WHERE tenant_id = $1 AND quote_id = $2
      FOR UPDATE`,
    [tenantId, quoteId]
  );

  const now = Date.now();
  for (const row of holds.rows) {
    if (row.status === 'cancelled') {
      const err = new Error('A hold on this quote was cancelled');
      err.status = 409;
      throw err;
    }
    if (row.status === 'held') {
      if (!row.held_until || Date.parse(row.held_until) <= now) {
        const err = new Error('A hold is expired — re-hold serials before marking paid');
        err.status = 409;
        throw err;
      }
    }
  }

  if (holds.rows.some((row) => row.status === 'held')) {
    await client.query(
      `UPDATE ${schema}.inventory_reservations
          SET status = 'confirmed', held_until = NULL
        WHERE tenant_id = $1
          AND quote_id = $2
          AND status = 'held'
          AND held_until > now()`,
      [tenantId, quoteId]
    );
  }

  const pay = await client.query(
    `INSERT INTO ${schema}.payments
       (tenant_id, quote_id, amount, status, method, external_id, recorded_by)
     VALUES ($1,$2,$3,'paid',$4,$5,$6)
     RETURNING id, amount, status, method, external_id, created_at`,
    [tenantId, quoteId, amount, method, externalId, recordedBy]
  );

  await client.query(
    `UPDATE ${schema}.quotes
        SET status = 'paid', updated_at = now()
      WHERE id = $1 AND tenant_id = $2`,
    [quoteId, tenantId]
  );

  return { quote: { ...quote.rows[0], status: 'paid' }, payment: pay.rows[0], alreadyPaid: false };
}

/** Release holds and mark the quote refunded after a paid cancel. */
export async function applyRefundedQuote(client, { schema, tenantId, quoteId, amount, method, externalId, recordedBy }) {
  await client.query(
    `UPDATE ${schema}.inventory_reservations
        SET status = 'cancelled'
      WHERE tenant_id = $1 AND quote_id = $2 AND status IN ('held', 'confirmed')`,
    [tenantId, quoteId]
  );
  const pay = await client.query(
    `INSERT INTO ${schema}.payments
       (tenant_id, quote_id, amount, status, method, external_id, recorded_by)
     VALUES ($1,$2,$3,'refunded',$4,$5,$6)
     RETURNING id, amount, status, method, external_id, created_at`,
    [tenantId, quoteId, amount, method, externalId, recordedBy]
  );
  await client.query(
    `UPDATE ${schema}.quotes
        SET status = 'refunded', updated_at = now()
      WHERE id = $1 AND tenant_id = $2`,
    [quoteId, tenantId]
  );
  return { quote: { id: quoteId, status: 'refunded' }, payment: pay.rows[0] };
}
