import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renterHasSigned } from '../src/lib/envelopeSigning.js';

describe('renterHasSigned', () => {
  it('starts the 24h window when Customer signed, even if Staff has not', () => {
    const detail = {
      envelope: { status: 'partially_signed' },
      signers: [
        { role_label: 'Customer', recipient_role: 'signer', status: 'signed', email: 'a@b.c' },
        { role_label: 'Staff', recipient_role: 'signer', status: 'pending', email: 's@b.c' },
      ],
      blocks: [],
    };
    assert.equal(renterHasSigned(detail), true);
  });

  it('does not trigger when only staff signed', () => {
    const detail = {
      envelope: { status: 'partially_signed' },
      signers: [
        { role_label: 'Customer', recipient_role: 'signer', status: 'pending', email: 'a@b.c' },
        { role_label: 'Staff', recipient_role: 'signer', status: 'signed', email: 's@b.c' },
      ],
      blocks: [],
    };
    assert.equal(renterHasSigned(detail), false);
  });
});
