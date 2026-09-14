/**
 * Identity is gateway HMAC only. Never Host, body, or query.
 * Guests have a tenant session (role guest) without a vault user.
 */

const STAFF_BLOCKED_ROLES = new Set(['guest', 'app_user']);

export function isStaffIdentity(identity) {
  if (!identity?.tenantId || !identity?.userId) return false;
  const role = String(identity.role || '').toLowerCase();
  return !STAFF_BLOCKED_ROLES.has(role);
}

export function actorUserId(req) {
  if (!isStaffIdentity(req?.identity)) return null;
  const id = req.identity.userId;
  if (typeof id !== 'string' || !id.trim()) return null;
  return id;
}

export function requireTenant({ verify, expectedTenantId } = {}) {
  if (typeof verify !== 'function') {
    throw new Error('requireTenant needs verify(req) from createServerClient().auth.verifyGatewayHmac');
  }
  return function tenantGate(req, res, next) {
    const identity = verify(req);
    if (!identity?.tenantId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    if (expectedTenantId && identity.tenantId !== expectedTenantId) {
      return res.status(403).json({ error: 'Wrong tenant for this service' });
    }
    req.identity = identity;
    next();
  };
}

export function requireStaff({ verify, expectedTenantId } = {}) {
  if (typeof verify !== 'function') {
    throw new Error('requireStaff needs verify(req) from createServerClient().auth.verifyGatewayHmac');
  }
  return function staffGate(req, res, next) {
    const identity = req.identity || verify(req);
    if (!identity?.tenantId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    if (expectedTenantId && identity.tenantId !== expectedTenantId) {
      return res.status(403).json({ error: 'Wrong tenant for this service' });
    }
    if (!isStaffIdentity(identity)) {
      return res.status(401).json({ error: 'Staff session required' });
    }
    req.identity = identity;
    next();
  };
}
