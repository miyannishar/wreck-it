import { Command } from "commander";
import { addFinding, updateFinding, listFindings } from "../findings.js";
import { readJsonInput } from "../io.js";
import { rootOf } from "../options.js";

export function registerFindingCommands(program: Command): void {
  const finding = program.command("finding").description("Record and manage findings");
  finding.command("add").description("Validate and save a finding (JSON arg, --file, or stdin)")
    .argument("[json]").option("--file <path>").option("--root <dir>")
    .action(async (json: string | undefined, opts: { file?: string; root?: string }) => {
      const { finding: f, warnings } = await addFinding(rootOf(opts), await readJsonInput(json, opts.file));
      process.stdout.write(JSON.stringify({ id: f.id, warnings }) + "\n");
    });
  finding.command("update").description("Patch fields of an existing finding")
    .argument("<id>").argument("[json]").option("--file <path>").option("--root <dir>")
    .action(async (id: string, json: string | undefined, opts: { file?: string; root?: string }) => {
      const f = await updateFinding(rootOf(opts), id, await readJsonInput(json, opts.file));
      process.stdout.write(JSON.stringify({ id: f.id }) + "\n");
    });
  finding.command("list").description("List findings").option("--json").option("--root <dir>")
    .action(async (opts: { json?: boolean; root?: string }) => {
      const { findings, errors } = await listFindings(rootOf(opts));
      for (const e of errors) process.stderr.write(`warning: skipped ${e.file}: ${e.message}\n`);
      if (opts.json) { process.stdout.write(JSON.stringify(findings, null, 2) + "\n"); return; }
      for (const f of findings) process.stdout.write(`${f.id}  ${f.severity.padEnd(8)} ${f.category.padEnd(13)} ${f.reproduced ? "✓" : "?"}  ${f.title}\n`);
    });
}
