import { Command } from "commander";
import { rootOf } from "../options.js";
import { writeReport } from "../report/html.js";

export function registerReportCommands(program: Command): void {
  program.command("report").description("Write report.html and report.md and print the readiness score").option("--root <dir>")
    .action(async (opts: { root?: string }) => {
      const r = await writeReport(rootOf(opts));
      process.stdout.write(`Readiness ${r.score}/100 (${r.band}) → ${r.html}\n${r.md}\n`);
      if (r.warnings.length) process.stderr.write(`${r.warnings.length} warnings (see report)\n`);
    });
}
