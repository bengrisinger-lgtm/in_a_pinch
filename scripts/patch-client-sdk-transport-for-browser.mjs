#!/usr/bin/env node
/**
 * client-sdk transport.ts reads package.json via node:fs for the version header.
 * Fresh `tsc` output breaks Vite; patch dist/transport.js in CI working trees only.
 */
import fs from 'node:fs';
import path from 'node:path';

const sdkDir = process.argv[2];
if (!sdkDir) {
  console.error('usage: patch-client-sdk-transport-for-browser.mjs <client-sdk-dir>');
  process.exit(1);
}

const transportPath = path.join(sdkDir, 'dist', 'transport.js');
if (!fs.existsSync(transportPath)) {
  console.error(`missing ${transportPath}`);
  process.exit(1);
}

let src = fs.readFileSync(transportPath, 'utf8');
if (!src.includes('node:fs')) {
  console.log('transport.js already browser-safe');
  process.exit(0);
}

const pkg = JSON.parse(fs.readFileSync(path.join(sdkDir, 'package.json'), 'utf8'));
const version = String(pkg.version || '0.0.0').replace(/\\/g, '\\\\').replace(/'/g, "\\'");

const block =
  /import \{ readFileSync \} from 'node:fs';\r?\nimport \{ fileURLToPath \} from 'node:url';\r?\nimport \{ dirname, join \} from 'node:path';\r?\nimport \{ PlatformError, TransportError \} from '\.\/types\.js';\r?\nconst SDK_VERSION = \(\(\) => \{[\s\S]*?\}\)\(\);/;

if (!block.test(src)) {
  console.error('transport.js layout changed — update patch-client-sdk-transport-for-browser.mjs');
  process.exit(1);
}

src = src.replace(
  block,
  `import { PlatformError, TransportError } from './types.js';\nconst SDK_VERSION = '${version}';`
);

if (src.includes('node:fs')) {
  console.error('patch left node:fs imports in transport.js');
  process.exit(1);
}

fs.writeFileSync(transportPath, src);
console.log(`patched transport.js for browser (SDK_VERSION=${pkg.version || '0.0.0'})`);
