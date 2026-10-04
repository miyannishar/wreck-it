import { readFile } from "node:fs/promises";
import { loadConfig, type Config } from "./config.js";
import { wreckPaths, type WreckPaths } from "./paths.js";
import { isAllowedTarget } from "./target.js";
import { WreckError } from "./errors.js";
import type { Discovery } from "./discover/types.js";

export const NAV_AWAY = /(^|\/)(log-?out|sign-?out)(\/|$)/i;

export async function readJson<T = any>(file: string): Promise<T | undefined> {
  try { return JSON.parse(await readFile(file, "utf8")) as T; } catch { return undefined; }
}

/** discovery.json is written by `wreck-it discover` but may be missing, stale or hand-edited, so every field is optional. */
export type SavedDiscovery = Partial<Discovery>;
export const readDiscovery = (root: string): Promise<SavedDiscovery | undefined> => readJson<SavedDiscovery>(wreckPaths(root).discovery);

export const pagesOf = (disc: SavedDiscovery | undefined) => (Array.isArray(disc?.pages) ? disc.pages : []);
export const apisOf = (disc: SavedDiscovery | undefined) => (Array.isArray(disc?.api) ? disc.api : []);

/** Routes a scan must not visit: sign-out links, `exclude` from the config, and (for page scans) API routes. */
export function isExcluded(cfg: Config, route: string, opts: { api?: boolean } = {}): boolean {
  return NAV_AWAY.test(route) || (!!opts.api && route.startsWith("/api/")) || cfg.exclude.some((x) => route === x || route.startsWith(x.endsWith("/") ? x : x + "/"));
}

/**
 * For focused runs (`--only /cart /api/cart`): a route is in scope when it is one of the given routes or below one
 * (`/cart` covers `/cart/checkout`). Dynamic routes count by their pattern (`/products/[id]` is below `/products`).
 * No `only` means everything is in scope.
 */
export function inScope(route: string, only?: string[]): boolean {
  if (!only?.length) return true;
  const path = route.split("?")[0]!;
  return only.some((o) => { const p = o.replace(/\/+$/, "") || "/"; return p === "/" ? path === "/" : path === p || path.startsWith(p + "/"); });
}

/** Throws exit-code-3 unless `url` is a machine the user owns (or `--i-own-this` / `iOwnThis` says so). */
export function assertAllowedTarget(url: string, cfg: Config, iOwnThis?: boolean): void {
  const chk = isAllowedTarget(url, { iOwnThis: iOwnThis || cfg.iOwnThis });
  if (!chk.ok) throw new WreckError(chk.reason, 3);
}

export interface Target { p: WreckPaths; cfg: Config; disc: SavedDiscovery | undefined; base: string }

/** Config, discovery and base URL for a scan: `--base-url`, then config, then discovery, then localhost:3000. */
export async function loadTarget(root: string, baseUrl?: string): Promise<Target> {
  const cfg = await loadConfig(root);
  const disc = await readDiscovery(root);
  return { p: wreckPaths(root), cfg, disc, base: baseUrl ?? cfg.baseUrl ?? disc?.baseUrl ?? "http://localhost:3000" };
}

/** `loadTarget`, then refuse to touch a base URL that isn't allowed. */
export async function resolveTarget(root: string, opts: { baseUrl?: string; iOwnThis?: boolean }): Promise<Target> {
  const t = await loadTarget(root, opts.baseUrl);
  assertAllowedTarget(t.base, t.cfg, opts.iOwnThis);
  return t;
}

export type SideEffect = "ai" | "sms" | "email" | "payments";
const routeRe = (p: string) => new RegExp("^" + p.split("/").map((s) => (/^\[.+\]$|^:/.test(s) ? "[^/]+" : s.replace(/[.*+?^${}()|\\]/g, "\\$&"))).join("/") + "/?$");

/** Side effects discovery found in the handler for `method path` (any method when the route has one handler file). */
export function effectsFor(disc: SavedDiscovery | undefined, method: string, path: string): SideEffect[] {
  const hits = apisOf(disc).filter((a) => (a.method === method || a.method === "ANY") && routeRe(a.path).test(path));
  return [...new Set(hits.flatMap((a) => a.effects ?? []))];
}

/** Effects not allowed by config (`allowSideEffects`) or by a one-off override. */
export const blockedEffects = (cfg: Config, effects: SideEffect[], override?: boolean): SideEffect[] =>
  override ? [] : effects.filter((e) => !cfg.allowSideEffects.includes(e));

export const EFFECT_WORDS: Record<SideEffect, string> = { ai: "paid AI calls", sms: "real text messages", email: "real emails", payments: "payments" };
