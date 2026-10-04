import { mkdir, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";

export const sample = (over: Record<string, unknown> = {}) => ({
  title: "Cart total ignores quantity",
  category: "functional",
  severity: "high",
  route: "/cart",
  steps: [{ action: "goto", url: "/cart" }],
  expected: "total = sum(price*qty)",
  actual: "total = sum(price)",
  ...over,
});

export async function writeTree(root: string, tree: Record<string, string>): Promise<void> {
  for (const [p, c] of Object.entries(tree)) {
    await mkdir(dirname(join(root, p)), { recursive: true });
    await writeFile(join(root, p), c);
  }
}
