#!/usr/bin/env node
// Recording fixture and known-bug replay; never use this as a discovery benchmark.
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync, createWriteStream } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn, execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:net';
import { createHash, randomUUID } from 'node:crypto';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const demo = join(repo, '.wreck-it/demo');
const source = join(repo, 'examples/buggy-app');
const app = join(demo, 'app');
const fixed = join(demo, 'fixed');
const replay = join(demo, 'replay');
const sample = join(repo, 'docs/demo/sample');
const marker = join(demo, 'setup.json');
const version = '0.2.0';
const playwrightVersion = '1.63.0';
const cli = join(app, 'node_modules/@miyanishar/wreck-it/dist/cli.js');
const next = join(app, 'node_modules/next/dist/bin/next');
const pw = join(app, 'node_modules/@playwright/test/cli.js');
const broken = 'const subtotal = items.reduce((sum, item) => sum + item.price, 0);';
const corrected = 'const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0);';
const env = { ...process.env, NEXT_TELEMETRY_DISABLED: '1' };
const children = new Set();
const json = (file, value) => writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
const hash = text => createHash('sha256').update(text).digest('hex');
const wait = ms => new Promise(r => setTimeout(r, ms));
const run = (command, args, cwd = repo) => execFileSync(command, args, { cwd, env, stdio: 'inherit' });
const wreck = (...args) => execFileSync(process.execPath, [cli, ...args, '--root', replay], { cwd: replay, env, encoding: 'utf8', maxBuffer: 5e6 });
const freePort = async () => {
  const socket = createServer();
  await new Promise((r, j) => { socket.once('error', j); socket.listen(0, '127.0.0.1', r); });
  const port = socket.address().port;
  await new Promise(r => socket.close(r));
  return port;
};
function copyApp(to) {
  mkdirSync(to, { recursive: true });
  // Allowlist excludes .env, node_modules, old runs, and the benchmark answer key.
  for (const name of ['app', 'components', 'lib', 'public', 'next.config.ts', 'tsconfig.json', 'package.json', 'package-lock.json']) {
    cpSync(join(source, name), join(to, name), { recursive: true });
  }
  writeFileSync(join(to, '.gitignore'), 'node_modules/\n.next/\n.wreck-it/\ntest-results/\nplaywright-report/\n');
}
function requirePrepared() {
  assert(existsSync(marker), 'Run npm run demo:prepare first.');
  assert.equal(JSON.parse(readFileSync(marker)).kind, 'wreck-it-product-demo');
  for (const file of [cli, next, pw, join(app, '.next/BUILD_ID'), join(fixed, '.next/BUILD_ID')]) {
    assert(existsSync(file), `Missing recording dependency/build: ${file}. Run demo:prepare -- --reset.`);
  }
}
async function stopChildren() {
  await Promise.all([...children].map(child => new Promise(resolve => {
    if (child.exitCode !== null || child.signalCode !== null) { children.delete(child); resolve(); return; }
    const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
    child.once('exit', () => { clearTimeout(timer); children.delete(child); resolve(); });
    child.kill('SIGTERM');
  })));
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await stopChildren(); process.exit(signal === 'SIGINT' ? 130 : 143); });
async function serve(dir, port, label) {
  const guard = createServer();
  await new Promise((ready, reject) => { guard.once('error', reject); guard.listen(port, '127.0.0.1', ready); });
  await new Promise(ready => guard.close(ready));
  const log = createWriteStream(join(demo, `${label}.log`), { flags: 'w' });
  const child = spawn(process.execPath, [next, 'start', '--hostname', '127.0.0.1', '--port', String(port)], { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] });
  children.add(child);
  child.stdout.pipe(log); child.stderr.pipe(log);
  child.once('exit', () => log.end());
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error(`${label} could not start. Check ${label}.log (the port may be occupied).`);
    try { if ((await fetch(url + '/pricing', { signal: AbortSignal.timeout(500) })).ok) return url; } catch {}
    await wait(200);
  }
  throw new Error(`${label} did not become ready; check ${label}.log.`);
}
async function prepare() {
  mkdirSync(demo, { recursive: true });
  if (existsSync(app)) {
    assert(existsSync(marker), `Refusing to replace an unmarked folder: ${app}`);
    assert.equal(JSON.parse(readFileSync(marker)).kind, 'wreck-it-product-demo');
    if (!process.argv.includes('--reset')) { requirePrepared(); console.log('Demo already prepared. Use demo:start or demo:verify. To discard edits in the generated copies: npm run demo:prepare -- --reset'); return; }
    for (const name of ['app', 'fixed', 'replay']) rmSync(join(demo, name), { recursive: true, force: true });
  }
  json(marker, { kind: 'wreck-it-product-demo', cliVersion: version, preparedAt: new Date().toISOString() });
  copyApp(app);
  console.log('Installing isolated app dependencies and the published CLI; repository dependencies stay untouched.');
  run('npm', ['ci', '--no-audit', '--no-fund'], app);
  run('npm', ['install', '--no-save', '--package-lock=false', '--no-audit', '--no-fund', `@miyanishar/wreck-it@${version}`, `@playwright/test@${playwrightVersion}`], app);
  assert.equal(execFileSync(process.execPath, [cli, '--version'], { encoding: 'utf8' }).trim(), version);
  run(process.execPath, [pw, 'install', 'chromium'], app);
  copyApp(fixed);
  symlinkSync(join(app, 'node_modules'), join(fixed, 'node_modules'), 'dir');
  const file = join(fixed, 'lib/cart.ts'), text = readFileSync(file, 'utf8');
  assert(text.includes(broken), 'Demo source changed: review the expected bug before recording.');
  writeFileSync(file, text.replace(broken, corrected));
  for (const dir of [app, fixed]) {
    mkdirSync(join(dir, '.wreck-it'), { recursive: true });
    json(join(dir, '.wreck-it/config.json'), { baseUrl: `http://127.0.0.1:${dir === app ? 3100 : 3101}`, accounts: [{ label: 'main', email: 'demo@gadgetly.test', password: 'gadgetly123' }] });
    console.log(`Building ${dir === app ? 'buggy' : 'corrected'} recording copy…`);
    run(process.execPath, [next, 'build', '--webpack'], dir);
  }
  console.log('\nReady. Run npm run demo:verify to create screenshots, a sample report, and fail/pass evidence. Then npm run demo:start.');
}
async function verify() {
  requirePrepared();
  const original = readFileSync(join(source, 'lib/cart.ts'), 'utf8');
  assert.equal(readFileSync(join(app, 'lib/cart.ts'), 'utf8'), original, 'Recording copy was edited; reset it before replay verification.');
  assert.equal(readFileSync(join(fixed, 'lib/cart.ts'), 'utf8'), original.replace(broken, corrected), 'Corrected copy differs from the intended one-line change.');
  const browserModule = await import(pathToFileURL(join(app, 'node_modules/playwright/index.mjs')).href);
  mkdirSync(join(replay, '.wreck-it/shots'), { recursive: true });
  if (!existsSync(join(replay, 'node_modules'))) symlinkSync(join(app, 'node_modules'), join(replay, 'node_modules'), 'dir');
  json(join(replay, 'package.json'), { name: 'gadgetly-scripted-checkout-replay', private: true });
  const buggyUrl = await serve(app, await freePort(), 'verify-buggy');
  const fixedUrl = await serve(fixed, await freePort(), 'verify-fixed');
  const recordingUrl = 'http://127.0.0.1:3100';
  json(join(replay, '.wreck-it/config.json'), { baseUrl: recordingUrl });
  wreck('run', 'init', '--fresh', '--focus', 'checkout — scripted single-bug replay');
  const browser = await browserModule.chromium.launch();
  const shots = join(replay, '.wreck-it/shots');
  const replayFlow = async (baseURL, prefix, expectedTotal) => {
    const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    try {
      const signup = await context.request.post('/api/auth/signup', { data: { displayName: 'wreck-it Demo Shopper', email: `wreck-it-demo-${randomUUID()}@gadgetly.test`, password: 'demo-video-123' } });
      assert.equal(signup.status(), 201, 'Local test account created');
      const added = await context.request.post('/api/cart', { data: { productId: '1', quantity: 1 } });
      assert.equal(added.status(), 201);
      const page = await context.newPage();
      await page.goto('/cart');
      const qty = page.getByLabel('Quantity for Aurora Wireless Earbuds');
      await qty.waitFor();
      await qty.fill('3');
      const update = page.waitForResponse(r => r.url().endsWith('/api/cart') && r.request().method() === 'PATCH');
      await qty.press('Tab');
      assert.equal((await update).status(), 200);
      await page.getByRole('cell', { name: '$239.97', exact: true }).waitFor();
      await page.screenshot({ path: join(shots, `${prefix}-cart.png`) });
      await page.getByRole('link', { name: 'Checkout', exact: true }).click();
      await page.getByRole('heading', { name: 'Order summary', exact: true }).waitFor();
      assert((await page.locator('.summary-total').innerText()).includes(expectedTotal));
      assert((await page.locator('.summary-row').first().innerText()).includes('$239.97'));
      await page.screenshot({ path: join(shots, `${prefix}-checkout.png`) });
    } finally { await context.close(); }
  };
  try {
    await replayFlow(buggyUrl, 'buggy', '$79.99');
    await replayFlow(buggyUrl, 'reproduced', '$79.99');
    await replayFlow(fixedUrl, 'fixed', '$239.97');
  } finally { await browser.close(); }
  const target = { by: 'label', value: 'Quantity for Aurora Wireless Earbuds' };
  const sourceLine = original.split('\n').findIndex(line => line.includes(broken)) + 1;
  assert(sourceLine > 0);
  const input = {
    title: 'Checkout total ignores item quantity', category: 'functional', severity: 'high', persona: 'scripted-demo-replay', route: '/checkout', reproduced: true,
    expected: 'Three Aurora Wireless Earbuds at $79.99 each total $239.97, with no coupon.',
    actual: 'The line total is $239.97 but the cart subtotal and checkout total show $79.99.',
    source: { file: 'lib/cart.ts', line: sourceLine, confidence: 'high', snippet: broken, why: 'The subtotal adds each unit price once instead of summing price multiplied by quantity (lineTotal). The corrected copy changes this one expression.' },
    evidence: { screenshots: ['.wreck-it/shots/buggy-cart.png', '.wreck-it/shots/buggy-checkout.png'], console: [], network: [] },
    steps: [
      { action: 'http', method: 'POST', url: `${recordingUrl}/api/auth/signup`, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ displayName: 'wreck-it Demo Shopper', email: 'wreck-it-demo-{{unique}}@gadgetly.test', password: 'demo-video-123' }) },
      { action: 'http', method: 'POST', url: `${recordingUrl}/api/cart`, headers: { 'content-type': 'application/json' }, body: '{"productId":"1","quantity":1}' },
      { action: 'goto', url: `${recordingUrl}/cart` }, { action: 'fill', target, value: '3' }, { action: 'press', target, key: 'Tab' },
      { action: 'waitFor', target: { by: 'role', role: 'cell', name: '$239.97', exact: true }, state: 'visible' },
      { action: 'click', target: { by: 'role', role: 'link', name: 'Checkout', exact: true } },
      { action: 'waitFor', target: { by: 'role', role: 'heading', name: 'Order summary', exact: true }, state: 'visible' }
    ],
    assertions: [{ kind: 'text', target: { by: 'css', value: '.summary-total' }, contains: '$239.97' }]
  };
  const inputFile = join(replay, 'finding-input.json'); json(inputFile, input);
  const addedFinding = JSON.parse(wreck('finding', 'add', '--file', inputFile));
  assert.deepEqual(addedFinding.warnings, [], 'Every screenshot must resolve before recording the finding.');
  console.log(JSON.stringify(addedFinding));
  // This replay does not run agent discovery, personas, chaos, accessibility, or load.
  for (const stage of ['preflight', 'discover', 'personas', 'explore', 'chaos', 'load', 'security']) wreck('run', 'stage', stage, 'skipped');
  for (const stage of ['normal', 'trace', 'report']) wreck('run', 'stage', stage, 'done');
  for (const route of ['/cart', '/checkout']) wreck('run', 'visit', route, '--persona', 'scripted-demo-replay');
  console.log(wreck('gen-tests').trim());
  const testedSpecHash = hash(readFileSync(join(replay, 'tests/wreck-it/WR-001.spec.ts')));
  const results = {};
  for (const [label, baseURL] of [['buggy', buggyUrl], ['fixed', fixedUrl]]) {
    const output = join(replay, `${label}-result.json`);
    let code = 0;
    try {
      await promisify(execFile)(process.execPath, [pw, 'test', '--config', join(replay, 'playwright.config.ts'), '--workers=1', '--retries=0', '--reporter=json', '--output', join(replay, `${label}-results`)], {
        cwd: replay, env: { ...env, WRECK_IT_BASE_URL: baseURL, PLAYWRIGHT_JSON_OUTPUT_FILE: output }, timeout: 90_000, maxBuffer: 5e6
      });
    } catch (error) { if (!Number.isInteger(error.code)) throw error; code = error.code; }
    assert(existsSync(output), `No Playwright result for ${label}`);
    const result = JSON.parse(readFileSync(output));
    assert.equal(result.stats.skipped, 0);
    if (label === 'buggy') {
      assert.equal(code, 1); assert.equal(result.stats.unexpected, 1);
      const failure = JSON.stringify(result.suites);
      assert(failure.includes('toContainText') && failure.includes('$239.97') && failure.includes('$79.99'), 'Failure must be the total assertion, not a setup error or timeout.');
      assert(!failure.includes('Test timeout of'), 'A test timeout is not a useful regression failure.');
    } else { assert.equal(code, 0); assert.equal(result.stats.expected, 1); assert.equal(result.stats.unexpected, 0); }
    results[label] = { passed: result.stats.expected, failed: result.stats.unexpected, skipped: result.stats.skipped, exitCode: code };
    console.log(`${label}: ${results[label].passed} passed, ${results[label].failed} failed, ${results[label].skipped} skipped`);
  }
  const reportOutput = wreck('report');
  assert(!/warning/i.test(reportOutput), `Report must have complete screenshot evidence: ${reportOutput}`);
  assert(!readFileSync(join(replay, '.wreck-it/report.md'), 'utf8').includes('## Warnings'), 'Resolve report warnings before exporting the sample.');
  assert.equal(readFileSync(join(source, 'lib/cart.ts'), 'utf8'), original, 'Original benchmark fixture stays intact.');
  mkdirSync(join(sample, 'shots'), { recursive: true });
  for (const name of ['buggy-cart.png', 'buggy-checkout.png', 'fixed-cart.png', 'fixed-checkout.png']) cpSync(join(shots, name), join(sample, 'shots', name));
  cpSync(join(replay, 'tests/wreck-it/WR-001.spec.ts'), join(sample, 'WR-001.spec.ts'));
  assert.equal(hash(readFileSync(join(sample, 'WR-001.spec.ts'))), testedSpecHash);
  const note = 'Scripted replay of one known bug in the seeded Gadgetly demo. This is a product walkthrough sample, not a fresh agent discovery run or a whole-app assessment.';
  const md = readFileSync(join(replay, '.wreck-it/report.md'), 'utf8');
  writeFileSync(join(sample, 'report.md'), `> ${note}\n\n${md}`);
  const html = readFileSync(join(replay, '.wreck-it/report.html'), 'utf8');
  writeFileSync(join(sample, 'report.html'), html.replace('<body>', `<body><aside style="padding:16px 24px;background:#152337;color:#eef5ff;font:16px/1.5 system-ui">${note}</aside>`));
  const evidence = { kind: 'scripted-product-demo', verifiedAt: new Date().toISOString(), cliPackage: '@miyanishar/wreck-it', cliVersion: version, playwrightVersion, finding: 'WR-001', source: `lib/cart.ts:${sourceLine}`, patch: { before: broken, after: corrected }, reproducedInFreshContexts: 2, results, sameSpecSha256: hash(readFileSync(join(sample, 'WR-001.spec.ts'))), originalCartSourceSha256: hash(original), originalFixtureUnchanged: true };
  json(join(sample, 'verification.json'), evidence);
  writeFileSync(join(sample, 'test-results.txt'), `Published CLI: @miyanishar/wreck-it ${version}\n\nGenerated check: WR-001 — Checkout total ignores item quantity\nExpected checkout total: $239.97\n\nBUGGY COPY\nReceived: Total $79.99\n1 failed at toContainText('$239.97'); 0 skipped\n\nCORRECTED COPY\nReceived: Total $239.97\n1 passed; 0 skipped\n\nIdentical test; only lib/cart.ts subtotal expression differs.\nScripted known-bug replay, not a new discovery benchmark.\n`);
  console.log(`\nVerified. Sample report and screenshots: ${sample}`);
}
async function start() {
  requirePrepared();
  const buggyURL = await serve(app, 3100, 'recording-buggy');
  const fixedURL = await serve(fixed, 3101, 'recording-fixed');
  console.log(`\nBuggy app: ${buggyURL}/login?next=/products/1\nCorrected app: ${fixedURL}/login?next=/products/1\nFake account: demo@gadgetly.test / gadgetly123\nSample report: ${join(sample, 'report.html')}\n\nKeep this terminal open. Ctrl+C stops both demo servers.\n`);
  await Promise.race([...children].map(child => new Promise((_, reject) => child.once('exit', code => reject(new Error(`Demo server stopped (${code}).`))))));
}
async function agent() {
  requirePrepared();
  console.log('Opening Claude Code in the buggy recording copy with the local wreck-it plugin. Paste docs/demo/prompt.txt from the repository.');
  const child = spawn('claude', ['--plugin-dir', repo], { cwd: app, env, stdio: 'inherit' });
  await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Claude exited ${code}`))); });
}
try {
  const command = process.argv[2];
  assert(['prepare', 'start', 'verify', 'agent'].includes(command), 'Use prepare | start | verify | agent');
  await ({ prepare, start, verify, agent })[command]();
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { await stopChildren(); }
