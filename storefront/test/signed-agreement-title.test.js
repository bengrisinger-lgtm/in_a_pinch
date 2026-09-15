import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { signedAgreementTitle } from '../src/lib/signedAgreementTitle.js';

describe('signedAgreementTitle', () => {
  it('uses LastName_FirstName - Signed Service Agreement', () => {
    assert.equal(signedAgreementTitle('Ben Grisinger'), 'Grisinger_Ben - Signed Service Agreement');
    assert.equal(
      signedAgreementTitle('Jane Mary Smith'),
      'Smith_Jane - Signed Service Agreement'
    );
  });

  it('handles a single name and empty input', () => {
    assert.equal(signedAgreementTitle('Prince'), 'Prince - Signed Service Agreement');
    assert.equal(signedAgreementTitle('  '), 'Signed Service Agreement');
  });
});
