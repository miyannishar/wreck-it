import { Command } from "commander";
import { relative } from "node:path";
import { discover, type Discovery } from "../discover/index.js";
import { wreckPaths, ensureDirs } from "../paths.js";
import { writeAtomic } from "../findings.js";
import { rootOf } from "../options.js";

export function summarize(d: Discovery): string {
  const dyn = d.pages.filter((p) => p.dynamic).length;
  return [
    `frameworks: ${d.frameworks.join(", ") || "unknown"}`,
    `baseUrl:    ${d.baseUrl ?? "unknown"}${d.devScript ? ` (${d.devScript})` : ""}`,
    `pages: ${d.pages.length}${dyn ? ` (${dyn} dynamic)` : ""}  api: ${d.api.length}  forms: ${d.forms.length}`,
    `auth:       ${d.auth.kind}${d.auth.evidence.length ? ` — ${d.auth.evidence[0]}` : ""}`,
    `database:   ${d.database ? `${d.database.kind}, ${d.database.remote ? "REMOTE" : "local"}` : "none found"}`,
    ...d.warnings.map((w) => `warning: ${w}`),
  ].join("\n");
}

export function registerDiscoverCommands(program: Command): void {
  program.command("discover").description("Static scan for routes, API endpoints, forms, auth and database (no network)")
    .option("--root <dir>").option("--json", "print the discovery JSON instead of a summary")
    .action(async (opts: { root?: string; json?: boolean }) => {
      const root = rootOf(opts), p = wreckPaths(root);
      const d = await discover(root);
      await ensureDirs(p);
      const json = JSON.stringify(d, null, 2);
      await writeAtomic(p.discovery, json + "\n");
      const rel = relative(process.cwd(), p.discovery);
      process.stdout.write(opts.json ? json + "\n" : `${summarize(d)}\nwrote ${rel.startsWith("..") ? p.discovery : rel}\n`);
    });
}
