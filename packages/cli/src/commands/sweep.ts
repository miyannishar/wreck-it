import { Command } from "commander";
import { rootOf } from "../options.js";
import { runSweep, formatSweep } from "../sweep.js";

export function registerSweepCommands(program: Command): void {
  program.command("sweep").description("Visit every discovered page at desktop and mobile widths: oddity script, server errors and axe; --record files reproduced findings")
    .option("--base-url <url>").option("--viewports <list>", "comma-separated WxH list", "1280x800,390x844")
    .option("--record", "record reproduced findings (deduplicated by root cause)").option("--no-a11y", "skip the axe scan")
    .option("--i-own-this", "allow a non-local target you own").option("--root <dir>").option("--json")
    .action(async (opts: { baseUrl?: string; viewports: string; record?: boolean; a11y: boolean; iOwnThis?: boolean; root?: string; json?: boolean }) => {
      const r = await runSweep(rootOf(opts), { baseUrl: opts.baseUrl, viewports: opts.viewports, record: opts.record, a11y: opts.a11y, iOwnThis: opts.iOwnThis });
      process.stdout.write(opts.json ? JSON.stringify(r, null, 2) + "\n" : formatSweep(r));
    });
}
