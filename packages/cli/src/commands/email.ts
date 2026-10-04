import { Command } from "commander";
import { rootOf } from "../options.js";
import { nextTestEmail, readMail } from "../email.js";

export function registerEmailCommands(program: Command): void {
  const email = program.command("email").description("Test email addresses for sign-ups, and confirmation links from a local test inbox");
  email.command("new").description("Print a fresh address to sign up with (from config testEmail, or any address when a local test inbox is running)")
    .option("--root <dir>").option("--json")
    .action(async (opts: { root?: string; json?: boolean }) => {
      const r = await nextTestEmail(rootOf(opts));
      process.stdout.write(opts.json ? JSON.stringify(r) + "\n" : `${r.address}\n${r.readable === "user" ? "(mail goes to the user's inbox: ask them for the link)" : "(read it with: wreck-it email read --to <address>)"}\n`);
    });
  email.command("read").description("Wait for the newest mail to an address in the local test inbox and print its links")
    .requiredOption("--to <address>").option("--wait <sec>", "seconds to wait for it", "30").option("--root <dir>").option("--json")
    .action(async (opts: { to: string; wait: string; root?: string; json?: boolean }) => {
      const r = await readMail(rootOf(opts), opts.to, Math.max(0, Number(opts.wait) || 30));
      if (opts.json) { process.stdout.write(JSON.stringify(r, null, 2) + "\n"); }
      else if (!r.mail) process.stdout.write(`no mail to ${opts.to} in ${r.inbox.kind} (${r.inbox.url}) yet\n`);
      else process.stdout.write([`subject: ${r.mail.subject}`, ...r.mail.links.slice(0, 5).map((l) => `link: ${l}`)].join("\n") + "\n");
      if (!r.mail) process.exitCode = 1;
    });
}
