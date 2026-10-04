import { Command } from "commander";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { VERSION } from "./version.js";
import { WreckError } from "./errors.js";
import { registerSchemaCommands } from "./commands/schema.js";
import { registerFindingCommands } from "./commands/finding.js";
import { registerRunCommands } from "./commands/run.js";
import { registerReportCommands } from "./commands/report.js";
import { registerGenTestsCommands } from "./commands/gentests.js";
import { registerDiscoverCommands } from "./commands/discover.js";
import { registerPreflightCommands } from "./commands/preflight.js";
import { registerOddityCommands } from "./commands/oddity.js";
import { registerA11yCommands } from "./commands/a11y.js";
import { registerLoadCommands } from "./commands/load.js";
import { registerSweepCommands } from "./commands/sweep.js";

export function buildProgram(): Command {
  const program = new Command();
  program
    .name("wreck-it")
    .description("Wreck your app before your users do.")
    .version(VERSION)
    .showHelpAfterError();
  registerSchemaCommands(program);
  registerFindingCommands(program);
  registerRunCommands(program);
  registerReportCommands(program);
  registerGenTestsCommands(program);
  registerDiscoverCommands(program);
  registerPreflightCommands(program);
  registerOddityCommands(program);
  registerA11yCommands(program);
  registerLoadCommands(program);
  registerSweepCommands(program);
  return program;
}

export async function main(argv: string[]): Promise<void> {
  try {
    await buildProgram().parseAsync(argv);
  } catch (err) {
    if (err instanceof WreckError) {
      process.stderr.write(`wreck-it: ${err.message}\n`);
      process.exitCode = err.exitCode;
      return;
    }
    const e = err as Error;
    process.stderr.write(process.env.WRECK_IT_DEBUG ? `wreck-it: ${e.stack ?? e.message}\n` : `wreck-it: ${e?.message ?? String(err)}\n`);
    process.exitCode = 1;
  }
}

const isEntry = (() => {
  try { return realpathSync(process.argv[1] ?? "") === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return false; }
})();
if (isEntry) main(process.argv).catch((e) => { process.stderr.write(`wreck-it: ${(e as Error).message}\n`); process.exitCode = 1; });
