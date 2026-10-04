import { Command } from "commander";
import { z } from "zod";
import { FindingInputSchema } from "../schema.js";
import { ConfigSchema } from "../config.js";
import { WreckError } from "../errors.js";

export function registerSchemaCommands(program: Command): void {
  program
    .command("schema")
    .description("Print the JSON Schema for findings or config")
    .argument("<which>", "finding | config")
    .action((which: string) => {
      const s = which === "finding" ? FindingInputSchema : which === "config" ? ConfigSchema : null;
      if (!s) throw new WreckError(`unknown schema "${which}" (use finding or config)`, 2);
      process.stdout.write(JSON.stringify(z.toJSONSchema(s, { io: "input" }), null, 2) + "\n");
    });
}
