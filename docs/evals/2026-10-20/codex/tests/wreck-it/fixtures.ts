import { test as base, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
export { expect };
export const test = base.extend<{ isolatedAccount: void }>({
  isolatedAccount: [async ({ context }, use, testInfo) => {
    await context.clearCookies();
    if (!testInfo.file.endsWith('WR-005.spec.ts')) {
      const email = execFileSync('npx', ['@miyannishar/wreck-it','email','new'], {encoding:'utf8'}).split('\n')[0].trim();
      const response = await context.request.post('/api/auth/signup', {data: {email, displayName: 'wreck-it regression', password:'Wreck-it-123!'}});
      expect(response.status(), 'isolated fake test account creation').toBe(201);
      execFileSync('npx', ['@miyannishar/wreck-it','run','created', 'regression account '+email, '--by','regression-test']);
    }
    await use();
  }, {auto:true}],
});
