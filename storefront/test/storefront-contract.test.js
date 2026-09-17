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
    const appSrc = fs.readFileSync(path.join(root, 'src', 'App.tsx'), 'utf8');
    const footerSrc = fs.readFileSync(
      path.join(root, 'src', 'components', 'SiteFooter.tsx'),
      'utf8'
    );
    assert.match(blob, /createClient/);
    assert.match(blob, /credentials: 'include'/);
    assert.match(blob, /cache: 'no-store'/);
    assert.match(blob, /hidden=\{staffTools && view !== 'catalog'\}/);
    assert.match(blob, /isConsumerSurface/);
    assert.match(blob, /staffHubHref/);
    assert.match(blob, /staffTools/);
    assert.match(blob, /iap-logo-badge\.png/);
    assert.match(footerSrc, /iap-logo-lockup\.png/);
    assert.match(appSrc, /staff-nav-link/);
    assert.match(appSrc, /<\/nav>[\s\S]*staff-nav-link/);
    assert.match(blob, /Professional gear without the giant rental-house price tag/);
    const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    assert.match(indexHtml, /In A Pinch AV \| Denver AV Rentals/);
    assert.match(indexHtml, /iap-logo-badge\.png/);
    assert.match(blob, /staffLoginHref\(staffHubHref\(\)\)/);
    assert.match(fs.readFileSync(path.join(root, 'src', 'lib', 'kit.ts'), 'utf8'), /VITE_STOREFRONT_SURFACE/);
    assert.ok(fs.existsSync(path.join(root, 'public', 'iap-logo-badge.png')));
    assert.ok(fs.existsSync(path.join(root, 'public', 'iap-logo-lockup.png')));
    const deploySrc = fs.readFileSync(path.join(root, 'deploy.ps1'), 'utf8');
    assert.match(deploySrc, /coming-soon/);
    assert.match(deploySrc, /Console overlay skipped on landing slug/);
    assert.match(deploySrc, /AppSlug coming-soon/);
    assert.doesNotMatch(deploySrc, /Do not upload to the landing bucket/);
    assert.match(blob, /LOAD_OUT_POLICY/);
    assert.match(blob, /load_in_time/);
    assert.match(blob, /12:30 a.m. to 7:00 a.m/);
    assert.match(blob, /coordinate a load-out time with the venue/);
    assert.match(blob, /billingDays/);
    assert.doesNotMatch(blob, /up to 24 hours/);
    assert.match(blob, /range-start/);
    assert.match(blob, /onPreview/);
    assert.match(blob, /formatPrettyDate/);
    assert.match(blob, /DateRangeCalendar/);
    assert.doesNotMatch(blob, /Check Dates/);
    assert.match(blob, /Pickup/);
    assert.match(blob, /iap-catalog-refresh/);
    assert.match(blob, /Keep the last good list/);
    assert.match(blob, /asTemplateList/);
    assert.match(blob, /tenantConsoleHref/);
    assert.match(blob, /\/console\/index\.html\?as=tenant/);
    assert.match(blob, /title: 'Vault'/);
    assert.doesNotMatch(blob, /app\.symlavault\.com|auth\.symlavault\.com/);
    assert.match(blob, /Loading templates/);
    assert.match(blob, /\/api\/v1\/quotes/);
    assert.match(blob, /\/checkout/);
    assert.match(blob, /payment-link/);
    assert.match(blob, /Mark paid/);
    assert.match(blob, /ensureStorefrontSession/);
    assert.match(blob, /\/api\/v1\/auth\/guest/);
    assert.match(footerSrc, /Staff sign in/);
    assert.match(footerSrc, /className="site-footer"/);
    assert.match(footerSrc, /Terms of Use/);
    assert.match(footerSrc, /pages later/);
    assert.match(footerSrc, /Privacy page not built yet/);
    assert.doesNotMatch(appSrc, /Staff sign in/);
    assert.match(blob, /No account required/);
    assert.match(blob, /faster checkout is later/);
    assert.match(blob, /Continue to agreement/);
    assert.match(blob, /isStaffUser/);
    const cartSrc = fs.readFileSync(path.join(root, 'src', 'components', 'CartDrawer.tsx'), 'utf8');
    const agreementSrc = fs.readFileSync(
      path.join(root, 'src', 'components', 'AgreementPanel.tsx'),
      'utf8'
    );
    assert.match(cartSrc, /Continue shopping/);
    assert.match(cartSrc, /isStaff \? \(/);
    assert.match(cartSrc, /Release holds/);
    assert.match(blob, /Are you still shopping/);
    assert.match(blob, /Yes, continue/);
    assert.match(blob, /\/holds\/extend/);
    assert.match(blob, /STILL_SHOPPING_LEAD_MINUTES/);
    assert.doesNotMatch(blob, /iap-open-cart/);
    assert.match(agreementSrc, /if \(consumer\)/);
    assert.match(blob, /signedAgreementTitle/);
    assert.match(blob, /Signed Service Agreement/);
    assert.match(blob, /catalog-dates-banner/);
    assert.match(blob, /load-in and load-out dates and times below/);
    assert.doesNotMatch(blob, /Billed in 24-hour periods/);
    assert.match(blob, /We sent the Standard Rental Agreement/);
    assert.match(blob, /Sending the Standard Rental Agreement/);
    assert.match(agreementSrc, /Send for signature/);
    assert.doesNotMatch(blob, /twilio|Twilio|SMS_MFA|verifySms|sms_code/i);
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
    assert.match(blob, /cadel@inapinchav\.com/);
    assert.match(blob, /Cadel Grisinger/);
    assert.match(blob, /#orders/);
    assert.match(blob, /Cancel order and release holds/);
    assert.match(blob, /Search by customer name/);
    assert.match(blob, /Cancel and refund/);
    assert.match(blob, /Customer payment link/);
    assert.match(blob, /no extra send/);
    assert.match(blob, /post_sign_redirect_url/);
    assert.match(blob, /continue to payment/);
    assert.doesNotMatch(blob, /web.squarecdn.com|Square\.payments\(/);
    assert.match(blob, /15 minutes/);
    assert.match(blob, /cancelQuote/);
    assert.match(blob, /signerBaseUrl/);
    assert.match(blob, /VITE_SIGNER_URL/);
    assert.doesNotMatch(blob, /sign\.inapinchav\.com/);
    assert.match(blob, /patchUnit/);
    assert.match(blob, /status: 'retired'/);
    assert.match(blob, /Hide from catalog/);
    assert.match(blob, /product-desc/);
    assert.match(blob, /product-art-thumb/);
    assert.match(blob, /photoPreview/);
    assert.match(blob, /product-art-label/);
    assert.match(blob, /uploadSkuCatalogImage/);
    assert.match(blob, /catalogImageSrc/);
    assert.match(blob, /MFG serial/);
    assert.match(blob, /listCategories/);
    assert.match(blob, /Pick a category/);
    assert.match(blob, /deleteCategory/);
    assert.match(blob, /unitLabel/);
    assert.match(blob, /patchCategory/);
    assert.match(blob, /Add unit/);
    assert.match(blob, /skuVisibleOnStock/);
    assert.match(blob, /Fully retired SKUs are hidden/);
    assert.match(blob, /Manage categories/);
    assert.match(blob, /saveCategoryPrefix/);
    assert.match(blob, /Add category/);
    assert.match(blob, /\/categories/);
    const invApiSrc = fs.readFileSync(path.join(root, 'src', 'lib', 'inventoryApi.ts'), 'utf8');
    assert.match(invApiSrc, /method: 'DELETE'/);
    assert.doesNotMatch(blob.replace(invApiSrc, ''), /method:\s*['"]DELETE['"]/);
    assert.doesNotMatch(blob, /x:\s*72,\s*y:\s*640/);
    assert.doesNotMatch(blob, /signer_index/);
    assert.doesNotMatch(blob, /PdfBlockEditor/);
    const cartPersistSrc = fs.readFileSync(
      path.join(root, 'src', 'lib', 'cartPersistence.ts'),
      'utf8'
    );
    const blobNoCartPersist = blob.replace(cartPersistSrc, '');
    assert.doesNotMatch(blobNoCartPersist, /localStorage|sessionStorage|jsonwebtoken|COOKIE_SECRET/);
    assert.match(cartPersistSrc, /sessionStorage/);
    assert.match(blob, /rented by another customer/);
    assert.match(blob, /renterHasSigned/);
    assert.doesNotMatch(blob, /@securedbackend\/sdk\/server/);
    assert.doesNotMatch(blob, /placeholder=["']1234 5678|Name on card|id=["']signatureName["']/);
    assert.doesNotMatch(blob, /sq-card-number|Web Payments SDK|payments\.squareup/);
    assert.doesNotMatch(blob, /<canvas|getContext\(['"]2d['"]\)/);
    assert.doesNotMatch(blob, /tenant_id:/);
  });
});
