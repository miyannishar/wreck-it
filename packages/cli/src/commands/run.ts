import { Command } from "commander";
import { initRun, setStage, recordVisit, readRun, recordCreated, type Stage, type StageStatus } from "../run.js";
import { rootOf } from "../options.js";

export function registerRunCommands(program: Command): void {
  const run = program.command("run").description("Track run state (stages and visited routes)");
  run.command("init").description("Start a new run").option("--fresh", "delete previous findings, shots, load data, visits and reports").option("--root <dir>")
    .action(async (opts: { fresh?: boolean; root?: string }) => {
      const state = await initRun(rootOf(opts), { fresh: !!opts.fresh });
      process.stdout.write(JSON.stringify(state) + "\n");
    });
  run.command("stage").description("Set a stage status").argument("<stage>").argument("<status>").option("--root <dir>")
    .action(async (stage: string, status: string, opts: { root?: string }) => {
      const state = await setStage(rootOf(opts), stage as Stage, status as StageStatus);
      process.stdout.write(JSON.stringify(state) + "\n");
    });
  run.command("visit").description("Record a visited route").argument("<route>").requiredOption("--persona <name>").option("--root <dir>")
    .action(async (route: string, opts: { persona: string; root?: string }) => {
      await recordVisit(rootOf(opts), route, opts.persona);
    });
  run.command("created").description("Log test data this run created (an account, an order…), so the report lists it for cleanup")
    .argument("<what>", 'e.g. "account wreck.tester+3@example.test" or "order #1042"').requiredOption("--by <persona>").option("--root <dir>")
    .action(async (what: string, opts: { by: string; root?: string }) => {
      await recordCreated(rootOf(opts), { by: opts.by, what });
    });
  run.command("show").description("Print run state and visits as JSON").option("--root <dir>")
    .action(async (opts: { root?: string }) => {
      process.stdout.write(JSON.stringify(await readRun(rootOf(opts)), null, 2) + "\n");
    });
}
