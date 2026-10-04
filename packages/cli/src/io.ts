import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { WreckError } from "./errors.js";

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

export async function readJsonInput(arg: string | undefined, file: string | undefined): Promise<unknown> {
  let raw: string;
  if (file) {
    try { raw = await readFile(file, "utf8"); }
    catch (e) { throw new WreckError(`cannot read ${file}: ${(e as Error).message}`, 2); }
  } else raw = arg && arg !== "-" ? arg : await readStdin();
  try { return JSON.parse(raw); }
  catch (e) { throw new WreckError(`input is not valid JSON: ${(e as Error).message}`, 2); }
}

/**
 * Run a command and collect its output; never throws (code -1 when it couldn't start or timed out). No shell unless
 * asked: `shell` is only for fixed commands (Windows needs it to find `npx.cmd`), never for arguments built from app data.
 */
export const runCommand = (cmd: string, args: string[], timeout = 10 * 60_000, opts: { shell?: boolean } = {}) => new Promise<{ code: number; out: string }>((res) => {
  execFile(cmd, args, { timeout, maxBuffer: 20 * 1024 * 1024, shell: !!opts.shell }, (err, stdout, stderr) =>
    res({ code: err ? (typeof err.code === "number" ? err.code : -1) : 0, out: (String(stdout) + String(stderr)).trim() }));
});
