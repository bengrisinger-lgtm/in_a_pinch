import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const staffSource = readFileSync(join(__dirname, '..', 'src', 'staff.js'), 'utf8');
const routesSource = readFileSync(join(__dirname, '..', 'src', 'routes.js'), 'utf8');

describe('staff routes contract', () => {
  it('gates staff PII routes with staff middleware', () => {
    assert.match(routesSource, /router\.use\('\/staff', staffRoutes/);
    assert.match(staffSource, /router\.(get|post)\('\/hires', staff/);
    assert.match(staffSource, /router\.post\('\/onboarding\/complete', staff/);
  });

  it('stores custom fields in staff_profile_field_defs and profile extra', () => {
    assert.match(staffSource, /staff_profile_field_defs/);
    assert.match(staffSource, /extra/);
  });
});
