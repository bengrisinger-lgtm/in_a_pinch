import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const storefrontDir = path.dirname(fileURLToPath(import.meta.url));

function findSdkRoot(): string | null {
  for (const rel of ['../symlfy-baas/syml-platform/client-sdk', '../../../symlfy-baas/syml-platform/client-sdk']) {
    const p = path.resolve(storefrontDir, rel);
    if (existsSync(path.join(p, 'package.json'))) return p;
  }
  return null;
}

function browserEntryFromPackage(sdkRoot: string): string | null {
  if (process.env.SDK_BROWSER_ENTRY && existsSync(process.env.SDK_BROWSER_ENTRY)) {
    return process.env.SDK_BROWSER_ENTRY;
  }
  const pkg = JSON.parse(readFileSync(path.join(sdkRoot, 'package.json'), 'utf8')) as {
    browser?: string;
    exports?: Record<string, string | { browser?: string; default?: string }>;
  };
  if (typeof pkg.browser === 'string') {
    const p = path.join(sdkRoot, pkg.browser.replace(/^\.\//, ''));
    if (existsSync(p)) return p;
  }
  const dot = pkg.exports?.['.'];
  if (dot && typeof dot === 'object' && dot.browser) {
    const p = path.join(sdkRoot, dot.browser.replace(/^\.\//, ''));
    if (existsSync(p)) return p;
  }
  for (const rel of ['dist/browser.js', 'dist/client.js']) {
    const p = path.join(sdkRoot, rel);
    if (existsSync(p)) return p;
  }
  return null;
}

const sdkRoot = findSdkRoot();
const sdkBrowserEntry = sdkRoot ? browserEntryFromPackage(sdkRoot) : null;

export default defineConfig({
  plugins: [react()],
  resolve: {
    conditions: ['browser', 'import', 'module', 'default'],
    mainFields: ['browser', 'module', 'jsdefault', 'main'],
    ...(sdkBrowserEntry
      ? { alias: { '@securedbackend/sdk': sdkBrowserEntry } }
      : {}),
  },
  server: {
    port: 5174,
    open: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
