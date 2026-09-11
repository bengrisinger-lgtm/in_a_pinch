/**
 * Staff identity is gateway HMAC only. Never Host, body, or query.
 */

export function requireStaff({ verify, expectedTenantId } = {}) {
  if (typeof verify !== 'function') {
    throw new Error('requireStaff needs verify(req) from createServerClient().auth.verifyGatewayHmac');
  }
  return function staffGate(req, res, next) {
    const identity = verify(req);
    if (!identity?.tenantId || !identity?.userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    if (expectedTenantId && identity.tenantId !== expectedTenantId) {
      return res.status(403).json({ error: 'Wrong tenant for this service' });
    }
    req.identity = identity;
    next();
  };
}
