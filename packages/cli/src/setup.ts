import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { dirname, join, resolve } from "node:path";
import { chromium } from "playwright";
import { runCommand } from "./io.js";
import { playwrightInstall } from "./browser.js";

/**
 * Playwright MCP, pinned so the browser build it expects doesn't change under the user, running Playwright's own
 * Chromium (no Google Chrome needed), with the extra tool groups the skills use: route mocking and offline mode,
 * cookies and storage, locator generation, tracing and video.
 */
export const PLAYWRIGHT_MCP_VERSION = "0.0.83";
export const PLAYWRIGHT_MCP_PKG = `@playwright/mcp@${PLAYWRIGHT_MCP_VERSION}`;
export const PLAYWRIGHT_MCP_ARGS = [PLAYWRIGHT_MCP_PKG, "--browser", "chromium", "--isolated", "--caps", "network,storage,testing,devtools"];
/** Chrome DevTools MCP for performance traces, throttling and Lighthouse; nothing is sent to Google's CrUX or usage statistics. */
export const DEVTOOLS_MCP_ARGS = ["chrome-devtools-mcp@1.10.1", "--headless=true", "--isolated=true", "--performanceCrux=false", "--usageStatistics=false"];

export const AGENTS = ["claude-code", "codex", "cursor", "gemini", "vscode"] as const;
export type Agent = (typeof AGENTS)[number];
export interface StepResult { id: string; label: string; action: "already" | "done" | "would-run" | "failed" | "skipped"; detail: string }
export interface SetupResult { agents: Agent[]; steps: StepResult[]; restartNeeded: boolean; ok: boolean }

// setup's commands and arguments are fixed (npx, claude, codex, uvx…), so Windows may use a shell to find `.cmd` shims.
const run = (cmd: string, args: string[], timeout?: number) => runCommand(cmd, args, timeout, { shell: platform() === "win32" });
/** Install folders Playwright MCP needs for its browser; all present means it is installed. */
async function mcpBrowserDirs(): Promise<string[] | undefined> {
  const r = await run("npx", ["-y", PLAYWRIGHT_MCP_PKG, "install-browser", "chromium", "--dry-run"], 5 * 60_000);
  const dirs = [...r.out.matchAll(/Install location:\s+(.+)/g)].map((m) => m[1]!.trim());
  return r.code === 0 && dirs.length ? dirs : undefined;
}
async function mcpBrowserInstalled(): Promise<boolean> {
  const dirs = await mcpBrowserDirs();
  return !!dirs && dirs.every((d) => existsSync(d));
}

const onPath = async (cmd: string) => (await run(cmd, ["--version"], 20_000)).code === 0;
const readText = (f: string) => readFile(f, "utf8").catch(() => undefined);

const NODE_MIN = [22, 19] as const;
export function nodeOk(v = process.versions.node): boolean {
  const [maj, min] = v.split(".").map(Number) as [number, number];
  return maj > NODE_MIN[0] || (maj === NODE_MIN[0] && min >= NODE_MIN[1]);
}

export function chromePath(): string | undefined {
  const p = platform();
  const candidates = p === "darwin" ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", join(homedir(), "Applications/Google Chrome.app/Contents/MacOS/Google Chrome")]
    : p === "win32" ? [join(process.env.PROGRAMFILES ?? "C:\\Program Files", "Google\\Chrome\\Application\\chrome.exe"), join(process.env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)", "Google\\Chrome\\Application\\chrome.exe"), join(process.env.LOCALAPPDATA ?? "", "Google\\Chrome\\Application\\chrome.exe")]
    : ["/opt/google/chrome/chrome", "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable"];
  return candidates.find((c) => existsSync(c));
}

/** Agent config files and whether they mention a server whose command or name matches `re`. */
export async function mcpSources(root: string, re: RegExp, home = process.env.WRECK_IT_HOME ?? homedir()): Promise<string[]> {
  const files = [
    join(root, ".mcp.json"), join(root, ".cursor", "mcp.json"), join(root, ".vscode", "mcp.json"), join(root, ".gemini", "settings.json"),
    join(home, ".claude.json"), join(home, ".cursor", "mcp.json"), join(home, ".gemini", "settings.json"), join(home, ".codex", "config.toml"),
  ];
  const out: string[] = [];
  for (const f of files) {
    const txt = await readText(f);
    if (txt === undefined) continue;
    if (f.endsWith(".toml")) { if (re.test(txt)) out.push(f); continue; }
    let j: any;
    try { j = JSON.parse(txt); } catch { if (re.test(txt)) out.push(f); continue; }
    // ~/.claude.json keeps user servers under mcpServers and per-project ones under projects[path].mcpServers; only this project's count.
    const blocks = [j?.mcpServers, j?.servers, j?.mcp_servers, j?.projects?.[resolve(root)]?.mcpServers];
    if (blocks.some((b) => b && re.test(JSON.stringify(b)))) out.push(f);
  }
  const installed = await readText(join(home, ".claude", "plugins", "installed_plugins.json"));
  // The wreck-it plugin bundles Playwright MCP (×3) and Chrome DevTools MCP.
  for (const k of Object.keys((installed && JSON.parse(installed)?.plugins) ?? {})) {
    if (/^wreck-it@/.test(k) || (/^playwright@/.test(k) && re.test("playwright"))) out.push(`claude-code plugin ${k}`);
  }
  return out;
}

const PW_RE = /playwright/i;
const DT_RE = /chrome-devtools-mcp/i;

/** Agents installed on this machine or configured in this project. */
export async function detectAgents(root: string, home = process.env.WRECK_IT_HOME ?? homedir()): Promise<Agent[]> {
  const out: Agent[] = [];
  if ((await onPath("claude")) || existsSync(join(home, ".claude"))) out.push("claude-code");
  if ((await onPath("codex")) || existsSync(join(home, ".codex"))) out.push("codex");
  if (existsSync(join(root, ".cursor")) || existsSync(join(home, ".cursor"))) out.push("cursor");
  if ((await onPath("gemini")) || existsSync(join(home, ".gemini"))) out.push("gemini");
  if (existsSync(join(root, ".vscode"))) out.push("vscode");
  return out;
}

/** Merge one stdio server into a JSON MCP config, never touching other entries. */
export async function addJsonServer(file: string, key: "mcpServers" | "servers", name: string, args: string[], match: RegExp): Promise<"already" | "done"> {
  const txt = await readText(file);
  let j: any = {};
  if (txt !== undefined) { try { j = JSON.parse(txt); } catch { throw new Error(`${file} is not valid JSON; add the server by hand`); } }
  const block = (j[key] ??= {});
  if (Object.entries(block).some(([k, v]) => match.test(k) || match.test(JSON.stringify(v)))) return "already";
  block[name] = { ...(key === "servers" ? { type: "stdio" } : {}), command: "npx", args };
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(j, null, 2) + "\n");
  return "done";
}

interface Plan { id: string; label: string; check: () => Promise<boolean>; install: () => Promise<{ ok: boolean; detail: string }>; preview: string; mcp?: boolean }
interface McpServer { id: string; name: string; label: string; args: string[]; re: RegExp }

const MCP_SERVERS: McpServer[] = [
  { id: "playwright-mcp", name: "playwright", label: "Playwright MCP", args: PLAYWRIGHT_MCP_ARGS, re: PW_RE },
  { id: "devtools-mcp", name: "chrome-devtools", label: "Chrome DevTools MCP", args: DEVTOOLS_MCP_ARGS, re: DT_RE },
];

const tail = (out: string) => out.split("\n").slice(-3).join(" ").slice(0, 300);

/** The browsers: Playwright's Chromium, the MCP server's own Chromium, and Google Chrome for DevTools MCP. */
function browserPlans(): Plan[] {
  const pwInstall = async (what: string) => { const r = await playwrightInstall(what); return { ok: r.ok, detail: r.ok ? "installed" : tail(r.out) }; };
  return [
    {
      id: "chromium", label: "Playwright Chromium", preview: "npx playwright install chromium",
      check: async () => { try { return existsSync(chromium.executablePath()); } catch { return false; } },
      install: () => pwInstall("chromium"),
    },
    {
      id: "mcp-browser", label: "Playwright MCP's Chromium", preview: `npx ${PLAYWRIGHT_MCP_PKG} install-browser chromium`,
      check: mcpBrowserInstalled,
      install: async () => {
        const r = await run("npx", ["-y", PLAYWRIGHT_MCP_PKG, "install-browser", "chromium"]);
        return { ok: r.code === 0, detail: r.code === 0 ? "installed" : tail(r.out) };
      },
    },
    {
      id: "chrome", label: "Google Chrome (for Chrome DevTools MCP)", preview: "npx playwright install chrome",
      check: async () => !!chromePath(),
      install: async () => {
        const r = await pwInstall("chrome");
        return r.ok || platform() !== "linux" ? r : { ok: false, detail: `${r.detail} (on Linux this may need: sudo npx playwright install chrome)` };
      },
    },
  ];
}

/** Add one MCP server to one agent: through its CLI (Claude Code, Codex) or by merging into its JSON config. */
function mcpPlan(root: string, a: Agent, s: McpServer, home: string): Plan {
  const id = `${s.id}:${a}`, label = `${s.label} for ${a}`;
  const cmdLine = `npx ${s.args.join(" ")}`;
  const viaCli = (cli: string) => async () => { const r = await run(cli, ["mcp", "add", s.name, "--", "npx", ...s.args]); return { ok: r.code === 0, detail: r.out.split("\n")[0] ?? "" }; };
  if (a === "claude-code") {
    return {
      id, label, mcp: true, preview: `claude mcp add ${s.name} -- ${cmdLine}`,
      check: async () => (await mcpSources(root, s.re, home)).some((x) => x.includes(".claude") || x.endsWith(".mcp.json") || x.startsWith("claude-code plugin")),
      install: viaCli("claude"),
    };
  }
  if (a === "codex") {
    return {
      id, label, mcp: true, preview: `codex mcp add ${s.name} -- ${cmdLine}`,
      check: async () => s.re.test((await readText(join(home, ".codex", "config.toml"))) ?? ""),
      install: viaCli("codex"),
    };
  }
  const file = a === "cursor" ? join(root, ".cursor", "mcp.json") : a === "vscode" ? join(root, ".vscode", "mcp.json") : join(root, ".gemini", "settings.json");
  const key = a === "vscode" ? "servers" : "mcpServers";
  const global = a === "cursor" ? join(home, ".cursor", "mcp.json") : a === "gemini" ? join(home, ".gemini", "settings.json") : undefined;
  return {
    id, label, mcp: true, preview: `add "${s.name}" to ${file}`,
    check: async () => (await Promise.all([file, global].map(async (f) => (f ? s.re.test((await readText(f)) ?? "") : false)))).some(Boolean),
    install: async () => {
      try { const r = await addJsonServer(file, key, s.name, s.args, s.re); return { ok: true, detail: r === "already" ? "already present" : `added to ${file}` }; }
      catch (e) { return { ok: false, detail: (e as Error).message }; }
    },
  };
}

/**
 * Schemathesis runs through uv's `uvx`. uv is installed only through a package manager (Homebrew, or winget on
 * Windows); setup never pipes a downloaded script into a shell. Without one, it prints the official instructions.
 */
async function schemathesisPlan(): Promise<Plan> {
  const manager = platform() === "win32" ? ((await onPath("winget")) ? "winget" : undefined) : (await onPath("brew")) ? "brew" : undefined;
  const manual = "install uv (https://docs.astral.sh/uv/getting-started/installation/), then run setup again";
  return {
    id: "schemathesis", label: "Schemathesis (via uv)",
    preview: manager === "winget" ? "winget install --id astral-sh.uv -e" : manager === "brew" ? "brew install uv" : manual,
    check: async () => (await onPath("schemathesis")) || (await onPath("uvx")),
    install: async () => {
      if (!manager) return { ok: false, detail: manual };
      const r = manager === "winget" ? await run("winget", ["install", "--id", "astral-sh.uv", "-e", "--silent"]) : await run("brew", ["install", "uv"]);
      if (r.code !== 0) return { ok: false, detail: `could not install uv: ${tail(r.out)}; ${manual}` };
      const warm = await run("uvx", ["schemathesis", "--version"], 10 * 60_000);
      return { ok: warm.code === 0, detail: warm.code === 0 ? "installed" : tail(warm.out) };
    },
  };
}

async function plan(root: string, agents: Agent[]): Promise<Plan[]> {
  const home = process.env.WRECK_IT_HOME ?? homedir();
  const mcp = agents.flatMap((a) => MCP_SERVERS.map((s) => mcpPlan(root, a, s, home)));
  return [...browserPlans(), ...mcp, await schemathesisPlan()];
}

export async function runSetup(root: string, opts: { dryRun?: boolean; agents?: Agent[]; skip?: string[] } = {}): Promise<SetupResult> {
  const agents = opts.agents?.length ? opts.agents : await detectAgents(root);
  const steps: StepResult[] = [];
  let restartNeeded = false;
  if (!nodeOk()) steps.push({ id: "node", label: "Node.js 22.19+", action: "failed", detail: `node ${process.versions.node} is too old for Lighthouse; install Node 22.19 or newer (e.g. nvm install 22)` });
  for (const s of await plan(root, agents)) {
    if (opts.skip?.some((x) => s.id === x || s.id.startsWith(`${x}:`))) { steps.push({ id: s.id, label: s.label, action: "skipped", detail: "--skip" }); continue; }
    if (await s.check()) { steps.push({ id: s.id, label: s.label, action: "already", detail: "ready" }); continue; }
    if (opts.dryRun) { steps.push({ id: s.id, label: s.label, action: "would-run", detail: s.preview }); continue; }
    const r = await s.install();
    steps.push({ id: s.id, label: s.label, action: r.ok ? "done" : "failed", detail: r.detail || s.preview });
    if (r.ok && s.mcp) restartNeeded = true;
  }
  if (!agents.length) steps.push({ id: "agents", label: "MCP servers", action: "skipped", detail: "no supported agent found; pass --agent claude-code|codex|cursor|gemini|vscode" });
  return { agents, steps, restartNeeded, ok: steps.every((s) => s.action !== "failed") };
}

export function formatSetup(r: SetupResult, dryRun = false): string {
  const icon = { already: "✓", done: "✓", "would-run": "→", failed: "✗", skipped: "–" } as const;
  const l = [`agents: ${r.agents.join(", ") || "none detected"}`, ""];
  for (const s of r.steps) l.push(`${icon[s.action]} ${s.label}: ${s.action === "already" ? "already set up" : s.action === "would-run" ? `will run: ${s.detail}` : s.detail}`);
  l.push("");
  if (dryRun) l.push("Dry run: nothing was changed. Run `npx @miyannishar/wreck-it setup` to apply.");
  else if (!r.ok) l.push("Some steps failed; fix them (see above) and run `npx @miyannishar/wreck-it setup` again.");
  else l.push("Everything wreck-it uses is ready.");
  if (r.restartNeeded) l.push("Restart your agent so it loads the new MCP servers, then ask it again to wreck your app.");
  return l.join("\n") + "\n";
}
