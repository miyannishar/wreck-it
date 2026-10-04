import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { chromium, type Browser, type LaunchOptions, type Page, type Response } from "playwright";
import { WreckError } from "./errors.js";
import { runCommand } from "./io.js";

/** `playwright install <what>` with the Playwright version this CLI ships (so the browser build matches). */
export async function playwrightInstall(what: string): Promise<{ ok: boolean; out: string }> {
  const cli = join(dirname(createRequire(import.meta.url).resolve("playwright/package.json")), "cli.js");
  const r = await runCommand(process.execPath, [cli, "install", what], 15 * 60_000);
  return { ok: r.code === 0, out: r.out };
}

let installing: Promise<void> | undefined;

/** Launch Chromium, downloading it once first when this is the first run on the machine. */
export async function launchChromium(opts: LaunchOptions = {}): Promise<Browser> {
  try { return await chromium.launch(opts); }
  catch (e) {
    if (!(e as Error).message.includes("Executable doesn't exist")) throw e;
    installing ??= (async () => {
      process.stderr.write("wreck-it: Chromium isn't installed yet; downloading it once (about 150 MB)…\n");
      const r = await playwrightInstall("chromium");
      if (!r.ok) throw new WreckError(`could not download Chromium (${r.out.split("\n").pop()}); run: npx @miyannishar/wreck-it setup`, 1);
    })();
    await installing;
    return chromium.launch(opts);
  }
}

/** Open a URL and wait for client-rendered content; pages that poll never reach idle, so the wait is capped. */
export async function openSettled(page: Page, url: string): Promise<Response | null> {
  const res = await page.goto(url, { waitUntil: "load", timeout: 30_000 });
  await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => {});
  return res;
}
