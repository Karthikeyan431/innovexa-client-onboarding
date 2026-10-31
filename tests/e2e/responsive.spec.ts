import { expect, test } from '@playwright/test';

// Checks layout at phone, tablet and desktop widths: no horizontal scroll and screenshots for review.
for (const [name, width, height] of [['phone', 375, 812], ['tablet', 820, 1180], ['laptop', 1366, 768], ['desktop', 1440, 900]] as const) {
  test(`onboarding and admin fit at ${name} width`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `screenshots/onboarding-${name}.png`, fullPage: true });

    await page.goto('/admin/');
    await expect(page.locator('.auth-logo')).toBeVisible();
    await page.screenshot({ path: `screenshots/admin-login-${name}.png` });
    await page.fill('#em', 'admin@innovexadigital.in');
    await page.fill('#pw', 'LocalAdmin#2026');
    await page.click('button[type=submit]');
    await expect(page.locator('.stat').first()).toBeVisible();
    await page.goto('/admin/#/applications');
    await expect(page.locator('table.data tbody tr').first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `screenshots/admin-list-${name}.png`, fullPage: false });
    await page.locator('table.data tbody tr').first().click();
    await expect(page.locator('#sigView img')).toBeVisible();
    await page.screenshot({ path: `screenshots/admin-detail-${name}.png`, fullPage: false });
  });
}
