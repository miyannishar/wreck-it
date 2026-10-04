export function rootOf(opts: { root?: string }): string {
  return opts.root ?? process.cwd();
}
