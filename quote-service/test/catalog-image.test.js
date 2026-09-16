import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeStoredImageUrl,
  parseCatalogImageUpload,
} from '../src/catalogImage.js';

const SKU = '987bcdaf-320d-46bf-bfb3-4bdcdffe1de1';

describe('catalogImage', () => {
  it('accepts https and catalog-media paths', () => {
    assert.equal(
      normalizeStoredImageUrl(`https://hub.example.com/catalog-media/${SKU}.jpg`),
      `https://hub.example.com/catalog-media/${SKU}.jpg`
    );
    assert.equal(
      normalizeStoredImageUrl(`/catalog-media/${SKU}.webp`),
      `/catalog-media/${SKU}.webp`
    );
    assert.equal(normalizeStoredImageUrl(''), null);
    assert.equal(normalizeStoredImageUrl(null), null);
  });

  it('rejects non-https and bad paths', () => {
    assert.throws(() => normalizeStoredImageUrl('http://evil.com/x.jpg'), /https/);
    assert.throws(() => normalizeStoredImageUrl('/evil.jpg'), /catalog-media/);
  });

  it('parses a tiny png upload', () => {
    // 1x1 PNG
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64'
    );
    const parsed = parseCatalogImageUpload(
      { content_type: 'image/png', data_base64: png.toString('base64') },
      SKU
    );
    assert.equal(parsed.contentType, 'image/png');
    assert.equal(parsed.path, `/catalog-media/${SKU}.png`);
    assert.ok(parsed.buffer.length > 0);
  });
});
