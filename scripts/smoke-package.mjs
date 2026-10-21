#!/usr/bin/env node
// Verify a tarball or registry install without using this checkout's CLI/dependencies.
// node scripts/smoke-package.mjs --project /absolute/clean-project --version 0.2.0
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';

const args = process.argv.slice(2);
const arg = (name) => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
assert(arg('--project') && arg('--version'), 'Supply --project and --version');
const project = resolve(arg('--project'));
const version = arg('--version');
const installed = join(project, 'node_modules/@miyanishar/wreck-it');
const pkg = JSON.parse(readFileSync(join(installed, 'package.json'), 'utf8'));
const bin = join(project, 'node_modules/.bin/wreck-it');
const run = (...argv) => execFileSync(bin, argv, { cwd: project, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000 });
assert.equal(pkg.version, version);
assert.equal(run('--version').trim(), version);
assert(existsSync(join(installed, 'LICENSE')) && existsSync(join(installed, 'README.md')), 'Package documentation/license');
assert(run('gen-tests', '--help').includes('--force'));
const schema = JSON.stringify(JSON.parse(run('schema', 'finding')));
for (const kind of ['waitFor', 'value', 'textMatches', 'imageLoaded', 'linkResolves']) assert(schema.includes('"const":"'+kind+'"'), kind);

const root = mkdtempSync(join(project, 'package-smoke-'));
mkdirSync(join(root, '.wreck-it'));
writeFileSync(join(root, '.wreck-it/config.json'), JSON.stringify({ baseUrl: 'http://localhost:12345' }));
const target = (value) => ({ by: 'css', value });
// Synthetic local fixture metadata; this is a packaging check, not an app bug report.
const finding = {
  title: 'Release fixture exercises generated assertions', category: 'functional', severity: 'low', persona: 'release-smoke', route: '/', reproduced: true,
  expected: 'The synthetic healthy fixture satisfies all supported assertions', actual: 'Synthetic metadata used only to smoke-test the installed CLI',
  steps: [
    { action: 'goto', url: 'http://localhost:12345/' },
    { action: 'click', target: { by: 'role', role: 'button', name: 'Validate', exact: true } },
    { action: 'waitFor', target: target('#feedback'), state: 'visible' },
    { action: 'http', method: 'GET', url: 'http://localhost:12345/api/health' },
  ],
  assertions: [
    { kind: 'value', target: { by: 'label', value: 'Name' }, equals: 'Release Shopper' },
    { kind: 'text', target: target('#feedback'), contains: 'Validation complete' },
    { kind: 'textMatches', target: target('#date'), pattern: '\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}', negate: true },
    { kind: 'imageLoaded', target: target('#logo') },
    { kind: 'linkResolves', target: { by: 'role', role: 'link', name: 'Pricing', exact: true } },
    { kind: 'httpStatus', equals: 200 },
  ],
};
const input = join(root, 'input.json'); writeFileSync(input, JSON.stringify(finding));
const added = JSON.parse(run('finding', 'add', '--file', input, '--root', root));
assert.equal(added.id, 'WR-001');
run('gen-tests', '--root', root);
const spec = join(root, 'tests/wreck-it/WR-001.spec.ts');
const generated = readFileSync(spec, 'utf8');
assert(!generated.includes('page.goto("http://localhost:12345'));
assert(!generated.includes('page.request.fetch("http://localhost:12345'));
const custom = generated+'\n// release-smoke custom edit\n'; writeFileSync(spec, custom);
const fixture = join(root, 'tests/wreck-it/fixtures.ts'); writeFileSync(fixture, '// release-smoke sidecar\n');
run('gen-tests', '--root', root); run('gen-tests', '--root', root);
assert.equal(readFileSync(spec, 'utf8'), custom);
assert.equal(readFileSync(fixture, 'utf8'), '// release-smoke sidecar\n');
run('gen-tests', '--force', '--root', root);
assert.equal(readFileSync(spec, 'utf8'), generated);
assert.equal(readFileSync(fixture, 'utf8'), '// release-smoke sidecar\n');
run('report', '--root', root);
assert(existsSync(join(root, '.wreck-it/report.html')) && existsSync(join(root, '.wreck-it/report.md')));

const hits = [];
const server = createServer((req, res) => {
  hits.push(req.url);
  if (req.url === '/api/health') { res.setHeader('content-type', 'application/json'); res.end('{"ok":true}'); return; }
  if (req.url === '/logo.svg') { res.setHeader('content-type', 'image/svg+xml'); res.end('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="blue"/></svg>'); return; }
  res.setHeader('content-type', 'text/html');
  res.end('<!doctype html><html><body><main><h1>Release fixture</h1><label>Name<input value="Release Shopper"></label><button onclick="setTimeout(()=>{document.getElementById(\'feedback\').hidden=false},900)">Validate</button><p id="feedback" hidden>Validation complete</p><p id="date">Placed Oct 21, 2026</p><img id="logo" src="/logo.svg" alt="Logo"><a href="/pricing">Pricing</a></main></body></html>');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const resultFile = join(root, 'playwright-result.json');
try {
  const playwright = join(project, 'node_modules/@playwright/test/cli.js');
  assert(existsSync(playwright), 'Clean project must also have @playwright/test installed');
  // The server is in this process; spawn asynchronously so it can answer browser requests.
  await promisify(execFile)(process.execPath, [playwright, 'test', '--config', join(root, 'playwright.config.ts'), '--workers=1', '--reporter=json', '--output', join(root, 'results')], {
    cwd: project, env: { ...process.env, WRECK_IT_BASE_URL: base, PLAYWRIGHT_JSON_OUTPUT_FILE: resultFile }, timeout: 60_000, maxBuffer: 5e6,
  });
  const result = JSON.parse(readFileSync(resultFile, 'utf8'));
  assert.equal(result.stats.expected, 1); assert.equal(result.stats.unexpected, 0); assert.equal(result.stats.skipped, 0);
  assert(hits.includes('/api/health') && hits.includes('/pricing') && hits.includes('/logo.svg'));
  const summary = { version, installedPackage: pkg.name, cliVersion: run('--version').trim(), newSchemaKinds: true,
    regenerationPreservesEdits: true, forceReplacesSpec: true, sidecarPreserved: true, htmlAndMarkdownReports: true,
    generatedBrowserCheck: { passed: result.stats.expected, failed: result.stats.unexpected, skipped: result.stats.skipped },
    appOriginOverride: true, completedAt: new Date().toISOString(), node: process.version,
  };
  writeFileSync(join(project, 'package-smoke.json'), JSON.stringify(summary, null, 2)+'\n');
  console.log(JSON.stringify(summary, null, 2));
} finally { await new Promise((r) => server.close(r)); }
