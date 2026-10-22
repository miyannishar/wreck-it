#!/usr/bin/env node
// A narrated storyboard using verified screenshots, not simulated agent output.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = name => readFileSync(join(root, name), 'utf8');
const timing = JSON.parse(read('.wreck-it/demo/media/timings.json'));
const verification = JSON.parse(read('docs/demo/sample/verification.json'));
assert.equal(verification.results.buggy.failed, 1);
assert.equal(verification.results.fixed.passed, 1);
assert.equal(verification.originalFixtureUnchanged, true);
assert.equal(read('docs/demo/voiceover.txt').trim(), timing.scenes.map(s => s.narration).join('\n\n'));
mkdirSync(join(root, 'docs/demo/narration'), { recursive: true });
for (const name of ['voiceover.mp3', 'voiceover.srt', 'timings.json']) {
  copyFileSync(join(root, '.wreck-it/demo/media', name), join(root, 'docs/demo/narration', name));
}
const payload = JSON.stringify({ timing, verification }).replace(/</g, '\\u003c');
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>wreck-it · narrated walkthrough preview</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#080d13;color:#eff6fb;font:16px/1.5 system-ui,-apple-system,sans-serif}main{max-width:1440px;margin:auto;padding:22px}a{color:#c7f36b}header{display:flex;justify-content:space-between;gap:20px;align-items:center;margin-bottom:14px}header b{font-size:24px}header span{color:#9baab9;font-size:13px}.stage{aspect-ratio:16/9;background:#111923;border:1px solid #293645;border-radius:16px;position:relative;overflow:hidden}.scene{position:absolute;inset:0;padding:7% 7% 15%;display:none}.scene.active{display:flex;flex-direction:column;justify-content:center}.eyebrow{font-size:14px;letter-spacing:.12em;text-transform:uppercase;color:#c7f36b;margin:0 0 18px}h1{font-size:clamp(34px,5.4vw,76px);line-height:1.08;letter-spacing:-.045em;margin:0 0 25px;max-width:1000px}h2{font-size:clamp(24px,3vw,42px);line-height:1.15;margin:0 0 22px;letter-spacing:-.025em}.sub{font-size:clamp(17px,2vw,28px);color:#aebcc9;max-width:920px;margin:0}code,pre{font-family:ui-monospace,SFMono-Regular,monospace}pre{font-size:clamp(13px,1.6vw,23px);line-height:1.6;padding:24px;background:#080e16;border:1px solid #304052;border-radius:12px;white-space:pre-wrap;overflow-wrap:anywhere}.muted{color:#9daebd}.chip{display:inline-block;width:fit-content;padding:7px 13px;border:1px solid #41562d;border-radius:30px;color:#d4f9a0;font-size:14px;margin:16px 0}.browser{padding:2.5% 5% 12%}.browser img{width:100%;height:100%;object-fit:contain;object-position:top;border-radius:10px;background:white}.split{display:grid;grid-template-columns:1fr 1fr;gap:25px;align-items:center}.split img{width:100%;border-radius:8px}.good{color:#b3ec79}.bad{color:#ffa6a3}.results{display:grid;grid-template-columns:1fr 1fr;gap:18px}.result{padding:22px;border:1px solid #334251;border-radius:10px;font-size:clamp(17px,2vw,27px)}.result strong{font-size:clamp(24px,3.2vw,45px);display:block}.caption{position:absolute;bottom:3%;left:7%;right:7%;background:rgba(3,9,15,.94);padding:13px 20px;border-radius:9px;text-align:center;font-size:clamp(14px,1.65vw,23px);line-height:1.45}.tag{position:absolute;top:18px;right:22px;font-size:12px;background:#080e16bb;padding:5px 10px;border-radius:20px;color:#c2cbd4}.bar{height:4px;position:absolute;bottom:0;left:0;background:#c7f36b;width:0}audio{width:100%;margin:18px 0 9px}.chapters{display:flex;flex-wrap:wrap;gap:8px}button{background:#162332;color:#eaf1f8;border:1px solid #35495c;border-radius:8px;padding:9px 13px;cursor:pointer}button[aria-current=true]{border-color:#c7f36b;color:#c7f36b}.note{color:#9babb9;font-size:14px;margin-top:16px}footer{display:flex;gap:25px;flex-wrap:wrap;margin-top:16px;font-size:14px}@media(max-width:700px){main{padding:10px}header{align-items:start;flex-direction:column;gap:3px}.scene{padding:5% 5% 20%}.caption{left:3%;right:3%;font-size:12px;padding:6px}.split{gap:12px}pre{padding:12px}.eyebrow{margin-bottom:8px;font-size:11px}.tag{display:none}h1,h2{margin-bottom:12px}.result{padding:10px}}
</style></head><body><main>
<header><b>wreck-it / product walkthrough</b><span>AI narration · verified demo evidence · storyboard preview</span></header>
<div class="stage">
<section class="scene active"><p class="eyebrow">QA for local web apps</p><h1>Wreck your app<br>before your users do.</h1><p class="sub">Your coding agent. A focused QA workflow. Reproduced bugs with evidence.</p><span class="chip">wreck-it 0.2.0</span></section>
<section class="scene"><p class="eyebrow">01 / Set up</p><h2>Start locally. Load the skills.</h2><pre>npx skills add miyannishar/wreck-it<br>npx @miyanishar/wreck-it setup</pre><p class="sub">Run your app, complete setup, then restart your agent.</p></section>
<section class="scene"><p class="eyebrow">02 / Choose a flow</p><h2>Focus on checkout.</h2><pre>/wreck focus checkout</pre><p class="sub">Cart → Checkout → supporting APIs</p><span class="chip">Example prompt · record the real agent session for the final video</span></section>
<section class="scene browser"><img id="bug" src="sample/shots/buggy-cart.png" alt="Three earbuds have a $239.97 line total but an incorrect $79.99 subtotal"></section>
<section class="scene"><p class="eyebrow">04 / Inspect the finding</p><h2>Screenshot. Repro steps. Source.</h2><div class="split"><img src="sample/shots/buggy-checkout.png" alt="Checkout screenshot showing the quantity bug"><div><p class="muted">WR-001 · high · functional</p><pre>lib/cart.ts:19<br><span class="bad">sum + item.price</span><br><br>// corrected copy<br><span class="good">sum + item.lineTotal</span></pre></div></div></section>
<section class="scene"><p class="eyebrow">05 / Review the report and test</p><h2>Verify the generated check.</h2><pre>expect(page.locator('.summary-total'))<br>  .toContainText('$239.97')</pre><div class="results"><div class="result bad">Buggy copy<strong>1 failed</strong><small>Received: $79.99</small></div><div class="result good">Corrected copy<strong>1 passed</strong><small>Received: $239.97</small></div></div><p class="muted">Same generated spec · zero skips · verified with the published CLI</p></section>
<section class="scene"><p class="eyebrow">Try wreck-it</p><h1>Wreck your app<br>before your users do.</h1><p class="sub">github.com/miyannishar/wreck-it</p></section>
<div class="tag">Seeded demo app · scripted replay</div><div class="caption" id="caption"></div><div class="bar" id="progress"></div>
</div>
<audio id="audio" controls preload="metadata" src="narration/voiceover.mp3"></audio>
<div class="chapters" id="chapters"></div>
<p class="note">This preview pairs AI narration with verified screenshots and explanatory cards. The prompt card is a filming cue. The final cut still needs a real agent recording and the report walkthrough.</p>
<footer><a href="sample/report.html">Open sample report</a><a href="sample/WR-001.spec.ts">Generated test</a><a href="sample/verification.json">Verification</a><a href="../../DEMO_WALKTHROUGH.md">Recording guide</a></footer>
</main><script>
const data=${payload};
const audio=document.getElementById('audio');
const scenes=[...document.querySelectorAll('.scene')];
const caption=document.getElementById('caption');
const chapters=document.getElementById('chapters');
data.timing.scenes.forEach((scene,i)=>{const b=document.createElement('button');b.textContent=(i+1)+'. '+scene.title;b.onclick=()=>{audio.currentTime=scene.startSeconds;sync()};chapters.append(b)});
function sync(){const t=audio.currentTime;let i=data.timing.scenes.findLastIndex(s=>t>=s.startSeconds);i=Math.max(0,i);scenes.forEach((s,n)=>s.classList.toggle('active',n===i));[...chapters.children].forEach((b,n)=>b.setAttribute('aria-current',String(n===i)));caption.textContent=data.timing.scenes[i].narration;document.getElementById('progress').style.width=(t/data.timing.durationSeconds*100)+'%';if(i===3){const checkout=t-data.timing.scenes[i].startSeconds>5;const image=document.getElementById('bug');image.src=checkout?'sample/shots/buggy-checkout.png':'sample/shots/buggy-cart.png';image.alt=checkout?'Checkout incorrectly totals three earbuds at $79.99':'Cart line total is $239.97 while the subtotal is $79.99';}}
audio.addEventListener('timeupdate',sync);audio.addEventListener('seeked',sync);sync();
</script></body></html>`;
const out = join(root, 'docs/demo/preview.html');
writeFileSync(out, html);
console.log(`Narrated storyboard: ${out}`);
