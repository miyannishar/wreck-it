import { readdir } from "node:fs/promises";
import { join } from "node:path";

export const IGNORED_DIRS = new Set(["node_modules", ".next", "dist", "build", ".git", ".wreck-it", "coverage", ".svelte-kit", ".turbo", ".vercel", ".cache", ".output"]);
export const SCAN_EXT = /\.(?:[cm]?[jt]sx?|svelte|vue|html)$/;
export const MAX_FILES = 5000;

/** Breadth-first walk returning posix-relative source files; symlinks are skipped. */
export async function walk(root: string, max = MAX_FILES): Promise<{ files: string[]; capped: boolean }> {
  const files: string[] = [];
  const queue = [""];
  while (queue.length) {
    const rel = queue.shift()!;
    let ents;
    try { ents = await readdir(join(root, rel), { withFileTypes: true }); } catch { continue; }
    ents.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of ents) {
      const p = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { if (!IGNORED_DIRS.has(e.name)) queue.push(p); }
      else if (e.isFile() && SCAN_EXT.test(e.name)) {
        if (files.length >= max) return { files, capped: true };
        files.push(p);
      }
    }
  }
  return { files, capped: false };
}
