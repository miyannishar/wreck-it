import type { LoadResult } from "../load/types.js";
import { escapeHtml as esc } from "./escape.js";

const W = 600, H = 240;
const PAD = { l: 40, r: 40, t: 14, b: 40 };

function niceCeil(v: number): number {
  if (!(v > 0)) return 1;
  const mag = 10 ** Math.floor(Math.log10(v));
  const n = v / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag;
}
const f = (n: number): string => (Math.round(n * 10) / 10).toString();

/** Inline SVG: p50/p99 latency lines (ms), error-rate bars (0-100%), breaking-point marker. Colors come from CSS classes. */
export function latencyChart(r: LoadResult): string {
  const phases = r.phases;
  if (!phases.length) return "";
  const pw = W - PAD.l - PAD.r, ph = H - PAD.t - PAD.b;
  const yMax = niceCeil(Math.max(...phases.map((p) => p.latency.p99), ...phases.map((p) => p.latency.p50)));
  const slot = pw / phases.length;
  const x = (i: number) => PAD.l + slot * (i + 0.5);
  const yMs = (ms: number) => PAD.t + ph * (1 - Math.min(ms, yMax) / yMax);
  const line = (cls: string, pick: (i: number) => number) =>
    `<polyline class="${cls}" fill="none" points="${phases.map((_, i) => `${f(x(i))},${f(yMs(pick(i)))}`).join(" ")}"/>`;

  const o: string[] = [];
  o.push(`<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" xmlns="http://www.w3.org/2000/svg">`);
  o.push(`<title>${esc(`Latency and error rate by connections for ${r.method.toUpperCase()} ${r.url}`)}</title>`);
  for (let k = 0; k <= 4; k++) {
    const y = PAD.t + (ph * k) / 4;
    o.push(`<line class="grid" x1="${PAD.l}" y1="${f(y)}" x2="${W - PAD.r}" y2="${f(y)}"/>`);
    o.push(`<text class="axis" x="${PAD.l - 6}" y="${f(y + 3)}" text-anchor="end">${esc(String(Math.round((yMax * (4 - k)) / 4)))}</text>`);
    o.push(`<text class="axis" x="${W - PAD.r + 6}" y="${f(y + 3)}" text-anchor="start">${25 * (4 - k)}%</text>`);
  }
  phases.forEach((p, i) => {
    const bw = Math.min(28, slot * 0.5), h = ph * Math.min(Math.max(p.errorRate, 0), 1);
    if (h > 0) o.push(`<rect class="err" x="${f(x(i) - bw / 2)}" y="${f(PAD.t + ph - h)}" width="${f(bw)}" height="${f(h)}"><title>${esc(`${p.connections} connections: ${(p.errorRate * 100).toFixed(1)}% errors`)}</title></rect>`);
    o.push(`<text class="axis" x="${f(x(i))}" y="${H - PAD.b + 16}" text-anchor="middle">${esc(String(p.connections))}</text>`);
  });
  if (r.breakingPoint) {
    const i = phases.findIndex((p) => p.connections === r.breakingPoint!.connections);
    if (i >= 0) o.push(`<line class="bp" stroke-dasharray="4 4" x1="${f(x(i))}" y1="${PAD.t}" x2="${f(x(i))}" y2="${PAD.t + ph}"><title>${esc(`Breaking point: ${r.breakingPoint.reason}`)}</title></line>`);
  }
  o.push(line("p99", (i) => phases[i]!.latency.p99));
  o.push(line("p50", (i) => phases[i]!.latency.p50));
  phases.forEach((p, i) => {
    o.push(`<circle class="p99d" cx="${f(x(i))}" cy="${f(yMs(p.latency.p99))}" r="3"><title>${esc(`${p.connections} connections: p99 ${p.latency.p99} ms`)}</title></circle>`);
    o.push(`<circle class="p50d" cx="${f(x(i))}" cy="${f(yMs(p.latency.p50))}" r="3"><title>${esc(`${p.connections} connections: p50 ${p.latency.p50} ms`)}</title></circle>`);
  });
  o.push(`<text class="axis" x="${PAD.l + pw / 2}" y="${H - 6}" text-anchor="middle">connections</text>`);
  o.push(`<text class="axis" x="10" y="${PAD.t + ph / 2}" text-anchor="middle" transform="rotate(-90 10 ${PAD.t + ph / 2})">latency (ms)</text>`);
  o.push(`<text class="axis" x="${W - 8}" y="${PAD.t + ph / 2}" text-anchor="middle" transform="rotate(90 ${W - 8} ${PAD.t + ph / 2})">error rate</text>`);
  o.push("</svg>");
  return o.join("");
}
