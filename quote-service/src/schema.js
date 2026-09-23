/**
 * Quote + serial inventory store for this tenant app.
 *
 * Tables live in t_<hmac-tenant-uuid-hex> on the shared Postgres.
 * Not console-service. Not public. Kit holds PDFs and envelopes;
 * this store keeps UUIDs only. Cart holds expire in HOLD_TTL_CART_MINUTES.
 */

const TENANT_SCHEMA_RE = /^t_[0-9a-f]{32}$/;

export function schemaNameFromTenantId(tenantId) {
  const hex = String(tenantId || '')
    .toLowerCase()
    .replace(/-/g, '');
  if (!/^[0-9a-f]{32}$/.test(hex)) {
    throw new Error('Invalid tenant id for app schema name');
  }
  return `t_${hex}`;
}

export function isTenantAppSchema(name) {
  return typeof name === 'string' && TENANT_SCHEMA_RE.test(name);
}

function qIdent(name) {
  if (typeof name !== 'string' || !/^[a-z_][a-z0-9_]*$/.test(name)) {
    throw new Error(`Invalid SQL identifier: ${JSON.stringify(name)}`);
  }
  return name;
}

const TABLES = [
  {
    name: 'customers',
    ddl: `
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL,
      user_id UUID,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT,
      billing_address TEXT,
      site_address TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    `,
  },
  {
    name: 'quotes',
    ddl: `
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL,
      customer_id UUID NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      notes TEXT,
      document_id UUID,
      envelope_id UUID,
      delivery_address TEXT,
      delivery_miles NUMERIC,
      drive_minutes NUMERIC,
      delivery_fee NUMERIC NOT NULL DEFAULT 0,
      fulfillment TEXT,
      event_type TEXT,
      starts_on DATE,
      ends_on DATE,
      load_in_time TIME,
      load_out_time TIME,
      subtotal NUMERIC NOT NULL DEFAULT 0,
      total NUMERIC NOT NULL DEFAULT 0,
      created_by UUID,
      calendar_event_id TEXT,
      calendar_provider TEXT,
      calendar_push_status TEXT,
      calendar_push_error TEXT,
      calendar_pushed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    `,
  },
  {
    name: 'quote_line_items',
    ddl: `
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL,
      quote_id UUID NOT NULL,
      description TEXT NOT NULL,
      quantity NUMERIC NOT NULL DEFAULT 1,
      unit_price NUMERIC NOT NULL DEFAULT 0,
      sort_order INT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    `,
  },
  {
    name: 'payments',
    ddl: `
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL,
      quote_id UUID NOT NULL,
      amount NUMERIC NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      method TEXT NOT NULL DEFAULT 'staff_recorded',
      external_id TEXT,
      recorded_by UUID,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    `,
  },
  {
    name: 'inventory_skus',
    ddl: `
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL,
      name TEXT NOT NULL,
      category TEXT,
      description TEXT,
      image_url TEXT,
      daily_rate NUMERIC NOT NULL DEFAULT 0,
      active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    `,
  },
  {
    name: 'inventory_units',
    ddl: `
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL,
      sku_id UUID NOT NULL,
      serial_number TEXT NOT NULL,
      stock_code TEXT,
      nickname TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (tenant_id, sku_id, serial_number)
    `,
  },
  {
    name: 'inventory_categories',
    ddl: `
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL,
      name TEXT NOT NULL,
      stock_prefix TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    `,
  },
  {
    name: 'inventory_stock_sequences',
    ddl: `
      tenant_id UUID NOT NULL,
      prefix TEXT NOT NULL,
      next_number INT NOT NULL DEFAULT 2,
      PRIMARY KEY (tenant_id, prefix)
    `,
  },
  {
    name: 'staff_members',
    ddl: `
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL,
      user_id UUID,
      email TEXT NOT NULL,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      phone TEXT,
      onboarding_completed_at TIMESTAMPTZ,
      created_by UUID,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    `,
  },
  {
    name: 'staff_profiles',
    ddl: `
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL,
      staff_member_id UUID NOT NULL UNIQUE,
      home_address TEXT,
      preferred_pronouns TEXT,
      emergency_contact_first_name TEXT,
      emergency_contact_last_name TEXT,
      emergency_contact_relationship TEXT,
      extra JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    `,
  },
  {
    name: 'staff_profile_field_defs',
    ddl: `
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL,
      field_key TEXT NOT NULL,
      label TEXT NOT NULL,
      field_type TEXT NOT NULL DEFAULT 'text',
      sort_order INT NOT NULL DEFAULT 100,
      created_by UUID,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    `,
  },
  {
    name: 'inventory_reservations',
    ddl: `
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL,
      unit_id UUID NOT NULL,
      sku_id UUID NOT NULL,
      quote_id UUID,
      starts_on DATE NOT NULL,
      ends_on DATE NOT NULL,
      load_in_time TIME,
      load_out_time TIME,
      status TEXT NOT NULL DEFAULT 'held',
      held_until TIMESTAMPTZ,
      created_by UUID,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      CHECK (ends_on >= starts_on)
    `,
  },
];

/** Cart hold. Confirmed (paid) bookings do not expire. */
export const HOLD_TTL_CART_MINUTES = 15;
/** After the agreement is sent (signing in progress). */
export const HOLD_TTL_SIGNING_MINUTES = 120;
/** After the renter/customer kit signer finished, still unpaid (staff may be pending). */
export const HOLD_TTL_UNPAID_SIGNED_MINUTES = 1440;
/** @deprecated use HOLD_TTL_CART_MINUTES — kept so old tests/imports fail loudly */
export const HOLD_TTL_HOURS = HOLD_TTL_CART_MINUTES / 60;

export async function expireStaleHolds(db, schema, tenantId) {
  await db.query(
    `UPDATE ${schema}.inventory_reservations
        SET status = 'cancelled'
      WHERE tenant_id = $1
        AND status = 'held'
        AND held_until IS NOT NULL
        AND held_until <= now()`,
    [tenantId]
  );
  await db.query(
    `UPDATE ${schema}.quotes
        SET status = 'cancelled', updated_at = now()
      WHERE tenant_id = $1
        AND status NOT IN ('paid', 'cancelled', 'refunded')
        AND id IN (
          SELECT quote_id FROM ${schema}.inventory_reservations
           WHERE tenant_id = $1 AND quote_id IS NOT NULL
           GROUP BY quote_id
          HAVING bool_and(status = 'cancelled')
        )`,
    [tenantId]
  );
}

export async function extendQuoteHolds(db, schema, tenantId, quoteId, minutes) {
  const mins = Number(minutes);
  if (!Number.isInteger(mins) || mins < 1) {
    throw new Error('hold minutes must be a positive integer');
  }
  const { rows } = await db.query(
    `UPDATE ${schema}.inventory_reservations
        SET held_until = now() + ($3::int * interval '1 minute')
      WHERE tenant_id = $1
        AND quote_id = $2
        AND status = 'held'
      RETURNING id, held_until`,
    [tenantId, quoteId, mins]
  );
  return rows;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Cart holds only (no quote yet). Restarts the 15-minute window. */
export async function extendCartHolds(db, schema, tenantId, holdIds, minutes = HOLD_TTL_CART_MINUTES) {
  const mins = Number(minutes);
  if (!Number.isInteger(mins) || mins < 1) {
    throw new Error('hold minutes must be a positive integer');
  }
  const ids = [...new Set((Array.isArray(holdIds) ? holdIds : []).filter((id) => UUID_RE.test(id)))];
  if (!ids.length) {
    const err = new Error('hold_ids are required');
    err.status = 400;
    throw err;
  }
  const { rows } = await db.query(
    `UPDATE ${schema}.inventory_reservations
        SET held_until = now() + ($3::int * interval '1 minute')
      WHERE tenant_id = $1
        AND id = ANY($2::uuid[])
        AND status = 'held'
        AND quote_id IS NULL
        AND held_until > now()
      RETURNING id, held_until`,
    [tenantId, ids, mins]
  );
  return { ids, rows };
}

async function forceRls(db, qualified, table) {
  await db.query(`ALTER TABLE ${qualified} ENABLE ROW LEVEL SECURITY`);
  await db.query(`ALTER TABLE ${qualified} FORCE ROW LEVEL SECURITY`);
  const policy = `tenant_isolation_${table}`;
  try {
    await db.query(`
      CREATE POLICY ${policy} ON ${qualified}
        FOR ALL
        USING (tenant_id = current_setting('app.tenant_id', true)::UUID)
        WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::UUID)
    `);
  } catch (err) {
    // Hot path runs ensureQuoteTables on every inventory request. Concurrent
    // callers must not DROP/CREATE policies — duplicate_object is OK.
    if (err.code !== '42710') throw err;
  }
}

/**
 * Create quote-store tables in the HMAC tenant's schema and FORCE RLS
 * immediately. Does not CREATE SCHEMA (platform ensureTenantSchema does).
 */
export async function ensureQuoteTables(db, tenantId) {
  const schema = qIdent(schemaNameFromTenantId(tenantId));
  for (const table of TABLES) {
    const name = qIdent(table.name);
    const qualified = `${schema}.${name}`;
    await db.query(`CREATE TABLE IF NOT EXISTS ${qualified} (${table.ddl})`);
    await forceRls(db, qualified, name);
  }
  // §1 RECURRING: shims on upgraded DBs before any code path references the column
  // (expireStaleHolds runs immediately after ensureQuoteTables on GET /inventory/skus).
  await db.query(
    `ALTER TABLE ${schema}.inventory_reservations ADD COLUMN IF NOT EXISTS quote_id UUID`
  );
  await db.query(
    `ALTER TABLE ${schema}.inventory_reservations ADD COLUMN IF NOT EXISTS load_in_time TIME`
  );
  await db.query(
    `ALTER TABLE ${schema}.inventory_reservations ADD COLUMN IF NOT EXISTS load_out_time TIME`
  );
  await db.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS inventory_categories_name_uidx
        ON ${schema}.inventory_categories (tenant_id, lower(name))`
  );
  await db.query(
    `ALTER TABLE ${schema}.inventory_skus
        ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`
  );
  await db.query(
    `ALTER TABLE ${schema}.inventory_skus ADD COLUMN IF NOT EXISTS image_url TEXT`
  );
  await db.query(
    `UPDATE ${schema}.inventory_skus
        SET category = 'Microphones', updated_at = now()
      WHERE category = 'Microphone'`
  );
  await db.query(
    `ALTER TABLE ${schema}.inventory_categories ADD COLUMN IF NOT EXISTS stock_prefix TEXT`
  );
  await db.query(
    `ALTER TABLE ${schema}.inventory_units ADD COLUMN IF NOT EXISTS stock_code TEXT`
  );
  await db.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS inventory_units_stock_code_uidx
        ON ${schema}.inventory_units (tenant_id, stock_code)
      WHERE stock_code IS NOT NULL`
  );
  await db.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS inventory_categories_stock_prefix_uidx
        ON ${schema}.inventory_categories (tenant_id, lower(stock_prefix))
      WHERE stock_prefix IS NOT NULL`
  );
  await db.query(
    `CREATE INDEX IF NOT EXISTS inventory_units_sku_idx ON ${schema}.inventory_units (sku_id)`
  );
  await db.query(
    `CREATE INDEX IF NOT EXISTS inventory_reservations_unit_idx ON ${schema}.inventory_reservations (unit_id, starts_on, ends_on)`
  );
  // Existing IAP schemas were created before checkout columns. ADD IF NOT
  // EXISTS is a no-op on a fresh CREATE TABLE that already has them.
  await db.query(`ALTER TABLE ${schema}.quotes ADD COLUMN IF NOT EXISTS fulfillment TEXT`);
  await db.query(`ALTER TABLE ${schema}.quotes ADD COLUMN IF NOT EXISTS event_type TEXT`);
  await db.query(`ALTER TABLE ${schema}.quotes ADD COLUMN IF NOT EXISTS starts_on DATE`);
  await db.query(`ALTER TABLE ${schema}.quotes ADD COLUMN IF NOT EXISTS ends_on DATE`);
  await db.query(`ALTER TABLE ${schema}.quotes ADD COLUMN IF NOT EXISTS load_in_time TIME`);
  await db.query(`ALTER TABLE ${schema}.quotes ADD COLUMN IF NOT EXISTS load_out_time TIME`);
  await db.query(`ALTER TABLE ${schema}.quotes ADD COLUMN IF NOT EXISTS calendar_event_id TEXT`);
  await db.query(`ALTER TABLE ${schema}.quotes ADD COLUMN IF NOT EXISTS calendar_provider TEXT`);
  await db.query(`ALTER TABLE ${schema}.quotes ADD COLUMN IF NOT EXISTS calendar_push_status TEXT`);
  await db.query(`ALTER TABLE ${schema}.quotes ADD COLUMN IF NOT EXISTS calendar_push_error TEXT`);
  await db.query(`ALTER TABLE ${schema}.quotes ADD COLUMN IF NOT EXISTS calendar_pushed_at TIMESTAMPTZ`);
  await db.query(`ALTER TABLE ${schema}.quotes ADD COLUMN IF NOT EXISTS customer_signing_token TEXT`);
  await db.query(`ALTER TABLE ${schema}.quotes ADD COLUMN IF NOT EXISTS staff_signing_token TEXT`);
  await db.query(`ALTER TABLE ${schema}.quotes ADD COLUMN IF NOT EXISTS payment_link_url TEXT`);
  await db.query(`ALTER TABLE ${schema}.quotes ADD COLUMN IF NOT EXISTS payment_link_id TEXT`);
  await db.query(`ALTER TABLE ${schema}.quotes ADD COLUMN IF NOT EXISTS square_order_id TEXT`);
  await db.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS customers_tenant_email_uidx
        ON ${schema}.customers (tenant_id, lower(email))`
  );
  await db.query(
    `ALTER TABLE ${schema}.customers ADD COLUMN IF NOT EXISTS first_name TEXT`
  );
  await db.query(
    `ALTER TABLE ${schema}.customers ADD COLUMN IF NOT EXISTS last_name TEXT`
  );
  await db.query(
    `UPDATE ${schema}.customers
        SET first_name = split_part(name, ' ', 1),
            last_name = nullif(trim(substring(name from position(' ' in name))), '')
      WHERE (first_name IS NULL OR first_name = '')
        AND name IS NOT NULL
        AND position(' ' in name) > 0`
  );
  await db.query(
    `UPDATE ${schema}.customers
        SET first_name = name, last_name = ''
      WHERE (first_name IS NULL OR first_name = '')
        AND name IS NOT NULL`
  );
  await db.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS staff_members_tenant_email_uidx
        ON ${schema}.staff_members (tenant_id, lower(email))`
  );
  await db.query(
    `CREATE UNIQUE INDEX IF NOT EXISTS staff_profile_field_defs_key_uidx
        ON ${schema}.staff_profile_field_defs (tenant_id, field_key)`
  );
  return { schema, tables: TABLES.map((t) => t.name) };
}

export { TABLES };
