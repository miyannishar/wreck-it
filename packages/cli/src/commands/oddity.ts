import { Command } from "commander";
import { ODDITY_SCRIPT } from "../oddity.js";

export function registerOddityCommands(program: Command): void {
  program.command("oddity-script").description("Print a browser function for Playwright MCP browser_evaluate that returns oddity signals")
    .action(() => { process.stdout.write(ODDITY_SCRIPT + "\n"); });
}
