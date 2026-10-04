import { Command } from "commander";
import { rootOf } from "../options.js";
import { runLogin, sessionStatus } from "../auth.js";

export function registerLoginCommands(program: Command): void {
  program.command("login").description("Open a browser so you can sign in (Google, GitHub, SSO, magic link, 2FA…); once you're logged in it saves the app's session and closes the window")
    .option("--label <name>", "account to save it as (default: the first account, or main)")
    .option("--url <path>", "page to open (default: the app's login page, or /)")
    .option("--timeout <sec>", "give up after this many seconds", "600")
    .option("--check", "only check whether the saved session still works")
    .option("--i-own-this", "allow a non-local target you own").option("--root <dir>").option("--json")
    .action(async (opts: { label?: string; url?: string; timeout: string; check?: boolean; iOwnThis?: boolean; root?: string; json?: boolean }) => {
      const root = rootOf(opts);
      if (opts.check) {
        const r = await sessionStatus(root, opts.label);
        const fix = r.status === "expired" || r.status === "missing" ? ` — run \`wreck-it login${r.label ? ` --label ${r.label}` : ""}\`` : "";
        process.stdout.write(opts.json ? JSON.stringify(r) + "\n" : `${r.label ?? "(no account)"}: ${r.status}${r.page ? ` (checked ${r.page})` : ""}${fix}\n`);
        process.exitCode = fix ? 1 : 0;
        return;
      }
      const r = await runLogin(root, { label: opts.label, url: opts.url, timeoutSec: Math.max(30, Number(opts.timeout) || 600), iOwnThis: opts.iOwnThis });
      if (opts.json) { process.stdout.write(JSON.stringify(r, null, 2) + "\n"); return; }
      process.stdout.write([
        `${r.finished}: saved "${r.label}" → ${r.file} (${r.cookies} cookie(s), ${r.localStorage} local-storage item(s)${r.dropped ? `; left out ${r.dropped} cookie(s) from other sites, e.g. the sign-in provider` : ""})`,
        `check: ${r.check.status}${r.check.page ? ` on ${r.check.page}` : ""}`,
        ...r.warnings.map((w) => `warning: ${w}`),
      ].join("\n") + "\n");
      if (r.check.status === "expired") process.exitCode = 1;
    });
}
