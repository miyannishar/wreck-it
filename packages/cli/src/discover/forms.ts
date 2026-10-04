import { type Ctx, type Form, lineAt } from "./types.js";

const MARKUP = /\.(?:tsx|jsx|svelte|vue|html)$/;
const OPEN = /<(form|Form)\b/g;
const TAG = /<([A-Za-z][\w.:-]*)\b/g;
const ATTR = (name: string) => new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|\\{\\s*["'\`]([^"'\`]*)["'\`]\\s*\\})`);

/** Index just past the `>` that closes a tag opened at `i`, skipping quoted strings and `{...}` expressions. */
export function tagEnd(src: string, i: number): number {
  let depth = 0, q = "";
  for (let j = i + 1; j < src.length; j++) {
    const c = src[j]!;
    if (q) { if (c === q && src[j - 1] !== "\\") q = ""; continue; }
    if (c === '"' || c === "'" || c === "`") q = c;
    else if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === ">" && depth <= 0) return j + 1;
  }
  return src.length;
}

const attr = (tag: string, name: string): string | undefined => {
  const m = ATTR(name).exec(tag);
  return m ? (m[1] ?? m[2] ?? m[3]) : undefined;
};

export function formsIn(src: string, file: string): Form[] {
  const out: Form[] = [];
  for (const m of src.matchAll(OPEN)) {
    const start = m.index!, headEnd = tagEnd(src, start);
    const head = src.slice(start + m[0].length, headEnd - 1);
    const close = new RegExp(`</${m[1]}\\s*>`, "g");
    close.lastIndex = headEnd;
    const end = head.trimEnd().endsWith("/") ? headEnd : (close.exec(src)?.index ?? src.length);
    const body = src.slice(headEnd, end);
    const fields: string[] = [];
    for (const t of body.matchAll(TAG)) {
      const tag = body.slice(t.index! + t[0].length, tagEnd(body, t.index!) - 1);
      const f = attr(tag, "name") ?? attr(tag, "id") ?? attr(tag, "aria-label");
      if (f && !fields.includes(f)) fields.push(f);
    }
    const action = attr(head, "action");
    out.push({ file, line: lineAt(src, start), fields, ...(action !== undefined ? { action } : {}) });
  }
  return out;
}

export async function forms(ctx: Ctx): Promise<Form[]> {
  const out: Form[] = [];
  for (const f of ctx.files) if (MARKUP.test(f)) out.push(...formsIn(await ctx.read(f), f));
  return out;
}
