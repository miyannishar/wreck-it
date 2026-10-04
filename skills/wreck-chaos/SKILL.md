---
name: wreck-chaos
description: Chaos-test a running local web app as the chaos-monkey persona, using hostile form inputs, double-submits, rapid clicks, back/forward/refresh mid-flow, multiple tabs, offline/slow/500-injected network, plus an axe-core accessibility scan and keyboard-only navigation. Records reproducible bugs with wreck-it. Use as stage 6 of a wreck-it run, or when the user asks to "break my forms", "chaos test", "try weird inputs", "test offline", or "check accessibility".
---

# wreck-chaos

Persona: `chaos-monkey`. This is curious, adversarial testing: break things with the techniques below. Don't attack the machine. Stay on the user's local app.

`npx wreck-it run stage chaos running`

Record every bug as described in the wreck-it skill's `references/recording-findings.md` (or run `npx wreck-it schema finding`). In short, record each bug with `npx wreck-it finding add`. Use structured steps and assertions that describe correct behavior. Replay the steps in a fresh context before you set `reproduced: true`. Record each distinct root cause once, not once per bad input.

Run the oddity script (`npx wreck-it oddity-script`) via `browser_evaluate` and check console and network after each attack, because chaos often surfaces as rendered `undefined`/`NaN` or a 500.

## 0. Page sweep (CLI, every page, two viewports)

```bash
npx wreck-it sweep --record
```

This visits every page in `discovery.json` at 1280x800 and 390x844. It logs in first with `accounts[0]` from `.wreck-it/config.json` when one is configured, fills dynamic routes from real links, and skips logout links. On each page it runs the oddity script and axe-core.

It records one reproduced finding per root cause:
- rendered `undefined`/`NaN`/`null`
- broken images
- dead links
- mobile horizontal overflow
- server errors
- accessibility rules

Read its "to judge yourself" list (console errors, overlaps, slow LCP) and record the real problems by hand.

**Stateful pages:** a page's content depends on the account's state (empty cart vs full cart). After the flows below have put the account into a richer state (items in the cart, an order placed), run `npx wreck-it sweep --record` **again**. It deduplicates, so only newly exposed problems get recorded. Example: a checkout form that appears only when the cart has items.

## 1. Hostile inputs (every form in `discovery.json` `forms`, plus any you find)

Try these inputs on each field, one field at a time. Fill the other fields with valid data so you can isolate the cause.

| Input | Value |
|---|---|
| empty / whitespace only | `""`, `"   "` |
| surrounding spaces | `" valid-value "` |
| overflow | 5,000 × `a`; a 300-char email local part |
| unicode | `Zoë 🦄 李雷 مرحبا`, combining chars `é`, zero-width `a​b` |
| numbers | `-1`, `0`, `1e309`, `999999999999`, `0.1+0.2`, `NaN`, `1,000` |
| dates | `2024-02-30`, `12/31/24`, `0000-00-00`, far future `9999-12-31` |
| markup and query fragments | `<b>bold</b>`, `'; --`, `%`, `_`, `\` |

Also probe **by field type**, both through the UI and, when the form posts JSON, with a direct `http` step to the API:
- **Quantity or amount fields:** `-1`, `0`, `1000000`, `2.5`. Then check totals and the stored value. Accepting a negative quantity or amount is `chaos`, high.
- **Codes and identifiers looked up server-side** (coupons, promo codes, usernames, slugs): surrounding spaces, lowercase, valid-but-inactive values.
- **Search boxes:** `%`, `%%`, `\`, `"`, `'`, 300 characters, emoji.

Bugs to look for:
- 500 or uncaught error
- value silently mangled or truncated
- broken layout (overflow)
- markup rendered instead of shown as text
- negative or absurd totals accepted
- validation that accepts junk or rejects valid input such as `Zoë`

These are `chaos` findings, severity by impact. Raw markup that renders as HTML is a security concern: don't file it as a finding. List it in your summary for the future security module.

## 2. Double-submit and rapid clicks

Browser clicks through MCP are often too slow to overlap. So also find the request the submit button sends (`browser_network_requests`) and fire it **twice concurrently** with the session cookie:

```bash
curl -s -b "<cookie>" -H 'content-type: application/json' -d '<body>' <baseUrl>/api/… & curl -s -b "<cookie>" -H 'content-type: application/json' -d '<body>' <baseUrl>/api/… & wait
```

If this creates two orders, charges or records, that's a `chaos` finding (high) with two `http` steps, even if the UI double-click didn't trigger it.

On every create, pay, order or send action, `click` with `count: 2`, then click 5 times fast. Then check the list or count for duplicates. A duplicate order or payment is `high` or `critical`.

## 3. Navigation abuse

- Mid-flow (multi-step forms, checkout): `back`, `forward` and `reload` at every step. Check that state is neither lost nor duplicated, and that you aren't asked to pay twice.
- After a successful submit, press `back`, then submit again.
- Two tabs on the same flow: use `browser_tabs` to open a second tab, finish the flow in tab A, then continue in tab B.
- Deep-link straight into step 3 of a flow, or into a detail page for an id that doesn't exist (`/items/999999`, `/items/abc`). Expect a real 404 or empty state, not a crash or a blank page.

## 4. Network faults

**Offline mid-request:** use the `setOffline` step. If your Playwright MCP exposes `browser_set_offline` or similar, use it. Otherwise call `browser_evaluate` to make the next `fetch` reject, which lets you observe UI handling. Record the reproducible version as a `setOffline` step.
- Submit a form offline, then go back online.
- Expect a clear error, with the user's input preserved and no false "Saved!".

**Slow network:** if a route-throttling tool is available, add 3 s of latency. Otherwise skip it and note that in your summary. Expect spinners to resolve, no double-submit, and a disabled submit button while pending.

**Injected 500s:** if a route-mocking tool is available (for example `browser_route`), make one API call return 500. Otherwise skip it. Expect a friendly error message, not a blank screen or an infinite spinner.

## 5. Accessibility

`sweep` (section 0) already ran axe on every page. For pages that only exist mid-flow (a modal, step 2 of a wizard), run `npx wreck-it a11y <url> --record` while that state is reachable by URL. Otherwise re-run `sweep` after reaching it.

**Keyboard-only:** walk each core flow with only `browser_press_key` (`Tab`, `Shift+Tab`, `Enter`, `Space`, `Escape`, arrows). Record these as `accessibility` findings:
- an unreachable control
- focus that isn't visible (check with a screenshot)
- a focus trap
- a modal that won't close with Escape
- an illogical tab order

## Finish

Write `.wreck-it/chaos-log.md` with one line per form or flow × technique (sections 0–5): what you tried, then ✓ (held up), ✗ WR-NNN, or "skipped: reason". Every section must have at least one line.

`npx wreck-it run stage chaos done`

Summarize the results by technique.
