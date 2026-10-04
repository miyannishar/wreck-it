import { readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { type Ctx, type Discovery, type Framework, type Pkg, type Routes } from "./types.js";
import { walk, MAX_FILES } from "./walk.js";
import { nextApp, nextPages, hasAppRouter, hasPagesRouter } from "./nextjs.js";
import { servers } from "./servers.js";
import { reactRouter } from "./react-router.js";
import { sveltekit } from "./sveltekit.js";
import { remix } from "./remix.js";
import { forms } from "./forms.js";
import { detectAuth, detectSso } from "./auth.js";
import { detectServices, hardcodedBackend, markApis } from "./services.js";
import { detectDatabase } from "./database.js";

export type { Discovery } from "./types.js";
const MAX_BYTES = 1_000_000;

async function readPkg(root: string, warn: (m: string) => void): Promise<Pkg> {
  try { const v: unknown = JSON.parse(await readFile(join(root, "package.json"), "utf8")); return typeof v === "object" && v && !Array.isArray(v) ? v as Pkg : {}; }
  catch (e) { warn((e as NodeJS.ErrnoException).code === "ENOENT" ? "no package.json; framework detection skipped" : `package.json unreadable: ${(e as Error).message}`); return {}; }
}

export function detectFrameworks(deps: Record<string, string>, files: string[]): Framework[] {
  const has = (re: RegExp) => Object.keys(deps).some((d) => re.test(d));
  const out: Framework[] = [];
  if (has(/^next$/)) {
    const app = hasAppRouter(files), pages = hasPagesRouter(files);
    if (app || !pages) out.push("nextjs-app");
    if (pages) out.push("nextjs-pages");
  }
  if (has(/^@remix-run\//)) out.push("remix");
  if (has(/^(?:react-router|react-router-dom|@react-router\/dev)$/) && !out.includes("remix")) out.push("react-router");
  if (has(/^@sveltejs\/kit$/)) out.push("sveltekit");
  if (has(/^express$/)) out.push("express");
  if (has(/^fastify$/)) out.push("fastify");
  if (has(/^hono$/)) out.push("hono");
  return out;
}

const pmOf = (root: string): string =>
  existsSync(join(root, "pnpm-lock.yaml")) ? "pnpm" : existsSync(join(root, "yarn.lock")) ? "yarn" : existsSync(join(root, "bun.lockb")) || existsSync(join(root, "bun.lock")) ? "bun" : "npm";

export const portFromScript = (s: string | undefined): number | undefined => {
  const m = s && (/(?:^|\s)(?:-p|--port)(?:\s+|=)(\d{2,5})\b/.exec(s) ?? /\bPORT=(\d{2,5})\b/.exec(s));
  return m ? Number(m[1]) : undefined;
};

async function guessBase(root: string, pkg: Pkg, deps: Record<string, string>, fw: Framework[], files: string[]): Promise<{ baseUrl?: string; devScript?: string }> {
  const name = pkg.scripts?.dev ? "dev" : pkg.scripts?.start ? "start" : undefined;
  const pm = pmOf(root);
  const devScript = name ? (pm === "yarn" ? `yarn ${name}` : `${pm} run ${name}`) : undefined;
  let port = portFromScript(name && pkg.scripts?.[name]);
  const vite = "vite" in deps || files.some((f) => /^vite\.config\.[cm]?[jt]s$/.test(f));
  if (!port && vite) {
    const cfg = files.find((f) => /^vite\.config\.[cm]?[jt]s$/.test(f));
    const m = cfg ? /\bserver\s*:\s*\{[^}]*?\bport\s*:\s*(\d{2,5})/.exec(await readFile(join(root, cfg), "utf8").catch(() => "")) : null;
    if (m) port = Number(m[1]);
  }
  if (!port) {
    if (fw.some((f) => f.startsWith("nextjs"))) port = 3000;
    else if (fw.includes("react-router") || fw.includes("sveltekit")) port = 5173;
    else if (fw.includes("remix")) port = vite ? 5173 : 3000;
    else if (fw.length) port = 3000;
    else if (vite) port = 5173;
    else if (devScript) port = 3000;
  }
  return { ...(port ? { baseUrl: `http://localhost:${port}` } : {}), ...(devScript ? { devScript } : {}) };
}

const ADAPTERS: Record<Framework, (ctx: Ctx) => Promise<Routes>> = {
  "nextjs-app": nextApp, "nextjs-pages": nextPages, remix, "react-router": reactRouter, sveltekit,
  express: servers, fastify: servers, hono: servers,
};

/** Static scan of `root`: no network, never throws on missing files. */
export async function discover(root: string): Promise<Discovery> {
  const warnings: string[] = [];
  const warn = (m: string) => { if (!warnings.includes(m)) warnings.push(m); };
  const pkg = await readPkg(root, warn);
  const deps = { ...pkg.devDependencies, ...pkg.dependencies };
  const { files, capped } = await walk(root);
  if (capped) warn(`scan capped at ${MAX_FILES} files; results are partial`);
  const cache = new Map<string, Promise<string>>();
  const read = (f: string) => {
    if (!cache.has(f)) cache.set(f, (async () => { const p = join(root, f); return (await stat(p)).size > MAX_BYTES ? "" : readFile(p, "utf8"); })().catch(() => ""));
    return cache.get(f)!;
  };
  const ctx: Ctx = { root, files, deps, pkg, read, warn };
  const frameworks = detectFrameworks(deps, files);
  if (!frameworks.length) warn("no known framework detected; fall back to crawling");
  const pages = new Map<string, Discovery["pages"][number]>(), api = new Map<string, Discovery["api"][number]>();
  for (const fn of new Set(frameworks.map((f) => ADAPTERS[f]))) {
    const r = await fn(ctx);
    for (const p of r.pages) if (!pages.has(p.path)) pages.set(p.path, p);
    for (const a of r.api) { const k = `${a.method} ${a.path} ${a.file}`; if (!api.has(k)) api.set(k, a); }
  }
  const fs = await forms(ctx);
  const marked = await markApis(ctx, [...api.values()].sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method)));
  const services = await detectServices(ctx);
  // App-wide uses include what handlers do without an SDK package (e.g. fetch to api.openai.com).
  for (const e of marked.flatMap((a) => a.effects ?? [])) if (services && !services.uses.includes(e)) services.uses.push(e);
  return {
    generatedAt: new Date().toISOString(),
    frameworks,
    ...(await guessBase(root, pkg, deps, frameworks, files)),
    pages: [...pages.values()].sort((a, b) => a.path.localeCompare(b.path)),
    api: marked,
    forms: fs,
    auth: await detectSso(ctx).then((sso) => ({ ...detectAuth(deps, files, fs), ...(sso.length ? { sso } : {}) })),
    ...await detectDatabase(root).then(async (database) => { const d = database ?? (await hardcodedBackend(ctx)); return d ? { database: d } : {}; }),
    services,
    warnings,
  };
}
