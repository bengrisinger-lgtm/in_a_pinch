import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pickStandardRentalTemplate } from '../src/lib/standardRentalTemplate.js';

function readyTpl(name) {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    name,
    signer_roles: [
      { role_label: 'Customer', recipient_role: 'signer' },
      { role_label: 'Staff', recipient_role: 'signer' },
    ],
    blocks: [
      { role_label: 'Customer', type: 'signature', page: 1, x: 10, y: 10, width: 120, height: 24 },
      { role_label: 'Staff', type: 'signature', page: 1, x: 10, y: 80, width: 120, height: 24 },
    ],
  };
}

describe('pickStandardRentalTemplate', () => {
  it('picks Standard Rental Agreement when it is ready', () => {
    const standard = { ...readyTpl('Standard Rental Agreement'), id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' };
    const other = { ...readyTpl('Weekend addendum'), id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' };
    const pick = pickStandardRentalTemplate([other, standard]);
    assert.equal(pick?.id, standard.id);
  });

  it('returns null when Standard is missing or not ready', () => {
    const other = readyTpl('Weekend addendum');
    assert.equal(pickStandardRentalTemplate([other]), null);
    const unready = {
      ...readyTpl('Standard Rental Agreement'),
      blocks: [],
    };
    assert.equal(pickStandardRentalTemplate([unready]), null);
  });
});
