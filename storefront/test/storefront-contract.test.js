import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir, acc = []) {
  for (const name of fs.readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue;
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) walk(p, acc);
    else if (/\.(ts|tsx|js|css|html)$/.test(name)) acc.push(p);
  }
  return acc;
}

describe('IAP storefront contract', () => {
  it('uses kit session cookies and does not collect cards or localStorage secrets', () => {
    const files = walk(path.join(root, 'src'));
    const blob = files.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
    assert.match(blob, /createClient/);
    assert.match(blob, /credentials: 'include'/);
    assert.match(blob, /\/api\/v1\/quotes\/inventory/);
    assert.doesNotMatch(blob, /localStorage|sessionStorage|jsonwebtoken|COOKIE_SECRET/);
    assert.doesNotMatch(blob, /@securedbackend\/sdk\/server/);
    assert.doesNotMatch(blob, /placeholder=["']1234 5678|Name on card|id=["']signatureName["']/);
    assert.doesNotMatch(blob, /tenant_id:/);
  });
});
