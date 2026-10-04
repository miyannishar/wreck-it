import { Command } from "commander";
import { rootOf } from "../options.js";
import { WreckError } from "../errors.js";
import { runSetup, formatSetup, AGENTS, type Agent } from "../setup.js";

export function registerSetupCommands(program: Command): void {
  program.command("setup").description("Install everything wreck-it uses: browsers, Playwright MCP and Chrome DevTools MCP for your agents, and Schemathesis (via uv)")
    .option("--dry-run", "only show what is ready and what would be installed")
    .option("--agent <name...>", `only configure these agents (${AGENTS.join(", ")}); default: every agent found`)
    .option("--skip <id...>", "skip steps: chromium, mcp-browser, chrome, playwright-mcp, devtools-mcp, schemathesis")
    .option("--root <dir>").option("--json")
    .action(async (opts: { dryRun?: boolean; agent?: string[]; skip?: string[]; root?: string; json?: boolean }) => {
      const bad = (opts.agent ?? []).filter((a) => !(AGENTS as readonly string[]).includes(a));
      if (bad.length) throw new WreckError(`unknown agent(s): ${bad.join(", ")}; use ${AGENTS.join(", ")}`, 2);
      const r = await runSetup(rootOf(opts), { dryRun: opts.dryRun, agents: opts.agent as Agent[] | undefined, skip: opts.skip });
      process.stdout.write(opts.json ? JSON.stringify(r, null, 2) + "\n" : formatSetup(r, opts.dryRun));
      process.exitCode = r.ok ? 0 : 1;
    });
}
