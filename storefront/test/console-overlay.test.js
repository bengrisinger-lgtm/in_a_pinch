import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const css = fs.readFileSync(path.join(root, 'console-overlay', 'iap-console.css'), 'utf8');
const build = fs.readFileSync(path.join(root, 'build-console-overlay.ps1'), 'utf8');

describe('IAP console overlay', () => {
  it('uses IAP tokens and is overlay-only', () => {
    assert.match(css, /--crab|#963630/);
    assert.match(css, /#e9632a|#fff8ee|#261c2b/);
    assert.match(css, /Do not copy into platform console-app/);
    assert.doesNotMatch(css, /#36013F|#106C6D/);
  });

  it('stamps same-origin hub links and IAP API/auth', () => {
    assert.match(build, /VITE_SHELL_LINKS/);
    assert.match(build, /\/#home/);
    assert.match(build, /\/#rentals/);
    assert.match(build, /\/#stock/);
    assert.match(build, /\/#orders/);
    assert.match(build, /\/console\/index\.html\?as=tenant/);
    assert.match(build, /api\.inapinchav\.com/);
    assert.match(build, /auth\.inapinchav\.com/);
    assert.match(build, /platform console-app restore/);
    assert.doesNotMatch(build, /app\.symlavault\.com|auth\.symlavault\.com/);
  });
});
