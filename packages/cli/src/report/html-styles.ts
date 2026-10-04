export const STYLES = `
:root{color-scheme:light dark;--bg:#f6f7f9;--surface:#fff;--text:#1b1f27;--muted:#5b6472;--border:#dfe3ea;--code-bg:#f0f2f6;
--critical:#c62828;--high:#d9480f;--medium:#b7791f;--low:#5b6472;
--band-bad:#c62828;--band-risky:#b45309;--band-almost:#1d5fd1;--band-ship:#1b7f3b;
--bar-bg:#e6e9ef;--p50:#1d5fd1;--p99:#c2410c;--err:#c6282855;--bp:#c62828;--warn-bg:#fff4d6;--warn-text:#6b4a00}
@media (prefers-color-scheme:dark){:root{--bg:#0f1319;--surface:#171c24;--text:#e6e9ef;--muted:#9aa4b2;--border:#2a313c;--code-bg:#0d1117;
--critical:#ff6b6b;--high:#ff9a5c;--medium:#e8b04a;--low:#9aa4b2;
--band-bad:#ff6b6b;--band-risky:#f0a53a;--band-almost:#6ea8ff;--band-ship:#4cc972;
--bar-bg:#2a313c;--p50:#6ea8ff;--p99:#ff9a5c;--err:#ff6b6b66;--bp:#ff6b6b;--warn-bg:#3a2e10;--warn-text:#ffd98a}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif}
main{max-width:960px;margin:0 auto;padding:24px 16px 64px}
h1,h2,h3,h4{line-height:1.25;margin:0}
h2{font-size:1.25rem;margin:40px 0 14px}
h3{font-size:1rem;margin:24px 0 10px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
code,pre{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.88em}
code{background:var(--code-bg);padding:1px 5px;border-radius:4px;overflow-wrap:anywhere}
pre{background:var(--code-bg);border:1px solid var(--border);border-radius:8px;padding:12px;overflow-x:auto;margin:8px 0}
.muted{color:var(--muted)}
.card{background:var(--surface);border:1px solid var(--border);border-radius:12px}
.hero{padding:24px;display:flex;flex-wrap:wrap;gap:8px 28px;align-items:center;border-left:8px solid var(--band)}
.hero .name{width:100%;color:var(--muted);font-size:.9rem;overflow-wrap:anywhere}
.score{font-size:4.5rem;font-weight:800;line-height:1;letter-spacing:-.03em}
.score small{font-size:1.5rem;font-weight:600;color:var(--muted)}
.chip{display:inline-block;padding:4px 14px;border-radius:999px;background:var(--band);color:#fff;font-weight:700;font-size:.95rem}
@media (prefers-color-scheme:dark){.chip{color:#10141a}}
.band-bad{--band:var(--band-bad)}.band-risky{--band:var(--band-risky)}.band-almost{--band:var(--band-almost)}.band-ship{--band:var(--band-ship)}
.fixfirst{margin-top:16px;padding:14px 18px;border-left:6px solid var(--critical)}
.fixfirst b{display:block;font-size:.8rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
.banner{margin-top:16px;padding:12px 16px;border-radius:10px;background:var(--warn-bg);color:var(--warn-text);font-weight:600}
.cats{padding:8px 18px}
.cat{display:grid;grid-template-columns:7.5rem 1fr auto;gap:12px;align-items:center;padding:8px 0}
.cat+.cat{border-top:1px solid var(--border)}
.bar{height:10px;border-radius:5px;background:var(--bar-bg);overflow:hidden}
.bar i{display:block;height:100%;background:var(--band)}
.cat .n{white-space:nowrap;text-align:right;font-variant-numeric:tabular-nums;color:var(--muted);font-size:.9rem}
details.finding{margin:10px 0;border-left:6px solid var(--sev)}
.sev-critical{--sev:var(--critical)}.sev-high{--sev:var(--high)}.sev-medium{--sev:var(--medium)}.sev-low{--sev:var(--low)}
details.finding>summary{cursor:pointer;padding:12px 16px;display:flex;flex-wrap:wrap;gap:6px 10px;align-items:baseline;list-style-position:inside}
details.finding>summary .title{font-weight:600;overflow-wrap:anywhere;flex:1 1 14rem}
.tag{font-size:.75rem;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:var(--sev)}
.id{font-family:ui-monospace,Menlo,monospace;color:var(--muted);font-size:.85rem}
.body{padding:2px 18px 16px;overflow-wrap:anywhere}
.body h4{font-size:.8rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:16px 0 6px}
.body ol,.body ul{margin:0;padding-left:1.4em}
.shots{display:flex;flex-wrap:wrap;gap:10px}
.shots img{max-width:100%;height:auto;border:1px solid var(--border);border-radius:8px}
.scroll{overflow-x:auto}
table{border-collapse:collapse;width:100%;font-size:.9rem}
th,td{padding:6px 10px;border-bottom:1px solid var(--border);text-align:right;white-space:nowrap}
th:first-child,td:first-child{text-align:left}
th{color:var(--muted);font-weight:600}
td.l,th.l{text-align:left;white-space:normal;overflow-wrap:anywhere}
.load{padding:16px 18px;margin:12px 0}
.load h3{margin:0 0 10px;text-transform:none;letter-spacing:0;color:var(--text);overflow-wrap:anywhere}
.chart{min-width:480px;width:100%;height:auto;display:block;max-width:640px}
.chart .grid{stroke:var(--border);stroke-width:1}
.chart .axis{fill:var(--muted);font-size:10px}
.chart .p50{stroke:var(--p50);stroke-width:2.5}.chart .p99{stroke:var(--p99);stroke-width:2.5}
.chart .p50d{fill:var(--p50)}.chart .p99d{fill:var(--p99)}
.chart .err{fill:var(--err)}
.chart .bp{stroke:var(--bp);stroke-width:1.5}
.legend{display:flex;flex-wrap:wrap;gap:4px 16px;font-size:.85rem;color:var(--muted);margin:6px 0 12px}
.legend i{display:inline-block;width:12px;height:12px;border-radius:3px;margin-right:6px;vertical-align:-1px}
.cov{padding:14px 18px}.cov ul{margin:6px 0 0;padding-left:1.3em}
footer{margin-top:40px;color:var(--muted);font-size:.85rem}
@media (max-width:520px){.score{font-size:3.5rem}.cat{grid-template-columns:5.5rem 1fr auto;gap:8px}.n .ct{display:none}}
`;
