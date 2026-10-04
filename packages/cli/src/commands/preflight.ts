import { Command } from "commander";
import { rootOf } from "../options.js";
import { runPreflight, preflightExitCode, formatPreflight } from "../preflight.js";

export function registerPreflightCommands(program: Command): void {
  program.command("preflight").description("Check target safety, reachability, Playwright MCP and .gitignore")
    .option("--url <url>").option("--i-own-this", "allow a non-local target you own").option("--wait <sec>", "poll for reachability up to this many seconds", "0")
    .option("--root <dir>").option("--json")
    .action(async (opts: { url?: string; iOwnThis?: boolean; wait: string; root?: string; json?: boolean }) => {
      const r = await runPreflight({ root: rootOf(opts), url: opts.url, iOwnThis: opts.iOwnThis, wait: Math.max(0, Number(opts.wait) || 0) });
      process.stdout.write(opts.json ? JSON.stringify(r, null, 2) + "\n" : formatPreflight(r));
      process.exitCode = preflightExitCode(r);
    });
}
