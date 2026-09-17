/**
 * Staff PII — tenant schema, staff-session only (FORCE RLS).
 * Custom profile fields via staff_profile_field_defs + JSONB extras.
 */

import { Router } from 'express';
import { ensureQuoteTables } from './schema.js';
import { wrapWithTenant } from './pool.js';
import { actorUserId } from './auth.js';
import { normalizeEmail } from './names.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TEXT_MAX = 2000;
const NAME_MAX = 120;
const EMAIL_MAX = 254;
const PHONE_MAX = 40;
const KEY_MAX = 64;

const PRONOUNS = new Set(['he/him', 'she/her', 'they/them', 'he/they', 'she/they']);
const FIELD_TYPES = new Set(['text', 'date']);

function hmacTenantId(req) {
  return req.identity?.tenantId || null;
}

function clip(raw, max) {
  if (raw == null) return null;
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s) return null;
  return s.slice(0, max);
}

function fieldKey(raw) {
  const s = clip(raw, KEY_MAX);
  if (!s) return null;
  if (!/^[a-z][a-z0-9_]*$/.test(s)) return null;
  return s;
}

export function staffRoutes(ctx) {
  const router = Router();
  const pool = ctx.pool;
  const staff = ctx.staff;

  async function scoped(req) {
    const tenantId = hmacTenantId(req);
    const { schema } = await ensureQuoteTables(pool, tenantId);
    return { tenantId, schema, db: wrapWithTenant(pool, tenantId) };
  }

  router.get('/field-defs', staff, async (req, res) => {
    try {
      const { schema, db } = await scoped(req);
      const { rows } = await db.query(
        `SELECT id, field_key, label, field_type, sort_order, created_at
           FROM ${schema}.staff_profile_field_defs
          ORDER BY sort_order ASC, label ASC`
      );
      res.json({ fields: rows });
    } catch (err) {
      req.log?.error?.({ err }, 'staff field defs list failed');
      res.status(500).json({ error: 'Failed to list profile fields' });
    }
  });

  router.post('/field-defs', staff, async (req, res) => {
    const tenantId = hmacTenantId(req);
    const key = fieldKey(req.body?.field_key);
    const label = clip(req.body?.label, NAME_MAX);
    const fieldType = clip(req.body?.field_type, 16) || 'text';
    if (!key || !label) {
      return res.status(400).json({ error: 'field_key and label are required' });
    }
    if (!FIELD_TYPES.has(fieldType)) {
      return res.status(400).json({ error: 'field_type must be text or date' });
    }
    try {
      const { schema, db } = await scoped(req);
      const { rows } = await db.query(
        `INSERT INTO ${schema}.staff_profile_field_defs
           (tenant_id, field_key, label, field_type, sort_order, created_by)
         VALUES ($1, $2, $3, $4, COALESCE($5::int, 100), $6)
         RETURNING id, field_key, label, field_type, sort_order, created_at`,
        [tenantId, key, label, fieldType, req.body?.sort_order, actorUserId(req)]
      );
      res.status(201).json({ field: rows[0] });
    } catch (err) {
      if (err?.code === '23505') {
        return res.status(409).json({ error: 'field_key already exists' });
      }
      req.log?.error?.({ err }, 'staff field def create failed');
      res.status(500).json({ error: 'Failed to add profile field' });
    }
  });

  router.get('/hires', staff, async (req, res) => {
    try {
      const { schema, db } = await scoped(req);
      const { rows } = await db.query(
        `SELECT id, email, first_name, last_name, phone, user_id,
                onboarding_completed_at, created_at
           FROM ${schema}.staff_members
          ORDER BY created_at DESC
          LIMIT 200`
      );
      res.json({ hires: rows });
    } catch (err) {
      req.log?.error?.({ err }, 'staff hires list failed');
      res.status(500).json({ error: 'Failed to list staff hires' });
    }
  });

  router.post('/hires', staff, async (req, res) => {
    const tenantId = hmacTenantId(req);
    const first = clip(req.body?.first_name, NAME_MAX);
    const last = clip(req.body?.last_name, NAME_MAX);
    const email = clip(req.body?.email, EMAIL_MAX);
    const phone = clip(req.body?.phone, PHONE_MAX);
    if (!first || !last || !email || !EMAIL_RE.test(email)) {
      return res.status(400).json({ error: 'first_name, last_name, and email are required' });
    }
    try {
      const { schema, db } = await scoped(req);
      const normalized = normalizeEmail(email);
      const existing = await db.query(
        `SELECT id FROM ${schema}.staff_members WHERE tenant_id = $1 AND lower(email) = $2 LIMIT 1`,
        [tenantId, normalized]
      );
      let rows;
      if (existing.rows[0]) {
        rows = (
          await db.query(
            `UPDATE ${schema}.staff_members
                SET first_name = $3, last_name = $4, phone = COALESCE($5, phone), updated_at = now()
              WHERE id = $1 AND tenant_id = $2
            RETURNING id, email, first_name, last_name, phone, user_id, onboarding_completed_at, created_at`,
            [existing.rows[0].id, tenantId, first, last, phone]
          )
        ).rows;
      } else {
        rows = (
          await db.query(
            `INSERT INTO ${schema}.staff_members
               (tenant_id, email, first_name, last_name, phone, created_by)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING id, email, first_name, last_name, phone, user_id, onboarding_completed_at, created_at`,
            [tenantId, normalized, first, last, phone, actorUserId(req)]
          )
        ).rows;
      }
      res.status(201).json({
        hire: rows[0],
        next_step:
          'Send a staff invite from the tenant console (Projects → Invite staff) to this email. They must open the invite link, then complete onboarding here on first hub sign-in.',
      });
    } catch (err) {
      req.log?.error?.({ err }, 'staff hire create failed');
      res.status(500).json({ error: 'Failed to save new hire' });
    }
  });

  router.post('/onboarding/claim', staff, async (req, res) => {
    const userId = actorUserId(req);
    const email = normalizeEmail(req.body?.email);
    if (!userId || !email || !EMAIL_RE.test(email)) {
      return res.status(400).json({ error: 'email is required' });
    }
    try {
      const { tenantId, schema, db } = await scoped(req);
      const { rows } = await db.query(
        `UPDATE ${schema}.staff_members
            SET user_id = $3, updated_at = now()
          WHERE tenant_id = $1
            AND lower(email) = $2
            AND (user_id IS NULL OR user_id = $3)
         RETURNING id, email, first_name, last_name, onboarding_completed_at`,
        [tenantId, email, userId]
      );
      if (!rows[0]) {
        return res.status(404).json({
          error: 'No pending hire for that email. Ask an owner to add you under New hire first.',
        });
      }
      res.json({ hire: rows[0] });
    } catch (err) {
      req.log?.error?.({ err }, 'onboarding claim failed');
      res.status(500).json({ error: 'Failed to link hire record' });
    }
  });

  router.get('/onboarding/status', staff, async (req, res) => {
    const userId = actorUserId(req);
    try {
      const { tenantId, schema, db } = await scoped(req);
      const { rows: customFieldDefs } = await db.query(
        `SELECT field_key, label, field_type, sort_order
           FROM ${schema}.staff_profile_field_defs
          ORDER BY sort_order ASC, label ASC`
      );
      let member = null;
      if (userId) {
        const byUser = await db.query(
          `SELECT * FROM ${schema}.staff_members WHERE tenant_id = $1 AND user_id = $2 LIMIT 1`,
          [tenantId, userId]
        );
        member = byUser.rows[0] || null;
      }
      const required = Boolean(member && !member.onboarding_completed_at);
      let profile = null;
      if (member) {
        const prof = await db.query(
          `SELECT * FROM ${schema}.staff_profiles WHERE staff_member_id = $1 LIMIT 1`,
          [member.id]
        );
        profile = prof.rows[0] || null;
      }
      res.json({
        required,
        hire: member
          ? {
              id: member.id,
              email: member.email,
              first_name: member.first_name,
              last_name: member.last_name,
              phone: member.phone,
            }
          : null,
        profile,
        customFields: customFieldDefs,
      });
    } catch (err) {
      req.log?.error?.({ err }, 'onboarding status failed');
      res.status(500).json({ error: 'Failed to load onboarding status' });
    }
  });

  router.post('/onboarding/complete', staff, async (req, res) => {
    const userId = actorUserId(req);
    if (!userId) return res.status(401).json({ error: 'Staff session required' });
    const claimEmail = normalizeEmail(req.body?.email);
    const homeAddress = clip(req.body?.home_address, TEXT_MAX);
    const pronouns = clip(req.body?.preferred_pronouns, 32);
    const ecFirst = clip(req.body?.emergency_contact_first_name, NAME_MAX);
    const ecLast = clip(req.body?.emergency_contact_last_name, NAME_MAX);
    const ecRel = clip(req.body?.emergency_contact_relationship, NAME_MAX);
    const first = clip(req.body?.first_name, NAME_MAX);
    const last = clip(req.body?.last_name, NAME_MAX);
    const phone = clip(req.body?.phone, PHONE_MAX);
    if (!first || !last || !homeAddress || !phone) {
      return res.status(400).json({
        error: 'first_name, last_name, home_address, and phone are required',
      });
    }
    if (!ecFirst || !ecLast || !ecRel) {
      return res.status(400).json({ error: 'Emergency contact name and relationship are required' });
    }
    if (pronouns && !PRONOUNS.has(pronouns)) {
      return res.status(400).json({ error: 'preferred_pronouns is not an allowed value' });
    }
    const extrasRaw = req.body?.extra;
    const extras =
      extrasRaw && typeof extrasRaw === 'object' && !Array.isArray(extrasRaw) ? extrasRaw : {};

    try {
      const { tenantId, schema, db } = await scoped(req);
      let member = null;
      const byUser = await db.query(
        `SELECT * FROM ${schema}.staff_members WHERE tenant_id = $1 AND user_id = $2 LIMIT 1`,
        [tenantId, userId]
      );
      member = byUser.rows[0];
      if (!member && claimEmail) {
        const byEmail = await db.query(
          `SELECT * FROM ${schema}.staff_members
            WHERE tenant_id = $1 AND lower(email) = $2 AND user_id = $3 LIMIT 1`,
          [tenantId, claimEmail, userId]
        );
        member = byEmail.rows[0];
      }
      if (!member) {
        return res.status(403).json({
          error: 'No new-hire record for your account. Ask an owner to add you under Staff → New hire.',
        });
      }

      const { rows: defs } = await db.query(
        `SELECT field_key, field_type FROM ${schema}.staff_profile_field_defs`
      );
      const cleanedExtra = {};
      for (const def of defs.rows) {
        const val = extras[def.field_key];
        if (val == null || val === '') continue;
        if (typeof val !== 'string') {
          return res.status(400).json({ error: `extra.${def.field_key} must be a string` });
        }
        cleanedExtra[def.field_key] = val.trim().slice(0, TEXT_MAX);
      }

      await db.query(
        `INSERT INTO ${schema}.staff_profiles
           (tenant_id, staff_member_id, home_address, preferred_pronouns,
            emergency_contact_first_name, emergency_contact_last_name,
            emergency_contact_relationship, extra)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
         ON CONFLICT (staff_member_id)
         DO UPDATE SET
           home_address = EXCLUDED.home_address,
           preferred_pronouns = EXCLUDED.preferred_pronouns,
           emergency_contact_first_name = EXCLUDED.emergency_contact_first_name,
           emergency_contact_last_name = EXCLUDED.emergency_contact_last_name,
           emergency_contact_relationship = EXCLUDED.emergency_contact_relationship,
           extra = EXCLUDED.extra,
           updated_at = now()`,
        [
          tenantId,
          member.id,
          homeAddress,
          pronouns,
          ecFirst,
          ecLast,
          ecRel,
          JSON.stringify(cleanedExtra),
        ]
      );

      await db.query(
        `UPDATE ${schema}.staff_members
            SET user_id = COALESCE(user_id, $3),
                first_name = $4,
                last_name = $5,
                phone = $6,
                onboarding_completed_at = now(),
                updated_at = now()
          WHERE id = $1 AND tenant_id = $2`,
        [member.id, tenantId, userId, first, last, phone]
      );

      res.json({ success: true });
    } catch (err) {
      req.log?.error?.({ err }, 'onboarding complete failed');
      res.status(500).json({ error: 'Failed to save onboarding' });
    }
  });

  return router;
}
