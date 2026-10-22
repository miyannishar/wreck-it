#!/usr/bin/env node
// Export the existing narrated storyboard as an edit-ready H.264/AAC MP4.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i < 0 ? fallback : process.argv[i + 1]; };
const speed = Number(arg('--speed', '1.2'));
assert(Number.isFinite(speed) && speed >= 1 && speed <= 2, 'Use a speed between 1 and 2.');
const out = resolve(arg('--out', join(root, `.wreck-it/demo/exports/wreck-it-walkthrough-${speed}x.mp4`)));
const work = join(root, `.wreck-it/demo/export-${speed}x`);
mkdirSync(work, { recursive: true }); mkdirSync(dirname(out), { recursive: true });
const timing = JSON.parse(readFileSync(join(root, 'docs/demo/narration/timings.json'), 'utf8'));
const python = join(root, '.wreck-it/demo-voice-env/bin/python');
assert(existsSync(python), 'Create the demo voice environment first; see DEMO_WALKTHROUGH.md.');
const ffmpeg = execFileSync(python, ['-c', 'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())'], { encoding: 'utf8' }).trim();
const run = promisify(execFile);
const { chromium } = await import(pathToFileURL(join(root, '.wreck-it/demo/app/node_modules/playwright/index.mjs')).href);
const fps = 30;
const frames = Math.round(timing.durationSeconds / speed * fps);
const cuts = timing.scenes.flatMap((scene, i) => {
  const end = timing.scenes[i + 1]?.startSeconds ?? timing.durationSeconds;
  return i === 3 ? [{ start: scene.startSeconds, end: scene.startSeconds + 5, scene: i }, { start: scene.startSeconds + 5, end, scene: i }] : [{ start: scene.startSeconds, end, scene: i }];
});
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 810 }, deviceScaleFactor: 4 / 3 });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(pathToFileURL(join(root, 'docs/demo/preview.html')).href);
  await page.waitForFunction(() => Number.isFinite(document.querySelector('audio').duration));
  await page.addStyleTag({ content: 'html,body{width:1440px;height:810px;overflow:hidden}main{max-width:none;width:1440px;padding:0;margin:0}header,audio,.chapters,.note,footer{display:none!important}.stage{width:1440px;height:810px;border:0;border-radius:0;aspect-ratio:auto}.bar{display:none!important}' });
  await page.evaluate(() => document.fonts.ready);
  const clips = [];
  for (const [index, cut] of cuts.entries()) {
    const image = join(work, `${String(index + 1).padStart(2, '0')}.png`);
    const frameStart = Math.round(cut.start / speed * fps);
    const frameEnd = index + 1 === cuts.length ? frames : Math.round(cut.end / speed * fps);
    assert(frameEnd > frameStart);
    // A still from each scene; the quantity scene has separate cart/checkout cuts.
    const position = Math.min(cut.end - 0.01, cut.start + 0.12);
    await page.locator('audio').evaluate((audio, t) => { audio.pause(); audio.currentTime = t; }, position);
    await page.evaluate(() => sync());
    await page.waitForFunction(i => [...document.querySelectorAll('.scene')].findIndex(s => s.classList.contains('active')) === i, cut.scene);
    await page.waitForFunction(() => [...document.querySelector('.scene.active').querySelectorAll('img')].every(image => image.complete && image.naturalWidth > 0));
    await page.locator('.stage').screenshot({ path: image, animations: 'disabled' });
    const clip = join(work, `${String(index + 1).padStart(2, '0')}.mp4`);
    console.log(`Rendering ${index + 1}/${cuts.length}: ${timing.scenes[cut.scene].title}`);
    await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-loop', '1', '-framerate', String(fps), '-i', image, '-frames:v', String(frameEnd - frameStart), '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', String(fps), '-video_track_timescale', '90000', clip], { timeout: 120_000, maxBuffer: 2e6 });
    clips.push(clip);
  }
  assert.deepEqual(errors, []);
  // ffconcat quoting is a format-specific escape, not shell interpolation.
  const quote = value => "'" + value.replace(/'/g, "'\\''") + "'";
  const concat = join(work, 'clips.ffconcat');
  writeFileSync(concat, 'ffconcat version 1.0\n' + clips.map(clip => `file ${quote(clip)}`).join('\n') + '\n');
  await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', concat, '-i', join(root, 'docs/demo/narration/voiceover.mp3'), '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-af', `atempo=${speed},apad`, '-c:a', 'aac', '-b:a', '192k', '-t', String(frames / fps), '-movflags', '+faststart', '-metadata', 'title=wreck-it product walkthrough', '-metadata', `comment=Seeded app; narrated storyboard and scripted replay; ${speed}x speed`, out], { timeout: 120_000, maxBuffer: 2e6 });
  const srt = readFileSync(join(root, 'docs/demo/narration/voiceover.srt'), 'utf8');
  const format = value => {
    let total = Math.round(value / speed); const ms = total % 1000; total = Math.floor(total / 1000);
    const sec = total % 60; total = Math.floor(total / 60); const min = total % 60; const h = Math.floor(total / 60);
    return [h, min, sec].map(n => String(n).padStart(2, '0')).join(':') + ',' + String(ms).padStart(3, '0');
  };
  const captions = out.replace(/\.mp4$/i, '.srt');
  writeFileSync(captions, srt.replace(/(\d{2}):(\d{2}):(\d{2}),(\d{3})/g, (_, h, m, s, ms) => format((Number(h) * 3600 + Number(m) * 60 + Number(s)) * 1000 + Number(ms))));
  const metadata = { source: 'docs/demo/preview.html', kind: 'narrated-storyboard-export', speed, width: 1920, height: 1080, fps, frames, durationSeconds: frames / fps, audio: 'AAC; pitch preserved using atempo', video: 'H.264 / yuv420p', sizeBytes: statSync(out).size, scenes: timing.scenes.map(s => ({ id: s.id, startSeconds: s.startSeconds / speed, endSeconds: s.endSeconds / speed })), mp4: out, captions };
  writeFileSync(out.replace(/\.mp4$/i, '.json'), JSON.stringify(metadata, null, 2) + '\n');
  console.log(JSON.stringify(metadata, null, 2));
} finally { await browser.close(); }
