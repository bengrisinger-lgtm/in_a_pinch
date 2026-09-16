/**
 * Staff catalog photos for rental SKUs. Objects live on tenant storefront
 * bucket(s) at catalog-media/{skuId}.{ext} — same path hub and apex can serve.
 */

import { Storage } from '@google-cloud/storage';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const CATALOG_IMAGE_MAX_BYTES = 2_000_000;
const IMAGE_URL_MAX = 2048;
const PATH_RE = /^\/catalog-media\/[0-9a-f-]{36}\.(jpe?g|png|webp)$/i;

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

function extForType(contentType) {
  if (contentType === 'image/jpeg') return 'jpg';
  if (contentType === 'image/png') return 'png';
  if (contentType === 'image/webp') return 'webp';
  return null;
}

function sniffImageType(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  ) {
    return 'image/webp';
  }
  return null;
}

export function catalogMediaBuckets() {
  return (process.env.CATALOG_MEDIA_BUCKETS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * @param {string | null | undefined} raw
 * @returns {string | null}
 */
export function normalizeStoredImageUrl(raw) {
  if (raw == null) return null;
  if (typeof raw !== 'string') {
    const err = new Error('image_url must be a string or null');
    err.status = 400;
    throw err;
  }
  const s = raw.trim();
  if (!s) return null;
  if (s.length > IMAGE_URL_MAX) {
    const err = new Error('image_url is too long');
    err.status = 400;
    throw err;
  }
  if (s.startsWith('/')) {
    if (!PATH_RE.test(s)) {
      const err = new Error('image_url path must be /catalog-media/{skuId}.jpg|png|webp');
      err.status = 400;
      throw err;
    }
    return s;
  }
  let parsed;
  try {
    parsed = new URL(s);
  } catch {
    const err = new Error('image_url must be https or a /catalog-media/ path');
    err.status = 400;
    throw err;
  }
  if (parsed.protocol !== 'https:') {
    const err = new Error('image_url must use https');
    err.status = 400;
    throw err;
  }
  if (parsed.username || parsed.password) {
    const err = new Error('image_url must not include credentials');
    err.status = 400;
    throw err;
  }
  return parsed.toString();
}

/**
 * @param {{ content_type?: string; data_base64?: string }} body
 * @param {string} skuId
 */
export function parseCatalogImageUpload(body, skuId) {
  if (!UUID_RE.test(skuId)) {
    const err = new Error('skuId must be a UUID');
    err.status = 400;
    throw err;
  }
  const contentType = typeof body?.content_type === 'string' ? body.content_type.trim().toLowerCase() : '';
  const dataBase64 = typeof body?.data_base64 === 'string' ? body.data_base64.trim() : '';
  if (!contentType || !ALLOWED_TYPES.has(contentType)) {
    const err = new Error('content_type must be image/jpeg, image/png, or image/webp');
    err.status = 400;
    throw err;
  }
  if (!dataBase64) {
    const err = new Error('data_base64 is required');
    err.status = 400;
    throw err;
  }
  let buffer;
  try {
    buffer = Buffer.from(dataBase64, 'base64');
  } catch {
    const err = new Error('data_base64 is invalid');
    err.status = 400;
    throw err;
  }
  if (!buffer.length || buffer.length > CATALOG_IMAGE_MAX_BYTES) {
    const err = new Error(`Image must be at most ${CATALOG_IMAGE_MAX_BYTES} bytes`);
    err.status = 400;
    throw err;
  }
  const sniffed = sniffImageType(buffer);
  if (!sniffed || sniffed !== contentType) {
    const err = new Error('Image bytes do not match content_type');
    err.status = 400;
    throw err;
  }
  const ext = extForType(contentType);
  if (!ext) {
    const err = new Error('Unsupported image type');
    err.status = 400;
    throw err;
  }
  return { buffer, contentType, path: `/catalog-media/${skuId}.${ext}` };
}

/**
 * @param {{ buckets?: string[]; path: string; buffer: Buffer; contentType: string; storage?: Storage }} opts
 */
export async function putCatalogImageObjects(opts) {
  const buckets = opts.buckets?.length ? opts.buckets : catalogMediaBuckets();
  if (!buckets.length) {
    const err = new Error('Catalog image upload is not configured (CATALOG_MEDIA_BUCKETS)');
    err.status = 503;
    throw err;
  }
  const objectName = opts.path.replace(/^\//, '');
  const storage = opts.storage || new Storage();
  await Promise.all(
    buckets.map(async (bucketName) => {
      const file = storage.bucket(bucketName).file(objectName);
      await file.save(opts.buffer, {
        contentType: opts.contentType,
        resumable: false,
        metadata: { cacheControl: 'public, max-age=3600' },
      });
    })
  );
  return opts.path;
}
