import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyIapSignerRoles,
  staffDisplayName,
  templateIsReadyForCheckout,
  whyTemplateNotReady,
  TEMPLATE_NEEDS_TWO_SIGNER_ROLES,
  TEMPLATE_NEEDS_SIGNATURE_BLOCK,
  TEMPLATE_HAS_SENDER_FILL,
} from '../src/lib/templateRoles.js';

function tpl(roles, blocks) {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    signer_roles: roles,
    blocks,
  };
}

const customerSig = {
  role_label: 'Customer',
  type: 'signature',
  page: 1,
  x: 10,
  y: 10,
  width: 120,
  height: 24,
};
const staffSig = {
  role_label: 'Staff',
  type: 'signature',
  page: 1,
  x: 10,
  y: 80,
  width: 120,
  height: 24,
};

describe('classifyIapSignerRoles', () => {
  it('maps Customer + Staff', () => {
    const pair = classifyIapSignerRoles(
      tpl(
        [
          { role_label: 'Customer', recipient_role: 'signer' },
          { role_label: 'Staff', recipient_role: 'signer' },
        ],
        []
      )
    );
    assert.deepEqual(pair, { customer: 'Customer', staff: 'Staff' });
  });

  it('maps Renter + Employee regardless of order', () => {
    const pair = classifyIapSignerRoles(
      tpl(
        [
          { role_label: 'Employee', recipient_role: 'signer' },
          { role_label: 'Renter', recipient_role: 'signer' },
        ],
        []
      )
    );
    assert.deepEqual(pair, { customer: 'Renter', staff: 'Employee' });
  });

  it('rejects a single role and unlabeled pairs', () => {
    assert.equal(
      classifyIapSignerRoles(tpl([{ role_label: 'Signer', recipient_role: 'signer' }], [])),
      null
    );
    assert.equal(
      classifyIapSignerRoles(
        tpl(
          [
            { role_label: 'Signer', recipient_role: 'signer' },
            { role_label: 'Co-signer', recipient_role: 'signer' },
          ],
          []
        )
      ),
      null
    );
  });
});

describe('whyTemplateNotReady', () => {
  it('is ready when both roles have signature blocks', () => {
    const t = tpl(
      [
        { role_label: 'Customer', recipient_role: 'signer' },
        { role_label: 'Staff', recipient_role: 'signer' },
      ],
      [customerSig, staffSig]
    );
    assert.equal(whyTemplateNotReady(t), null);
    assert.equal(templateIsReadyForCheckout(t), true);
  });

  it('fails closed on one role, missing staff signature, or sender-fill', () => {
    assert.equal(
      whyTemplateNotReady(
        tpl([{ role_label: 'Customer', recipient_role: 'signer' }], [customerSig])
      ),
      TEMPLATE_NEEDS_TWO_SIGNER_ROLES
    );
    assert.equal(
      whyTemplateNotReady(
        tpl(
          [
            { role_label: 'Customer', recipient_role: 'signer' },
            { role_label: 'Staff', recipient_role: 'signer' },
          ],
          [customerSig]
        )
      ),
      TEMPLATE_NEEDS_SIGNATURE_BLOCK
    );
    assert.equal(
      whyTemplateNotReady(
        tpl(
          [
            { role_label: 'Customer', recipient_role: 'signer' },
            { role_label: 'Staff', recipient_role: 'signer' },
          ],
          [customerSig, staffSig, { ...staffSig, type: 'sender_text', role_label: 'Staff' }]
        )
      ),
      TEMPLATE_HAS_SENDER_FILL
    );
  });
});

describe('staffDisplayName', () => {
  it('uses the email local-part', () => {
    assert.equal(staffDisplayName('cadel.owner@inapinchav.com'), 'cadel owner');
  });
});
