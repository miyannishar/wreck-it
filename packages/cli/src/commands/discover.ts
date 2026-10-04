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
    ...(d.auth.sso?.length ? [`sign-in:    ${d.auth.sso.join(", ")} — run \`wreck-it login\` once so wreck-it can test logged in`] : []),
    `database:   ${d.database ? `${d.database.kind}, ${d.database.remote ? "REMOTE: testing writes real data there; ask before writing stages" : "local"}` : "none found"}`,
    ...(d.services?.uses.length ? [`services:   ${d.services.uses.join(", ")}${d.services.stripeMode ? ` (Stripe ${d.services.stripeMode} keys${d.services.stripeMode === "live" ? ": REAL CHARGES, never complete a payment" : ""})` : ""}`] : []),
    ...(d.api.some((a) => a.effects?.length) ? [`side effects: ${d.api.filter((a) => a.effects?.length).map((a) => `${a.method} ${a.path} (${a.effects!.join(", ")})`).slice(0, 8).join("; ")} — fuzz and load skip these`] : []),
    ...(d.services?.emailConfirmation ? ["email:      sign-ups must confirm their email; use a local test inbox (`wreck-it email read`) or an address you can read (config testEmail)"] : []),
    ...(d.services?.captcha ? ["captcha:    the app uses a CAPTCHA; use its test keys locally, or flows behind it will be blocked"] : []),
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
