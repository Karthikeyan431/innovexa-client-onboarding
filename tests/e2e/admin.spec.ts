import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { makePng, signatureInk, validForm } from '../helpers';

// Make sure there is enough data to paginate, created through the real API.
test.beforeAll(async ({ request }) => {
  const sig = `data:image/png;base64,${Buffer.from(makePng(400, 120, signatureInk)).toString('base64')}`;
  for (let i = 0; i < 22; i++) {
    const res = await request.post('/api/applications', {
      data: { idempotencyKey: randomUUID(), signature: sig, attachments: [],
        form: { ...validForm, fullName: `Pagination Client ${String(i).padStart(2, '0')}`, email: `page${i}@example.com`, companyName: `Paging Co ${i}` } },
    });
    expect(res.ok()).toBe(true);
  }
});

async function login(page: Page, email = 'admin@innovexadigital.in', password = 'LocalAdmin#2026') {
  await page.goto('/admin/');
  await page.fill('#em', email);
  await page.fill('#pw', password);
  await page.click('button[type=submit]');
}

test('rejects wrong passwords and non-admin accounts', async ({ page }) => {
  await login(page, 'admin@innovexadigital.in', 'wrong-password');
  await expect(page.locator('#loginErr')).toContainText('Incorrect email or password');
  await login(page, 'outsider@example.com', 'NotAdmin#2026');
  await expect(page.locator('.alert.error:visible')).toContainText('does not have access');
});

test('dashboard, search, filters, sorting, pagination, detail, status, notes and CSV', async ({ page }) => {
  await login(page);
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
  await expect(page.locator('.stat').first()).toContainText('Total clients');
  await expect(page.locator('.stat .v').nth(1)).not.toHaveText('0');

  await page.getByRole('link', { name: 'Clients', exact: true }).click();
  await expect(page.locator('#countLine')).toContainText('application');

  // pagination (seeded test data creates > 20 rows)
  await expect(page.locator('table.data tbody tr')).toHaveCount(20);
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page).toHaveURL(/page=2/);
  await expect(page.locator('.pager')).toContainText('Page 2');

  // search
  await page.fill('#fq', 'Kumar Logistics');
  await expect(page).toHaveURL(/q=Kumar/);
  await expect(page.locator('table.data tbody tr').first()).toContainText('Kumar Logistics');
  await page.fill('#fq', 'zzz-no-such-client');
  await expect(page.locator('.empty-state')).toContainText('No matching applications');
  await page.click('#resetFilters');

  // filters
  await page.selectOption('#fv', 'Custom software development');
  await expect(page).toHaveURL(/service=/);
  for (const chips of await page.locator('table.data tbody tr .chips').all()) await expect(chips).toHaveAttribute('title', /Custom software development/);
  await page.selectOption('#fs', 'proposal_sent');
  await expect(page).toHaveURL(/status=proposal_sent/);
  await page.click('#resetFilters');
  const today = new Date().toISOString().slice(0, 10);
  await page.fill('#ff', today);
  await expect(page).toHaveURL(/from=/);
  await expect(page.locator('table.data tbody tr').first()).toBeVisible();
  await page.click('#resetFilters');

  // sorting
  await page.locator('th button[data-sort="full_name"]').click();
  await expect(page).toHaveURL(/sort=full_name/);
  await page.locator('th button[data-sort="full_name"]').click();
  await expect(page.locator('th[aria-sort="ascending"]')).toContainText('Client');
  const names = await page.locator('table.data tbody tr td.primary-cell strong').allTextContents();
  expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' })));

  // CSV export
  const [csv] = await Promise.all([page.waitForEvent('download'), page.click('#csv')]);
  const csvPath = 'test-results/export.csv';
  await csv.saveAs(csvPath);
  const content = readFileSync(csvPath, 'utf8');
  expect(content.split('\r\n')[0]).toContain('Reference,Submitted,Status,Client name');
  expect(content).not.toMatch(/internal note/i);

  // detail page of the browser-submitted application
  // newest application submitted through the browser test (onboarding.spec)
  await page.fill('#fq', 'Kumar Logistics');
  await expect(page).toHaveURL(/q=Kumar/);
  const row = page.locator('table.data tbody tr').first();
  const ref = (await row.locator('.primary-cell .sub').last().textContent())!.trim();
  await row.click();
  await expect(page.getByRole('heading', { name: 'Arun Kumar' })).toBeVisible();
  await expect(page.locator('#sigView img')).toBeVisible();
  expect(await page.locator('#sigView img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(100);
  await expect(page.locator('.files')).toContainText('requirements.pdf');

  // edit permitted fields
  await page.click('#edit');
  await page.fill('#e_location', 'Guindy, Chennai');
  await page.click('#editForm button[type=submit]');
  await expect(page.locator('#profileCard')).toContainText('Guindy, Chennai');

  // assign, note, status with client email
  await page.selectOption('#assign', { label: 'Divya S' });
  await expect(page.locator('.toast').last()).toContainText('Assigned to Divya S');
  await page.fill('#noteBody', 'Prefers calls after 4pm.');
  await page.click('#noteForm button');
  await expect(page.locator('.notes').first()).toContainText('Prefers calls after 4pm.');
  const current = await page.locator('#ns').inputValue();
  const [target, label] = current === 'under_review' ? ['contacted', 'Contacted'] : ['under_review', 'Under review'];
  await page.selectOption('#ns', target);
  await page.fill('#snote', 'Started technical review');
  await page.check('#notify');
  await page.fill('#cmsg', 'We are reviewing your requirements.');
  await page.click('#statusForm button[type=submit]');
  await expect(page.locator('.toast').last()).toContainText(`Status updated to ${label}`);
  await expect(page.locator('.history li').first()).toContainText(label);
  await expect(page.locator('.history li').first()).toContainText('Started technical review');

  // signed PDF download
  const [pdf] = await Promise.all([page.waitForEvent('download'), page.click('#pdf')]);
  expect(pdf.suggestedFilename()).toBe(`Innovexa-Application-${ref}.pdf`);

  // delete from the list: cancel keeps it, confirm removes it
  await page.goto('/admin/#/applications?q=Pagination%20Client%2000');
  const victim = page.locator('table.data tbody tr').first();
  await expect(victim).toContainText('Pagination Client 00');
  const before = await page.locator('table.data tbody tr').count();
  await victim.locator('[data-delete]').click();
  await expect(page.locator('dialog.dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('dialog.dialog')).toHaveCount(0);
  await expect(page).toHaveURL(/#\/applications\?q=/); // row was not opened
  await victim.locator('[data-delete]').click();
  await page.getByRole('button', { name: 'Delete permanently' }).click();
  await expect(page.locator('.toast').last()).toContainText('Deleted INX-');
  await expect(page.locator('table.data tbody tr')).toHaveCount(before - 1);

  // delete from the detail page
  await page.locator('table.data tbody tr').first().click();
  await page.click('#del');
  await page.getByRole('button', { name: 'Delete permanently' }).click();
  await expect(page).toHaveURL(/#\/applications$/);
  await expect(page.locator('.toast').last()).toContainText('Deleted INX-');

  // sign out
  await page.click('#signout');
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
});
