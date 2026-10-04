import { Command } from "commander";
import { rootOf } from "../options.js";
import { genTests } from "../gentests.js";

export function registerGenTestsCommands(program: Command): void {
  program.command("gen-tests").description("Generate Playwright regression specs from reproduced findings").option("--root <dir>")
    .action(async (opts: { root?: string }) => {
      const r = await genTests(rootOf(opts));
      const out = [...r.written, ...r.skipped.map((s) => `skipped ${s.id}: ${s.reason}`)];
      if (r.scaffoldedConfig) out.push("scaffolded playwright.config.ts");
      for (const w of r.warnings) process.stderr.write(`warning: ${w}\n`);
      if (r.written.length) out.push("Run them with: npx playwright test tests/wreck-it  (needs @playwright/test: npm i -D @playwright/test)");
      process.stdout.write(out.length ? out.join("\n") + "\n" : "");
    });
}
