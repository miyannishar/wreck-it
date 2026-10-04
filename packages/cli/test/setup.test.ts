import { describe, it, expect, afterEach } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { addJsonServer, runSetup, mcpSources, nodeOk, PLAYWRIGHT_MCP_ARGS, DEVTOOLS_MCP_ARGS } from "../src/setup.js";
import { tmpRoot } from "./helpers.js";
import { writeTree } from "./fixtures.js";

afterEach(() => { delete process.env.WRECK_IT_HOME; });

describe("addJsonServer", () => {
  it("adds a server next to existing ones and leaves an existing matching server alone", async () => {
    const root = await tmpRoot();
    const file = join(root, ".cursor", "mcp.json");
    await writeTree(root, { ".cursor/mcp.json": JSON.stringify({ mcpServers: { other: { command: "x" } }, keep: true }) });
    expect(await addJsonServer(file, "mcpServers", "playwright", PLAYWRIGHT_MCP_ARGS, /playwright/i)).toBe("done");
    const j = JSON.parse(await readFile(file, "utf8"));
    expect(j).toEqual({ mcpServers: { other: { command: "x" }, playwright: { command: "npx", args: PLAYWRIGHT_MCP_ARGS } }, keep: true });
    expect(await addJsonServer(file, "mcpServers", "playwright", PLAYWRIGHT_MCP_ARGS, /playwright/i)).toBe("already");
  });

  it("uses VS Code's servers key with a stdio type, and refuses to rewrite invalid JSON", async () => {
    const root = await tmpRoot();
    const file = join(root, ".vscode", "mcp.json");
    await addJsonServer(file, "servers", "chrome-devtools", DEVTOOLS_MCP_ARGS, /chrome-devtools-mcp/i);
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ servers: { "chrome-devtools": { type: "stdio", command: "npx", args: DEVTOOLS_MCP_ARGS } } });
    await writeTree(root, { ".cursor/mcp.json": "{ nope" });
    await expect(addJsonServer(join(root, ".cursor", "mcp.json"), "mcpServers", "p", PLAYWRIGHT_MCP_ARGS, /playwright/i)).rejects.toThrow(/not valid JSON/);
  });
});

describe("mcpSources", () => {
  it("counts Claude Code project servers only for this project", async () => {
    const root = await tmpRoot(), home = await tmpRoot();
    await writeTree(home, { ".claude.json": JSON.stringify({ projects: { "/some/other/project": { mcpServers: { pw: { command: "npx", args: ["@playwright/mcp"] } } } } }) });
    expect(await mcpSources(root, /playwright/i, home)).toEqual([]);
    await writeTree(home, { ".claude.json": JSON.stringify({ projects: { [root]: { mcpServers: { pw: { command: "npx", args: ["@playwright/mcp"] } } } } }) });
    expect(await mcpSources(root, /playwright/i, home)).toEqual([join(home, ".claude.json")]);
  });

  it("treats the wreck-it Claude Code plugin as providing both servers", async () => {
    const root = await tmpRoot(), home = await tmpRoot();
    await writeTree(home, { ".claude/plugins/installed_plugins.json": JSON.stringify({ plugins: { "wreck-it@wreck-it": [{}] } }) });
    expect(await mcpSources(root, /playwright/i, home)).toEqual(["claude-code plugin wreck-it@wreck-it"]);
    expect(await mcpSources(root, /chrome-devtools-mcp/i, home)).toEqual(["claude-code plugin wreck-it@wreck-it"]);
  });
});

describe("runSetup", () => {
  it("dry run lists the MCP config it would add per agent and changes nothing", async () => {
    const root = await tmpRoot();
    process.env.WRECK_IT_HOME = await tmpRoot();
    const r = await runSetup(root, { dryRun: true, agents: ["cursor", "vscode"], skip: ["chromium", "mcp-browser", "chrome", "schemathesis"] });
    const byId = Object.fromEntries(r.steps.map((s) => [s.id, s]));
    expect(byId["playwright-mcp:cursor"]).toMatchObject({ action: "would-run", detail: `add "playwright" to ${join(root, ".cursor", "mcp.json")}` });
    expect(byId["devtools-mcp:vscode"]).toMatchObject({ action: "would-run" });
    expect(byId.chromium).toMatchObject({ action: "skipped" });
    expect(r.restartNeeded).toBe(false);
    await expect(readFile(join(root, ".cursor", "mcp.json"), "utf8")).rejects.toThrow();
  });

  it("writes project MCP config for JSON-config agents and asks for a restart", async () => {
    const root = await tmpRoot();
    process.env.WRECK_IT_HOME = await tmpRoot();
    const r = await runSetup(root, { agents: ["gemini"], skip: ["chromium", "mcp-browser", "chrome", "schemathesis"] });
    expect(r.ok).toBe(true);
    expect(r.restartNeeded).toBe(true);
    const j = JSON.parse(await readFile(join(root, ".gemini", "settings.json"), "utf8"));
    expect(Object.keys(j.mcpServers)).toEqual(["playwright", "chrome-devtools"]);
    const again = await runSetup(root, { agents: ["gemini"], skip: ["chromium", "mcp-browser", "chrome", "schemathesis"] });
    expect(again.steps.filter((s) => s.id.includes(":")).every((s) => s.action === "already")).toBe(true);
    expect(again.restartNeeded).toBe(false);
  });
});

describe("nodeOk", () => {
  it("requires Node 22.19 or newer", () => {
    expect(nodeOk("22.19.0")).toBe(true);
    expect(nodeOk("24.1.0")).toBe(true);
    expect(nodeOk("22.18.9")).toBe(false);
    expect(nodeOk("20.19.0")).toBe(false);
  });
});
