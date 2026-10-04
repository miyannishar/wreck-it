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
