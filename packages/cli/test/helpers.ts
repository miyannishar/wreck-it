import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

export const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "cli.js");

export function tmpRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "wreck-it-test-"));
}

export function runCli(
  args: string[],
  opts: { cwd?: string; input?: string } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = execFile("node", [CLI, ...args], { cwd: opts.cwd, timeout: 120_000 }, (err, stdout, stderr) => {
      const code = err ? (typeof (err as any).code === "number" ? (err as any).code : 1) : 0;
      resolve({ code, stdout: String(stdout), stderr: String(stderr) });
    });
    child.stdin?.end(opts.input ?? "");
  });
}
