import { test as base, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
export { expect };
export const test = base.extend<{ isolatedAccount: void }>({
  isolatedAccount: [async ({ context, page, baseURL }, use, testInfo) => {
    const pageUrls: string[] = [];
    page.on('request', request => pageUrls.push(request.url()));
    if (!testInfo.title.includes('Signup validation')) {
      const account = await context.request.post('/api/auth/signup', { data: { email: 'reliability+'+randomUUID()+'@example.com', displayName: 'Reliability Shopper', password: 'Fake-Local-123!' } });
      expect(account.status(), 'isolated account setup').toBe(201);
      const cart = await context.request.post('/api/cart', { data: { productId: '3', quantity: 1 } });
      expect(cart.status(), 'cart setup').toBe(201);
    } else {
      await page.route('**/api/auth/signup', async route => { await new Promise(r => setTimeout(r, 800)); await route.continue(); });
    }
    await use();
    if (testInfo.title.includes('Dead link')) {
      await page.getByRole('link', { name: 'Shipping & pricing', exact: true }).click();
      await page.waitForURL(/\/(?:pricng|pricing)$/);
      await expect(page.locator('main h1')).toHaveText(/^(?:Page not found|Shipping & pricing)$/);
    }
    const audit = { baseURL, recordingOriginRequests: pageUrls.filter(url => url.startsWith('http://localhost:4318/')), origins: [...new Set(pageUrls.map(url => new URL(url).origin))] };
    await testInfo.attach('URL audit', { body: JSON.stringify(audit), contentType: 'application/json' });
    const shot = testInfo.outputPath(testInfo.title.slice(0, 6)+'.png');
    await page.screenshot({ path: shot, fullPage: true });
    await testInfo.attach('relevant state', { path: shot, contentType: 'image/png' });
    expect(audit.recordingOriginRequests, 'all app traffic honors the base URL override').toEqual([]);
  }, { auto: true }],
});
