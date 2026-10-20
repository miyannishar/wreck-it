#!/usr/bin/env node
// Focused counterfactual check, not a new blind discovery benchmark.
// npm run build; node scripts/verify-reliability.mjs --deps <node_modules with next + @playwright/test> --out <evidence-dir>
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync, symlinkSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { evaluate } from './eval.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const arg = (name, fallback) => { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1]; };
const deps = resolve(arg('--deps', join(repo, 'examples/buggy-app/node_modules')));
const out = resolve(arg('--out', join(repo, '.wreck-it/reliability-check')));
const cli = join(repo, 'packages/cli/dist/cli.js');
for (const file of [cli, join(deps, 'next/dist/bin/next'), join(deps, '@playwright/test/cli.js')]) {
  if (!existsSync(file)) throw new Error(`Required build/dependency not found: ${file}`);
}
mkdirSync(out, { recursive: true });
const scratch = mkdtempSync(join(tmpdir(), 'wreck-reliability-'));
const source = join(repo, 'examples/buggy-app');
const hash = (s) => createHash('sha256').update(s).digest('hex');
function treeHashes(dir, prefix = '') {
  return Object.fromEntries(readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    if (['node_modules', '.next', '.wreck-it', 'tests', 'test-results', 'playwright-report'].includes(d.name)) return [];
    const name = prefix + d.name, file = join(dir, d.name);
    return d.isDirectory() ? Object.entries(treeHashes(file, name + '/')) : [[name, hash(readFileSync(file))]];
  }));
}
const original = treeHashes(source);
const env = { ...process.env, NEXT_TELEMETRY_DISABLED: '1' };
const runCli = (...argv) => execFileSync(process.execPath, [cli, ...argv], { cwd: repo, env, encoding: 'utf8', maxBuffer: 10e6, stdio: ['ignore', 'pipe', 'pipe'] });
const sourceFiles = ['packages/cli/src/gentests.ts', 'packages/cli/src/schema.ts', 'packages/cli/src/sweep.ts', 'scripts/eval.mjs'];
const testedSourceSha256 = Object.fromEntries(sourceFiles.map((name) => [name, hash(readFileSync(join(repo, name)))]));
const servers = [];
const stopped = new Set();
function stop() { for (const child of servers) if (!stopped.has(child)) { stopped.add(child); child.kill('SIGTERM'); } }
process.on('SIGINT', () => { stop(); process.exit(130); });
process.on('SIGTERM', () => { stop(); process.exit(143); });
const port = async () => {
  const s = createServer(); await new Promise((r, j) => { s.on('error', j); s.listen(0, '127.0.0.1', r); });
  const p = s.address().port; await new Promise((r) => s.close(r)); return p;
};
const targets = {};
const changed = ['components/Footer.tsx', 'app/about/page.tsx', 'app/signup/page.tsx', 'app/api/orders/route.ts', 'app/orders/[id]/page.tsx', 'app/cart/page.tsx'];
function replace(dir, file, before, after) {
  const p = join(dir, file), old = readFileSync(p, 'utf8');
  if (!old.includes(before)) throw new Error(`Fixture no longer contains expected counterfactual target: ${file}`);
  writeFileSync(p, old.replace(before, after));
}
try {
  for (const variant of ['buggy', 'fixed']) {
    const dir = join(scratch, variant);
    cpSync(source, dir, { recursive: true, filter: (file) => !file.split('/').some((x) => ['node_modules', '.next', '.wreck-it', 'tests'].includes(x)) });
    symlinkSync(deps, join(dir, 'node_modules'), 'dir');
    if (variant === 'fixed') {
      replace(dir, changed[0], 'href="/pricng"', 'href="/pricing"');
      replace(dir, changed[1], 'src="/images/team-photo.jpg"', 'src="/logo.svg"');
      replace(dir, changed[2], 'setError("Something went wrong");\n      setForm(EMPTY);', 'const data = await res.json();\n      setError(data.error ?? "Please check your details");');
      replace(dir, changed[3], 'total: applyCoupon(summary.total, cart.coupon)', 'total: summary.total');
      replace(dir, changed[4], 'Placed {order.createdAt}', 'Placed {new Date(order.createdAt).toLocaleDateString()}');
      replace(dir, changed[5], '<th />', '<th>Actions</th>');
    }
    console.log(`Building ${variant} counterfactual fixture`);
    execFileSync(process.execPath, [join(deps, 'next/dist/bin/next'), 'build', '--webpack'], { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000 });
    const p = await port(), base = `http://127.0.0.1:${p}`;
    const child = spawn(process.execPath, [join(deps, 'next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', String(p)], { cwd: dir, env, stdio: 'ignore' });
    servers.push(child);
    let ready = false;
    for (let i = 0; i < 100; i++) {
      if (child.exitCode !== null) throw new Error(`${variant} server exited`);
      try { if ((await fetch(base + '/pricing', { signal: AbortSignal.timeout(1000) })).ok) { ready = true; break; } } catch {}
      await new Promise((r) => setTimeout(r, 200));
    }
    if (!ready) throw new Error(`${variant} server did not become ready`);
    targets[variant] = { dir, base };
  }
  const harness = join(scratch, 'checks'); mkdirSync(join(harness, '.wreck-it'), { recursive: true });
  symlinkSync(deps, join(harness, 'node_modules'), 'dir');
  writeFileSync(join(harness, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  const config = join(harness, '.wreck-it/config.json');
  writeFileSync(config, JSON.stringify({ baseUrl: targets.buggy.base }));
  // Exercise the real sweep -> finding -> generator path for the two previously pinned-URL tests.
  console.log('Recording actual broken link/image findings with fresh screenshots');
  runCli('sweep', '--root', harness, '--record', '--no-a11y', '--viewports', '1280x800', '--only', '/about');
  const findingDir = join(harness, '.wreck-it/findings');
  const discovered = readdirSync(findingDir).map((name) => JSON.parse(readFileSync(join(findingDir, name), 'utf8')));
  if (discovered.length !== 2 || !['imageLoaded', 'linkResolves'].every((k) => discovered.some((f) => f.assertions[0]?.kind === k))) throw new Error('Expected exactly two DOM resource findings');
  const add = (finding) => runCli('finding', 'add', JSON.stringify(finding), '--root', harness);
  const target = (value) => ({ by: 'css', value });
  const label = (value) => ({ by: 'label', value });
  const common = { category: 'functional', severity: 'medium', persona: 'reliability-check', reproduced: true };
  const navigation = (route) => ({ action: 'goto', url: `http://localhost:4318${route}` });
  add({ ...common, title: 'Signup validation preserves input after completed rejection', route: '/signup',
    steps: [navigation('/signup'),
      { action: 'fill', target: label('Your name'), value: 'Reliability Shopper' },
      { action: 'fill', target: label('Email'), value: 'reliability@example.com' },
      { action: 'fill', target: label('Password'), value: 'short' },
      { action: 'click', target: { by: 'role', role: 'button', name: 'Sign up', exact: true } },
      { action: 'waitFor', target: target('.error'), state: 'visible' }],
    assertions: [{ kind: 'value', target: label('Your name'), equals: 'Reliability Shopper' }, { kind: 'value', target: label('Email'), equals: 'reliability@example.com' }, { kind: 'text', target: target('.error'), contains: 'Password must be at least 8 characters' }],
    expected: 'Rejected signup keeps input and explains validation', actual: 'Generic error and cleared fields' });
  const orderSteps = [navigation('/checkout'), { action: 'fill', target: label('Delivery address'), value: '123 Test Lane' },
    { action: 'click', target: { by: 'role', role: 'button', name: 'Place order', exact: true } },
    { action: 'waitFor', target: { by: 'role', role: 'heading', name: 'Order #', exact: false }, state: 'visible' }];
  add({ ...common, title: 'Coupon charge equals checkout total', route: '/checkout',
    steps: [{ action: 'http', method: 'POST', url: 'http://localhost:4318/api/cart/coupon', headers: { 'content-type': 'application/json' }, body: '{"code":"SAVE10"}' }, ...orderSteps],
    assertions: [{ kind: 'text', target: target('.summary-total'), contains: '$44.99' }], expected: 'One discount: $44.99', actual: 'Two discounts: $40.49' });
  add({ ...common, title: 'Order date uses display format at every time of day', route: '/checkout', steps: orderSteps,
    assertions: [{ kind: 'text', target: target('main p.muted'), contains: 'Placed' }, { kind: 'textMatches', target: target('main p.muted'), pattern: '\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}', negate: true }],
    expected: 'Formatted date without a raw ISO timestamp', actual: 'Raw timestamp rendered' });
  add({ ...common, title: 'Cart actions column has a named table header', route: '/cart', steps: [navigation('/cart')],
    assertions: [{ kind: 'text', target: target('thead th:last-child'), contains: 'Actions' }], expected: 'Named actions column', actual: 'Empty header' });
  // The recording origin is deliberately offline; both variants must use the environment override.
  writeFileSync(config, JSON.stringify({ baseUrl: 'http://localhost:4318' }));
  runCli('gen-tests', '--root', harness);
  const specDir = join(harness, 'tests/wreck-it');
  const specNames = readdirSync(specDir).filter((name) => name.endsWith('.spec.ts'));
  if (specNames.length !== 6) throw new Error('Expected six generated specs');
  const fixture = String.raw`import { test as base, expect } from '@playwright/test';
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
`;
  writeFileSync(join(specDir, 'fixtures.ts'), fixture);
  // A realistic agent customization: inject account isolation, then regenerate twice.
  for (const name of specNames) {
    const p = join(specDir, name); writeFileSync(p, readFileSync(p, 'utf8').replace('from "@playwright/test"', 'from "./fixtures"'));
  }
  const beforeRegen = Object.fromEntries(specNames.map((n) => [n, hash(readFileSync(join(specDir, n)))]));
  runCli('gen-tests', '--root', harness); runCli('gen-tests', '--root', harness);
  const preserved = specNames.every((n) => beforeRegen[n] === hash(readFileSync(join(specDir, n))));
  if (!preserved || readFileSync(join(specDir, 'fixtures.ts'), 'utf8') !== fixture) throw new Error('Regeneration overwrote custom work');
  writeFileSync(join(harness, 'playwright.config.ts'), `import { defineConfig } from '@playwright/test';\nexport default defineConfig({ testDir: './tests/wreck-it', workers: 1, retries: 0, timeout: 20000, expect: { timeout: 2000 }, use: { viewport: { width: 1280, height: 900 } } });\n`);
  const summaries = {};
  for (const variant of ['buggy', 'fixed']) {
    const rawPath = join(scratch, `${variant}.json`);
    console.log(`Executing six checks against ${variant} app`);
    let code = 0;
    try {
      execFileSync(process.execPath, [join(deps, '@playwright/test/cli.js'), 'test', '--reporter=json', '--output', join(scratch, variant+'-results')], {
        cwd: harness, env: { ...env, WRECK_IT_BASE_URL: targets[variant].base, PLAYWRIGHT_JSON_OUTPUT_FILE: rawPath }, timeout: 180_000, stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) { code = err.status ?? 1; }
    if (!existsSync(rawPath)) throw new Error(`No Playwright JSON output for ${variant}`);
    const raw = JSON.parse(readFileSync(rawPath, 'utf8'));
    const checks = [];
    function visit(suite) {
      for (const spec of suite.specs ?? []) for (const test of spec.tests) {
        const result = test.results.at(-1);
        const images = [];
        for (const attachment of result.attachments ?? []) if (attachment.contentType === 'image/png' && attachment.path) {
          const rel = `${variant}-shots/${spec.title.slice(0, 6)}.png`;
          mkdirSync(join(out, `${variant}-shots`), { recursive: true }); copyFileSync(attachment.path, join(out, rel)); images.push(rel);
        }
        const audit = (result.attachments ?? []).find(a => a.name === 'URL audit');
        const urlAudit = audit?.body ? JSON.parse(Buffer.from(audit.body, 'base64').toString()) : null;
        checks.push({ title: spec.title, status: result.status, urlAudit, errors: (result.errors ?? []).map((e) => (e.message ?? '').replace(/\u001b\[[0-9;]*m/g, '').replaceAll(harness, '<check-root>')), images });
      }
      for (const child of suite.suites ?? []) visit(child);
    }
    for (const suite of raw.suites) visit(suite);
    summaries[variant] = { exitCode: code, checks, stats: raw.stats };
    if (checks.length !== 6 || checks.some((t) => t.status !== (variant === 'buggy' ? 'failed' : 'passed')) || checks.some((t) => t.images.length === 0 || !t.urlAudit || t.urlAudit.recordingOriginRequests.length > 0)) throw new Error(`Unexpected ${variant} result; inspect ${rawPath}`);
  }
  const scores = {};
  const manifest = JSON.parse(readFileSync(join(source, 'wreck-manifest.json'), 'utf8'));
  for (const agent of ['sonnet', 'codex']) {
    const dir = join(repo, 'docs/evals/2026-10-20', agent, 'findings');
    const findings = readdirSync(dir).map((name) => JSON.parse(readFileSync(join(dir, name), 'utf8')));
    scores[agent] = evaluate(manifest, findings);
  }
  // Attach the verified failure-state screenshots to every finding before generating the final report.
  for (const check of summaries.buggy.checks) {
    const id = check.title.slice(0, 6), f = JSON.parse(readFileSync(join(findingDir, id+'.json'), 'utf8'));
    const rel = 'shots/'+id+'-buggy.png';
    copyFileSync(join(out, check.images[0]), join(harness, '.wreck-it', rel));
    runCli('finding', 'update', id, JSON.stringify({ evidence: { ...f.evidence, screenshots: [...f.evidence.screenshots, rel] } }), '--root', harness);
  }
  runCli('report', '--root', harness);
  runCli('gen-tests', '--root', harness);
  for (const ext of ['html', 'md']) copyFileSync(join(harness, '.wreck-it', 'report.'+ext), join(out, 'report.'+ext));
  cpSync(specDir, join(out, 'tests/wreck-it'), { recursive: true });
  cpSync(findingDir, join(out, 'findings'), { recursive: true });
  cpSync(join(harness, '.wreck-it/shots'), join(out, 'shots'), { recursive: true });
  let patch = '';
  for (const file of changed) {
    try { patch += execFileSync('diff', ['-u', '--label', 'a/'+file, '--label', 'b/'+file, join(targets.buggy.dir, file), join(targets.fixed.dir, file)], { encoding: 'utf8' }); }
    catch (err) { if (err.status !== 1) throw err; patch += String(err.stdout); }
  }
  writeFileSync(join(out, 'counterfactual.patch'), patch);
  const unchanged = JSON.stringify(original) === JSON.stringify(treeHashes(source));
  const result = { date: new Date().toISOString(), method: 'Focused verification of known cases; not new blind discovery', regenerationPreserved: preserved,
    originalFixtureUnchanged: unchanged, recordingOrigin: 'http://localhost:4318', executedOnDistinctOverrideOrigins: targets.buggy.base !== targets.fixed.base, overrideOrigins: [targets.buggy.base, targets.fixed.base],
    checks: summaries, rescoredFrozenFindings: scores, manifestSha256: hash(readFileSync(join(source, 'wreck-manifest.json'))),
    testedSourceSha256,
  };
  writeFileSync(join(out, 'verification.json'), JSON.stringify(result, null, 2)+'\n');
  if (!unchanged) throw new Error('Original fixture changed');
  console.log(`Verified: 6/6 fail buggy, 6/6 pass fixed, custom specs preserved; evidence: ${out}`);
} finally { stop(); }
