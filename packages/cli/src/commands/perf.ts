import { Command } from "commander";
import { rootOf } from "../options.js";
import { WreckError } from "../errors.js";
import { runPerf, formatPerf, type FormFactor } from "../perf.js";

export function registerPerfCommands(program: Command): void {
  program.command("perf").description("Lighthouse page-speed audit (LCP, CLS, TBT) of discovered pages on a simulated phone; --record files reproduced findings")
    .argument("[url...]", "pages to measure (default: discovered pages)")
    .option("--base-url <url>").option("--device <mobile|desktop>", "form factor", "mobile").option("--max-pages <n>", "pages to measure when no URLs are given", "8")
    .option("--record", "record reproduced findings for metrics in Google's poor range")
    .option("--account <label>", "log in as this account from .wreck-it/config.json (default: the first)").option("--i-own-this", "allow a non-local target you own").option("--root <dir>").option("--json")
    .action(async (urls: string[], opts: { baseUrl?: string; device: string; maxPages: string; record?: boolean; account?: string; iOwnThis?: boolean; root?: string; json?: boolean }) => {
      if (opts.device !== "mobile" && opts.device !== "desktop") throw new WreckError(`--device must be mobile or desktop, not "${opts.device}"`, 2);
      const r = await runPerf(rootOf(opts), {
        urls, baseUrl: opts.baseUrl, formFactor: opts.device as FormFactor, maxPages: Math.max(1, Number(opts.maxPages) || 8),
        record: opts.record, account: opts.account, iOwnThis: opts.iOwnThis,
      });
      process.stdout.write(opts.json ? JSON.stringify(r, null, 2) + "\n" : formatPerf(r));
    });
}
