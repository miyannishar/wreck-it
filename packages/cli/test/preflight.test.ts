import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { runCli, tmpRoot } from "./helpers.js";
import { writeTree } from "./fixtures.js";
import { runPreflight, detectPlaywrightMcp, INSTALL_HINTS } from "../src/preflight.js";

let server: Server, base: string;
beforeAll(async () => {
  server = createServer((_q, r) => { r.statusCode = 404; r.end("x"); });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => { server.close(); });

describe("preflight", () => {
  it("reports reachable (any HTTP status), hints, devScript and gitignore warning", async () => {
    const root = await tmpRoot(), home = await tmpRoot();
    process.env.WRECK_IT_HOME = home;
    await writeTree(root, { "package.json": JSON.stringify({ scripts: { dev: "next dev" } }), ".gitignore": "node_modules\n" });
    const r = await runPreflight({ root, url: base });
    expect(r).toMatchObject({ url: base, allowed: true, reachable: true, status: 404, devScript: "npm run dev" });
    expect(r.playwrightMcp).toEqual({ found: false, sources: [] });
    expect(r.installHints["claude-code"]).toBe("claude mcp add playwright -- npx @playwright/mcp@latest");
    expect(r.installHints.codex).toBe("codex mcp add playwright -- npx @playwright/mcp@latest");
    expect(r.installHints.gemini).toBe("gemini mcp add playwright npx @playwright/mcp@latest");
    expect(Object.keys(INSTALL_HINTS).sort()).toEqual(["claude-code", "codex", "cursor", "gemini", "vscode"]);
    expect(r.warnings.some((w) => w.includes(".gitignore"))).toBe(true);
    delete process.env.WRECK_IT_HOME;
  });
  it("prefers discovery devScript and detects Playwright MCP in project and home", async () => {
    const root = await tmpRoot(), home = await tmpRoot();
    await writeTree(root, {
      ".gitignore": ".wreck-it/\n", ".wreck-it/discovery.json": JSON.stringify({ devScript: "pnpm dev" }),
      ".mcp.json": JSON.stringify({ mcpServers: { pw: { command: "npx", args: ["@playwright/mcp@latest"] } } }),
      ".vscode/mcp.json": JSON.stringify({ servers: { other: { command: "x" } } }),
    });
    await writeTree(home, { ".codex/config.toml": `[mcp_servers.playwright]\ncommand = "npx"\n` });
    const mcp = await detectPlaywrightMcp(root, home);
    expect(mcp.found).toBe(true);
    expect(mcp.sources).toEqual([`${root}/.mcp.json`, `${home}/.codex/config.toml`]);
    process.env.WRECK_IT_HOME = home;
    const r = await runPreflight({ root, url: base });
    expect(r.devScript).toBe("pnpm dev");
    expect(r.warnings.some((w) => w.includes(".gitignore"))).toBe(false);
    delete process.env.WRECK_IT_HOME;
  });
  it("detects the wreck-it Claude Code plugin", async () => {
    const root = await tmpRoot(), home = await tmpRoot();
    await writeTree(home, { ".claude/plugins/installed_plugins.json": JSON.stringify({ version: 2, plugins: { "wreck-it@wreck-it": [{}], "other@x": [{}] } }) });
    expect(await detectPlaywrightMcp(root, home)).toEqual({ found: true, sources: ["claude-code plugin wreck-it@wreck-it"] });
  });
  it("exits 0 with JSON when allowed and reachable", async () => {
    const root = await tmpRoot();
    const r = await runCli(["preflight", "--url", base, "--json", "--root", root]);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({ allowed: true, reachable: true });
  });
  it("exits 4 when unreachable, readable output without --json", async () => {
    const root = await tmpRoot();
    const r = await runCli(["preflight", "--url", "http://127.0.0.1:1", "--root", root]);
    expect(r.code).toBe(4);
    expect(r.stdout).toContain("reachable  no");
  });
  it("polls with --wait until the app comes up", async () => {
    const s = createServer((_q, r) => r.end("ok"));
    await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
    const port = (s.address() as AddressInfo).port;
    await new Promise((r) => s.close(r));
    setTimeout(() => s.listen(port, "127.0.0.1"), 800);
    const r = await runPreflight({ root: await tmpRoot(), url: `http://127.0.0.1:${port}`, wait: 10 });
    s.close();
    expect(r.reachable).toBe(true);
  });
  it("exits 3 for a refused target", async () => {
    const r = await runCli(["preflight", "--url", "http://example.com", "--json", "--root", await tmpRoot()]);
    expect(r.code).toBe(3);
    expect(JSON.parse(r.stdout)).toMatchObject({ allowed: false, reachable: false });
  });
});
