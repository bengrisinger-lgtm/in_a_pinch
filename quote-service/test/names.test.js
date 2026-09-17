import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { joinDisplayName, splitDisplayName } from '../src/names.js';

describe('names', () => {
  it('splits and joins display names', () => {
    assert.deepEqual(splitDisplayName('Ada Lovelace'), {
      first_name: 'Ada',
      last_name: 'Lovelace',
    });
    assert.equal(joinDisplayName('Ada', 'Lovelace'), 'Ada Lovelace');
  });
});
