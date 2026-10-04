/** Self-contained browser function (string) for Playwright MCP `browser_evaluate`. No imports, no TS. */
export const ODDITY_SCRIPT: string = String.raw`async () => {
  const signals = [];
  const add = (kind, detail, selector) => signals.push(selector ? { kind, detail, selector } : { kind, detail });
  const sel = (el) => {
    const parts = [];
    for (let n = el; n && n.nodeType === 1 && n !== document.documentElement && parts.length < 4; n = n.parentElement) {
      if (n.id) { parts.unshift("#" + CSS.escape(n.id)); break; }
      let s = n.tagName.toLowerCase();
      const c = typeof n.className === "string" ? n.className.trim().split(/\s+/).filter(Boolean)[0] : "";
      if (c) s += "." + CSS.escape(c);
      else if (n.parentElement) { const same = Array.from(n.parentElement.children).filter((x) => x.tagName === n.tagName); if (same.length > 1) s += ":nth-of-type(" + (same.indexOf(n) + 1) + ")"; }
      parts.unshift(s);
    }
    return parts.join(" > ");
  };
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== "hidden" && cs.display !== "none" && cs.opacity !== "0";
  };
  const trunc = (s, n) => (s.length > n ? s.slice(0, n) + "..." : s);

  // rendered placeholders
  const PHS = /\bundefined\b|\bNaN\b|\bnull\b|\[object Object\]|\{\{[^}]*\}\}|Invalid Date/;
  const skip = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "CODE", "PRE", "TEXTAREA", "TEMPLATE"]);
  if (document.body) {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const seen = new Set();
    for (let n = walker.nextNode(); n && seen.size < 10; n = walker.nextNode()) {
      const el = n.parentElement;
      if (!el || skip.has(el.tagName) || el.closest("script,style,noscript,code,pre,textarea,template")) continue;
      const t = n.nodeValue || "";
      const m = PHS.exec(t) || (/Lorem ipsum/i.test(t) ? /Lorem ipsum/i.exec(t) : null);
      if (!m || !visible(el)) continue;
      const key = sel(el) + "|" + m[0];
      if (seen.has(key)) continue;
      seen.add(key);
      add("rendered-placeholder", "text contains \"" + m[0] + "\": " + trunc(t.trim().replace(/\s+/g, " "), 80), sel(el));
    }
  }

  // broken images
  for (const img of Array.from(document.images)) {
    if (img.getAttribute("src") && img.complete && img.naturalWidth === 0) add("broken-image", "image failed to load: " + trunc(img.currentSrc || img.getAttribute("src"), 120), sel(img));
  }

  // horizontal overflow
  const root = document.documentElement;
  if (root.scrollWidth > window.innerWidth + 1) {
    const bad = [];
    for (const el of Array.from(document.body ? document.body.querySelectorAll("*") : [])) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.right > window.innerWidth + 1) bad.push({ el, right: r.right });
    }
    bad.sort((a, b) => b.right - a.right);
    add("horizontal-overflow", "page scrollWidth " + root.scrollWidth + "px exceeds viewport " + window.innerWidth + "px");
    for (const b of bad.slice(0, 5)) add("horizontal-overflow", "element extends to " + Math.round(b.right) + "px (viewport " + window.innerWidth + "px)", sel(b.el));
  }

  // overlapping interactive elements
  const inter = Array.from(document.querySelectorAll("a, button, input, select, textarea, [role=button]"))
    .filter((e) => !(e.tagName === "INPUT" && e.type === "hidden") && visible(e)).slice(0, 200)
    .map((e) => ({ e, r: e.getBoundingClientRect() }));
  let overlaps = 0;
  for (let i = 0; i < inter.length && overlaps < 5; i++) {
    for (let j = i + 1; j < inter.length && overlaps < 5; j++) {
      const a = inter[i], b = inter[j];
      if (a.e.contains(b.e) || b.e.contains(a.e)) continue;
      const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
      const h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
      if (w <= 0 || h <= 0) continue;
      const small = Math.min(a.r.width * a.r.height, b.r.width * b.r.height);
      if (small > 0 && (w * h) / small > 0.3) {
        overlaps++;
        add("overlap", "overlaps " + sel(b.e) + " by " + Math.round(((w * h) / small) * 100) + "% of the smaller element", sel(a.e));
      }
    }
  }

  // dead same-origin links
  const hrefs = [];
  for (const a of Array.from(document.querySelectorAll("a[href]"))) {
    if (a.origin !== location.origin || !/^https?:$/.test(a.protocol)) continue;
    // Never probe links that change state when fetched (logging out would end the tester's session).
    if (a.hasAttribute("download") || /(log-?out|sign-?out|delete|remove|destroy|unsubscribe|cancel)/i.test(a.pathname + a.search)) continue;
    const u = a.href.split("#")[0];
    if (u === location.href.split("#")[0] || hrefs.some((h) => h.u === u)) continue;
    hrefs.push({ u, a });
    if (hrefs.length >= 25) break;
  }
  const probe = async (u, method) => {
    try { const r = await fetch(u, { method, redirect: "follow", signal: AbortSignal.timeout(4000) }); return String(r.status); }
    catch (e) { return e && e.name === "TimeoutError" ? "timeout" : "network error"; }
  };
  const results = await Promise.all(hrefs.map(async ({ u, a }) => {
    let s = await probe(u, "HEAD");
    if (!/^\d+$/.test(s) || Number(s) >= 400) s = await probe(u, "GET");
    return { u, a, s };
  }));
  for (const { u, a, s } of results) if (!/^\d+$/.test(s) || Number(s) >= 400) add("dead-link", u + " -> " + s, sel(a));

  // slow LCP
  const lcp = await new Promise((resolve) => {
    try {
      let last = 0;
      const po = new PerformanceObserver((l) => { for (const e of l.getEntries()) last = e.startTime; });
      po.observe({ type: "largest-contentful-paint", buffered: true });
      setTimeout(() => { for (const e of po.takeRecords()) last = e.startTime; po.disconnect(); resolve(last); }, 1000);
    } catch (e) { resolve(0); }
  });
  if (lcp > 2500) add("slow-lcp", "largest contentful paint " + Math.round(lcp) + "ms (> 2500ms)");

  // empty page
  const text = document.body ? document.body.innerText.trim() : "";
  if (text.length < 20) add("empty-page", "body has only " + text.length + " characters of visible text");

  return { url: location.href, signals };
}`;
