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
    assert.match(blob, /cache: 'no-store'/);
    assert.match(blob, /asTemplateList/);
    assert.match(blob, /Loading templates/);
    assert.match(blob, /\/api\/v1\/quotes/);
    assert.match(blob, /\/checkout/);
    assert.match(blob, /payment-link/);
    assert.match(blob, /Mark paid/);
    assert.match(blob, /client\.signing/);
    assert.match(blob, /applyTemplate/);
    assert.match(blob, /envelope_id/);
    assert.match(blob, /Integrations/);
    assert.match(blob, /connected calendar/);
    assert.match(blob, /Signatures/);
    assert.match(blob, /Templates/);
    assert.match(blob, /whyTemplateNotReady/);
    assert.match(blob, /exactly two required-signer roles/);
    assert.match(blob, /click Signature/);
    assert.match(blob, /staffSigningUrl/);
    assert.match(blob, /customerSigningUrl/);
    assert.match(blob, /patchUnit/);
    assert.match(blob, /status: 'retired'/);
    assert.match(blob, /Hide from catalog/);
    assert.match(blob, /Change serial/);
    assert.doesNotMatch(blob, /method:\s*['"]DELETE['"]/);
    assert.doesNotMatch(blob, /x:\s*72,\s*y:\s*640/);
    assert.doesNotMatch(blob, /signer_index/);
    assert.doesNotMatch(blob, /PdfBlockEditor/);
    assert.doesNotMatch(blob, /localStorage|sessionStorage|jsonwebtoken|COOKIE_SECRET/);
    assert.doesNotMatch(blob, /@securedbackend\/sdk\/server/);
    assert.doesNotMatch(blob, /placeholder=["']1234 5678|Name on card|id=["']signatureName["']/);
    assert.doesNotMatch(blob, /sq-card-number|Web Payments SDK|payments\.squareup/);
    assert.doesNotMatch(blob, /<canvas|getContext\(['"]2d['"]\)/);
    assert.doesNotMatch(blob, /tenant_id:/);
  });
});
