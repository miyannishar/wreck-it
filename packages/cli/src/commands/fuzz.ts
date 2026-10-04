import { Command } from "commander";
import { rootOf } from "../options.js";
import { WreckError } from "../errors.js";
import { runFuzz, formatFuzz, type Seed } from "../fuzz.js";

const parseSeed = (raw: string, all: Seed[]): Seed[] => {
  let j: any;
  try { j = JSON.parse(raw); } catch (e) { throw new WreckError(`--seed is not valid JSON: ${(e as Error).message}`, 2); }
  if (typeof j?.method !== "string" || typeof j?.path !== "string") throw new WreckError('--seed needs {"method": "POST", "path": "/api/x", "body": {...}}', 2);
  return [...all, { method: j.method.toUpperCase(), path: j.path, ...(j.body ? { body: j.body } : {}), ...(j.query ? { query: j.query } : {}), source: "--seed" }];
};

export function registerFuzzCommands(program: Command): void {
  program.command("fuzz").description("Send bad values (negative, huge, empty, wrong type, padded, missing…) to the app's API one field at a time; runs Schemathesis too when an OpenAPI spec exists")
    .option("--seed <json>", 'a real request to start from, e.g. {"method":"POST","path":"/api/cart","body":{"productId":"p1","quantity":1}} (repeatable; also read from .wreck-it/requests.json)', parseSeed, [] as Seed[])
    .option("--base-url <url>").option("--max-requests <n>", "stop after this many requests", "400")
    .option("--include-delete", "also fuzz DELETE endpoints").option("--schemathesis <mode>", "auto | always | never", "auto")
    .option("--record", "record reproduced server errors as findings").option("--allow-remote-db", "fuzz even though the database looks remote (or set allowRemoteDb in config after asking the user)")
    .option("--include-side-effects", "also fuzz endpoints that call AI models, send email/SMS or take payments")
    .option("--only <route...>", "focused run: only these routes and the ones below them").option("--account <label>", "log in as this account from .wreck-it/config.json (default: the first)").option("--i-own-this", "allow a non-local target you own").option("--root <dir>").option("--json")
    .action(async (opts: { seed: Seed[]; baseUrl?: string; maxRequests: string; includeDelete?: boolean; schemathesis: string; record?: boolean; allowRemoteDb?: boolean; includeSideEffects?: boolean; only?: string[]; account?: string; iOwnThis?: boolean; root?: string; json?: boolean }) => {
      if (!["auto", "always", "never"].includes(opts.schemathesis)) throw new WreckError("--schemathesis must be auto, always or never", 2);
      const r = await runFuzz(rootOf(opts), {
        seeds: opts.seed, baseUrl: opts.baseUrl, maxRequests: Math.max(1, Number(opts.maxRequests) || 400), includeDelete: opts.includeDelete,
        record: opts.record, allowRemoteDb: opts.allowRemoteDb, includeSideEffects: opts.includeSideEffects, only: opts.only, account: opts.account, iOwnThis: opts.iOwnThis, schemathesis: opts.schemathesis as "auto" | "always" | "never",
      });
      process.stdout.write(opts.json ? JSON.stringify(r, null, 2) + "\n" : formatFuzz(r));
    });
}
