import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { isAllowedTarget } from "./target.js";
import { loadConfig } from "./config.js";
import { wreckPaths } from "./paths.js";

export interface PreflightResult {
  url: string; allowed: boolean; reason: string; reachable: boolean; status?: number; devScript?: string;
  playwrightMcp: { found: boolean; sources: string[] };
  installHints: Record<string, string>;
  warnings: string[];
}

const PW = "npx @playwright/mcp@latest";
const jsonHint = (file: string, key: string) =>
  `Add to ${file}:\n${JSON.stringify({ [key]: { playwright: { command: "npx", args: ["@playwright/mcp@latest"] } } }, null, 2)}`;
export const INSTALL_HINTS: Record<string, string> = {
  "claude-code": `claude mcp add playwright -- ${PW}`,
  codex: `codex mcp add playwright -- ${PW}`,
  cursor: jsonHint(".cursor/mcp.json", "mcpServers"),
  gemini: `gemini mcp add playwright ${PW}`,
  vscode: jsonHint(".vscode/mcp.json", "servers"),
};

const readText = (f: string) => readFile(f, "utf8").catch(() => undefined);
const readJson = async (f: string): Promise<any> => { try { return JSON.parse((await readText(f)) ?? ""); } catch { return undefined; } };

function jsonHasPlaywright(v: unknown, inServers = false): boolean {
  if (typeof v !== "object" || v === null) return false;
  for (const [k, val] of Object.entries(v)) {
    if (inServers && (k.toLowerCase().includes("playwright") || JSON.stringify(val).toLowerCase().includes("playwright"))) return true;
    if (jsonHasPlaywright(val, k === "mcpServers" || k === "servers" || k === "mcp_servers")) return true;
  }
  return false;
}

export async function detectPlaywrightMcp(root: string, home = process.env.WRECK_IT_HOME ?? homedir()): Promise<{ found: boolean; sources: string[] }> {
  const files = [
    join(root, ".mcp.json"), join(root, ".claude-plugin", ".mcp.json"), join(root, ".cursor", "mcp.json"), join(root, ".vscode", "mcp.json"),
    join(root, ".gemini", "settings.json"), join(home, ".claude.json"), join(home, ".cursor", "mcp.json"),
    join(home, ".gemini", "settings.json"), join(home, ".codex", "config.toml"),
  ];
  const sources: string[] = [];
  for (const f of files) {
    const txt = await readText(f);
    if (txt === undefined) continue;
    if (f.endsWith(".toml")) { if (/playwright/i.test(txt)) sources.push(f); continue; }
    let j: unknown;
    try { j = JSON.parse(txt); } catch { if (/playwright/i.test(txt)) sources.push(f); continue; }
    if (jsonHasPlaywright(j)) sources.push(f);
  }
  // Claude Code plugins (the wreck-it plugin bundles wreck-browser-1..3; the official playwright plugin bundles one).
  const installed = await readJson(join(home, ".claude", "plugins", "installed_plugins.json"));
  for (const k of Object.keys(installed?.plugins ?? {})) {
    if (/^(wreck-it|playwright)@/.test(k)) sources.push(`claude-code plugin ${k}`);
  }
  return { found: sources.length > 0, sources };
}

export async function checkReachable(url: string, waitSec: number): Promise<{ reachable: boolean; status?: number }> {
  const deadline = Date.now() + waitSec * 1000;
  for (;;) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(3000), redirect: "manual" });
      await r.body?.cancel().catch(() => {});
      return { reachable: true, status: r.status };
    } catch { /* retry */ }
    if (Date.now() + 500 > deadline) return { reachable: false };
    await new Promise((r) => setTimeout(r, 500));
  }
}

export async function runPreflight(opts: { root: string; url?: string; iOwnThis?: boolean; wait?: number }): Promise<PreflightResult> {
  const { root } = opts;
  const cfg = await loadConfig(root);
  const disc = await readJson(wreckPaths(root).discovery);
  const pkg = await readJson(join(root, "package.json"));
  const url = opts.url ?? cfg.baseUrl ?? disc?.baseUrl ?? "http://localhost:3000";
  const check = isAllowedTarget(url, { iOwnThis: opts.iOwnThis || cfg.iOwnThis });
  const warnings: string[] = [];
  const devScript: string | undefined = disc?.devScript ?? (typeof pkg?.scripts?.dev === "string" ? "npm run dev" : undefined);
  const gi = await readText(join(root, ".gitignore"));
  if (gi === undefined || !gi.includes(".wreck-it")) warnings.push(".gitignore does not mention .wreck-it/ (findings and screenshots may be committed)");
  const playwrightMcp = await detectPlaywrightMcp(root);
  if (!playwrightMcp.found) warnings.push("Playwright MCP not found in any known agent config; see installHints");
  const net = check.ok ? await checkReachable(url, opts.wait ?? 0) : { reachable: false };
  if (check.ok && !net.reachable) warnings.push(devScript ? `app not reachable at ${url}; start it with: ${devScript}` : `app not reachable at ${url}`);
  return {
    url, allowed: check.ok, reason: check.reason, reachable: net.reachable, ...("status" in net ? { status: net.status } : {}),
    ...(devScript ? { devScript } : {}), playwrightMcp, installHints: INSTALL_HINTS, warnings,
  };
}

export const preflightExitCode = (r: PreflightResult): number => (!r.allowed ? 3 : !r.reachable ? 4 : 0);

export function formatPreflight(r: PreflightResult): string {
  const l = [
    `target     ${r.url}  ${r.allowed ? "allowed" : "REFUSED"} (${r.reason})`,
    `reachable  ${r.reachable ? `yes (HTTP ${r.status})` : "no"}`,
    `dev script ${r.devScript ?? "unknown"}`,
    `playwright MCP  ${r.playwrightMcp.found ? `found in ${r.playwrightMcp.sources.join(", ")}` : "not found"}`,
  ];
  if (!r.playwrightMcp.found) for (const [a, h] of Object.entries(r.installHints)) l.push(`  ${a}: ${h.split("\n").join("\n    ")}`);
  for (const w of r.warnings) l.push(`warning: ${w}`);
  return l.join("\n") + "\n";
}
