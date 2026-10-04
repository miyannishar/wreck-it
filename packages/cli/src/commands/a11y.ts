import { Command } from "commander";
import { rootOf } from "../options.js";
import { WreckError } from "../errors.js";
import { isAllowedTarget } from "../target.js";
import { loadConfig } from "../config.js";
import { parseViewport, scanUrls, writeResult, recordViolations } from "../a11y.js";

export function registerA11yCommands(program: Command): void {
  program.command("a11y").description("Run axe-core accessibility scans in headless Chromium")
    .argument("<url...>").option("--storage-state <file>").option("--viewport <WxH>").option("--record", "add a finding per violation rule")
    .option("--i-own-this", "allow a non-local target you own").option("--root <dir>").option("--json")
    .action(async (urls: string[], opts: { storageState?: string; viewport?: string; record?: boolean; iOwnThis?: boolean; root?: string; json?: boolean }) => {
      const root = rootOf(opts);
      const cfg = await loadConfig(root);
      for (const u of urls) {
        const c = isAllowedTarget(u, { iOwnThis: opts.iOwnThis || cfg.iOwnThis });
        if (!c.ok) throw new WreckError(c.reason, 3);
      }
      const viewport = opts.viewport ? parseViewport(opts.viewport) : undefined;
      const results = await scanUrls(urls, { storageState: opts.storageState, viewport });
      const summary = [];
      for (const r of results) {
        const file = await writeResult(root, r);
        const findings = opts.record ? await recordViolations(root, r) : [];
        summary.push({ url: r.url, file, violations: r.violations.length, findings });
      }
      if (opts.json) { process.stdout.write(JSON.stringify(summary, null, 2) + "\n"); return; }
      for (const s of summary) process.stdout.write(`${s.url}: ${s.violations} violation rule(s) → ${s.file}${s.findings.length ? ` (recorded ${s.findings.join(", ")})` : ""}\n`);
    });
}
