import { Command, Option } from "commander";
import { rootOf } from "../options.js";
import { formatLoadSummary, parseHeaders, runLoadTest } from "../load/index.js";
import type { LoadProfile } from "../load/types.js";

const collect = (v: string, prev: string[]) => [...prev, v];

export function registerLoadCommands(program: Command): void {
  program.command("load").description("Load-test one endpoint with autocannon (ramp | spike | soak)")
    .argument("<url>")
    .addOption(new Option("--profile <profile>").choices(["ramp", "spike", "soak"]).default("ramp"))
    .option("--method <method>", "HTTP method (non-GET/HEAD needs allowMutatingLoad)", "GET")
    .option("--pid <n>", "server process id for memory sampling", Number)
    .option("--step-duration <s>", "seconds per phase", Number, 10)
    .option("--max-connections <n>", "ramp ceiling", Number, 500)
    .option("--soak-duration <s>", "total soak seconds", Number, 180)
    .option("--recovery-timeout <s>", "seconds to wait for a crashed server", Number, 30)
    .option("--header <k:v>", "request header (repeatable)", collect, [] as string[])
    .option("--include-side-effects", "allow endpoints that call AI models, send email/SMS or take payments")
    .option("--i-own-this", "allow non-local targets you own")
    .option("--root <dir>").option("--json")
    .action(async (url: string, opts: {
      profile: LoadProfile; method: string; pid?: number; stepDuration: number; maxConnections: number; soakDuration: number;
      recoveryTimeout: number; header: string[]; includeSideEffects?: boolean; iOwnThis?: boolean; root?: string; json?: boolean;
    }) => {
      const out = await runLoadTest(rootOf(opts), {
        url, profile: opts.profile, method: opts.method, headers: parseHeaders(opts.header), pid: opts.pid,
        stepDuration: opts.stepDuration, maxConnections: opts.maxConnections, soakDuration: opts.soakDuration,
        recoveryTimeout: opts.recoveryTimeout, includeSideEffects: opts.includeSideEffects, iOwnThis: opts.iOwnThis,
      });
      process.stdout.write(opts.json ? JSON.stringify(out.result, null, 2) + "\n" : formatLoadSummary(out));
    });
}
