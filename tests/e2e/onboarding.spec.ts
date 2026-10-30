import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';

async function draw(page: Page, isMobile: boolean) {
  const canvas = page.locator('#sig');
  await canvas.scrollIntoViewIfNeeded();
  const box = (await canvas.boundingBox())!;
  const pts = Array.from({ length: 40 }, (_, i) => ({ x: box.x + 30 + i * ((box.width - 60) / 40), y: box.y + box.height / 2 + Math.sin(i / 3) * 35 }));
  if (isMobile) {
    // Real touch input via CDP so pointer events have pointerType "touch".
    const cdp = await page.context().newCDPSession(page);
    const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', p?: { x: number; y: number }) =>
      cdp.send('Input.dispatchTouchEvent', { type, touchPoints: p ? [{ x: p.x, y: p.y }] : [] });
    await touch('touchStart', pts[0]);
    for (const p of pts.slice(1)) await touch('touchMove', p);
    await touch('touchEnd');
  } else {
    await page.mouse.move(pts[0].x, pts[0].y);
    await page.mouse.down();
    for (const p of pts.slice(1)) await page.mouse.move(p.x, p.y, { steps: 2 });
    await page.mouse.up();
  }
}

async function fillAll(page: Page, email: string) {
  await page.fill('#fullName', 'Arun Kumar');
  await page.fill('#designation', 'Operations Head');
  await page.fill('#email', email);
  await page.fill('#phone', '+91 99400 12345');
  await page.check('input[name=preferredContact][value=Phone]');
  await page.click('#next');
  await page.fill('#companyName', 'Kumar Logistics Pvt Ltd');
  await page.selectOption('#industry', 'Logistics / Transport');
  await page.fill('#location', 'Chennai');
  await page.check('input[name=hasWebsite][value=Yes]');
  await page.fill('#websiteUrl', 'kumarlogistics.in');
  await page.fill('#businessDescription', 'Regional freight and warehousing.');
  await page.click('#next');
  await page.getByLabel('AI automation').check();
  await page.getByLabel('Custom software development').check();
  await page.getByLabel('Other services', { exact: true }).check();
  await page.fill('#otherServices', 'Fleet GPS integration');
  await page.fill('#projectRequirements', 'Automate dispatch scheduling, driver WhatsApp updates and a customer tracking portal.\n'.repeat(3));
  await page.selectOption('#budgetRange', '₹1,00,000 – ₹5,00,000');
  await page.selectOption('#timeline', 'Within 3–6 months');
  await page.setInputFiles('#files', { name: 'requirements.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n% brief\n') });
  await page.click('#next');
}

test('validates each step and blocks progress until fixed', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.click('#next');
  await expect(page.locator('#err-fullName')).toBeVisible();
  await expect(page.locator('#err-email')).toBeVisible();
  await expect(page.locator('#fullName')).toHaveAttribute('aria-invalid', 'true');
  await page.fill('#fullName', 'Test User');
  await page.fill('#email', 'bad-email');
  await page.fill('#phone', '12');
  await page.click('#next');
  await expect(page.locator('#err-email')).toContainText('valid email');
  await expect(page.locator('#err-phone')).toContainText('valid phone');
  await page.fill('#email', 'test@example.com');
  await page.fill('#phone', '9876543210');
  await page.click('#next');
  await expect(page.locator('.page[data-step="1"]')).toBeVisible();
  await page.click('#next');
  await expect(page.locator('#err-companyName')).toBeVisible();
  await expect(page.locator('#err-hasWebsite')).toBeVisible();
});

test('rejects disallowed attachments in the browser', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.fill('#fullName', 'Test User');
  await page.fill('#email', 'test@example.com');
  await page.fill('#phone', '9876543210');
  await page.click('#next');
  await page.fill('#companyName', 'X');
  await page.selectOption('#industry', 'Other');
  await page.check('input[name=hasWebsite][value=No]');
  await page.fill('#websiteRequirements', 'Simple site');
  await page.click('#next');
  await page.setInputFiles('#files', { name: 'virus.exe', mimeType: 'application/x-msdownload', buffer: Buffer.from('MZ') });
  await expect(page.locator('#err-files')).toContainText('not allowed');
  await page.getByRole('button', { name: 'Remove virus.exe' }).click();
  await expect(page.locator('#err-files')).toHaveCount(0);
});

test('full submission with signature, persistence, duplicate prevention and PDF', async ({ page, isMobile }, info) => {
  const email = `arun.${info.project.name}.${Date.now()}@example.com`;
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await fillAll(page, email);

  // Review shows every section
  const review = page.locator('#review');
  await expect(review).toContainText('Kumar Logistics Pvt Ltd');
  await expect(review).toContainText('https://kumarlogistics.in/');
  await expect(review).toContainText('Other: Fleet GPS integration');
  await expect(review).toContainText('requirements.pdf');

  // Submitting without signature or acknowledgement is blocked
  await page.click('#submit');
  await expect(page.locator('#err-signature')).toBeVisible();
  await expect(page.locator('#err-acknowledged')).toBeVisible();

  // A tap is not a signature
  const c = (await page.locator('#sig').boundingBox())!;
  await page.mouse.click(c.x + 50, c.y + 50);
  await page.check('#acknowledged');
  await page.click('#submit');
  await expect(page.locator('#err-signature')).toContainText('too short');

  // Clear, then draw a real signature
  await page.click('#sigClear');
  await draw(page, isMobile);
  await expect(page.locator('#signatureBox')).toHaveClass(/signed/);

  // Signature survives editing an earlier section and returning (original bug)
  await page.locator('[data-edit="1"]').click();
  await page.fill('#location', 'Chennai, Tamil Nadu');
  await page.click('#next'); // "Save & continue" returns to review
  await expect(page.locator('.page[data-step="3"]')).toBeVisible();
  await expect(page.locator('#review')).toContainText('Chennai, Tamil Nadu');
  await expect(page.locator('#signatureBox')).toHaveClass(/signed/);

  // Signature and fields survive a reload (local draft); files must be re-added
  await page.reload();
  await expect(page.locator('.page[data-step="3"]')).toBeVisible();
  await expect(page.locator('#signatureBox')).toHaveClass(/signed/);
  await page.locator('[data-edit="2"]').click();
  await page.setInputFiles('#files', { name: 'requirements.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n% brief\n') });
  await page.click('#next');
  await page.check('#acknowledged');

  // Double-click submit: only one application is created
  const posts: string[] = [];
  page.on('request', (r) => { if (r.url().endsWith('/api/applications') && r.method() === 'POST') posts.push(r.url()); });
  await page.locator('#submit').dblclick();
  await expect(page.locator('#success')).toBeVisible({ timeout: 120_000 });
  expect(posts.length).toBe(1);

  const ref = (await page.locator('#successRef').textContent())!;
  expect(ref).toMatch(/^INX-\d{4}-[A-Z0-9]{6}$/);
  await expect(page.locator('#successTitle')).toHaveText('Thank you, Arun.');
  await expect(page.locator('.timeline li')).toHaveCount(4);

  // Download the PDF and verify the content and the embedded signature
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#downloadPdf')]);
  expect(download.suggestedFilename()).toBe(`Innovexa-Application-${ref}.pdf`);
  const file = `test-results/${ref}.pdf`;
  await download.saveAs(file);
  const text = execFileSync('pdftotext', ['-layout', file, '-']).toString();
  for (const s of ['Arun Kumar', email, 'Kumar Logistics Pvt Ltd', 'https://kumarlogistics.in/', 'Other: Fleet GPS integration',
    '₹1,00,000 – ₹5,00,000', 'requirements.pdf', ref, 'Client acknowledgement & signature']) expect(text, s).toContain(s);
  const images = execFileSync('pdfimages', ['-list', file]).toString();
  expect(images).toMatch(/\bsmask\b/);
  execFileSync('pdftoppm', ['-png', '-r', '70', file, `test-results/${ref}`]);

  // Draft cleared; "previous submissions" lists it with a working re-download
  await page.goto('/');
  await expect(page.locator('#previous')).toContainText(ref);
  const [again] = await Promise.all([page.waitForEvent('download'), page.locator(`[data-ref="${ref}"]`).click()]);
  expect(again.suggestedFilename()).toContain(ref);
  await expect(page.locator('#fullName')).toHaveValue('');
});

test('keeps the form data and shows an error when the server fails', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await fillAll(page, 'failure@example.com');
  await draw(page, false);
  await page.check('#acknowledged');
  await page.route('**/api/applications', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Something went wrong on our side. Please try again.' }) }));
  await page.click('#submit');
  await expect(page.locator('#formError')).toContainText('Please try again');
  await expect(page.locator('#success')).toBeHidden();
  await expect(page.locator('#signatureBox')).toHaveClass(/signed/);
  await expect(page.locator('#submit')).toBeEnabled();
});
