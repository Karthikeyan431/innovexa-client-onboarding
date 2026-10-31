import { expect, test } from '@playwright/test';

test('send an onboarding link from the dashboard and open it prefilled', async ({ page, context, browser }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/admin/');
  await page.fill('#em', 'admin@innovexadigital.in');
  await page.fill('#pw', 'LocalAdmin#2026');
  await page.click('button[type=submit]');
  await expect(page.locator('#sendInvite')).toBeVisible();

  await page.click('#sendInvite');
  const dlg = page.locator('dialog.dialog');
  await expect(dlg.getByRole('heading', { name: 'Send onboarding link' })).toBeVisible();
  await dlg.getByRole('button', { name: 'Send invitation' }).click();
  await expect(dlg.locator('.field-error')).toHaveCount(2); // name + email required

  const email = `e2e-invite-${Date.now()}@example.com`;
  await dlg.locator('#iName').fill('Lakshmi Narayanan');
  await dlg.locator('#iEmail').fill(email);
  await dlg.locator('#iCompany').fill('LN Exports');
  await dlg.locator('#iMsg').fill('Thanks for the call today!');
  await dlg.getByRole('button', { name: 'Send invitation' }).click();
  await expect(dlg.getByRole('heading', { name: 'Invitation ready' })).toBeVisible();
  await expect(dlg.locator('.alert.success')).toContainText(email);
  const link = await dlg.locator('#inviteLink').inputValue();
  expect(link).toContain('/?invite=');
  await dlg.getByRole('button', { name: 'Copy link' }).click();
  await expect(dlg.getByRole('button', { name: 'Copied' })).toBeVisible();
  await dlg.getByRole('button', { name: 'Done' }).click();

  // listed on the Invitations page
  await page.getByRole('link', { name: 'Invitations' }).click();
  const row = page.locator('tr', { hasText: email });
  await expect(row).toContainText('Awaiting client');
  await expect(row).toContainText('LN Exports');
  await expect(row).toContainText('Karthikeyan R'); // "Sent" column: sender

  // the client opens the link in their own browser: details are prefilled
  const clientContext = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  const client = await clientContext.newPage();
  await client.goto(new URL(link).pathname + new URL(link).search);
  await expect(client.locator('#inviteNote')).toContainText('Welcome, Lakshmi!');
  await expect(client.locator('#fullName')).toHaveValue('Lakshmi Narayanan');
  await expect(client.locator('#email')).toHaveValue(email);
  await client.fill('#phone', '9876543210');
  await client.click('#next');
  await expect(client.locator('#companyName')).toHaveValue('LN Exports');
  await page.screenshot({ path: 'screenshots/admin-invitations-desktop.png' });
  await clientContext.close();

  // cancel it
  await row.locator('[data-cancel]').click();
  await page.locator('dialog.dialog').getByRole('button', { name: 'Cancel invitation' }).click();
  await expect(page.locator('.toast').last()).toContainText('Invitation cancelled');
  await expect(page.locator('tr', { hasText: email })).toHaveCount(0);
});
