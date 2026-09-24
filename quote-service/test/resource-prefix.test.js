import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { resolveResourcePrefix } from '../src/resourcePrefix.js';

describe('resolveResourcePrefix', () => {
  const env = { ...process.env };

  beforeEach(() => {
    delete process.env.RESOURCE_PREFIX;
    delete process.env.DB_USER;
  });

  afterEach(() => {
    process.env = { ...env };
  });

  it('prefers RESOURCE_PREFIX', () => {
    process.env.RESOURCE_PREFIX = 'backend';
    assert.equal(resolveResourcePrefix(), 'backend');
  });

  it('derives from DB_USER when RESOURCE_PREFIX is unset', () => {
    process.env.DB_USER = 'backend_app_runtime';
    assert.equal(resolveResourcePrefix(), 'backend');
  });
});
