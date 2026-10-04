# Recording findings

Every wreck-it stage records bugs the same way. The CLI validates and stores them, so the report, score and generated tests stay deterministic.

## The command

```bash
npx wreck-it finding add --file /tmp/wr-finding.json     # or: echo '<json>' | npx wreck-it finding add
# → {"id":"WR-007","warnings":[]}
npx wreck-it finding update WR-007 '{"reproduced":true}'
npx wreck-it finding list
npx wreck-it schema finding                               # full JSON Schema when in doubt
```

If the CLI rejects the JSON, it prints `field.path: message` lines. Fix exactly those fields and retry. Never hand-write files into `.wreck-it/findings/`.

## Shape

```json
{
  "title": "Checkout crashes when coupon has surrounding spaces",
  "category": "chaos",
  "severity": "high",
  "persona": "rushed-beginner",
  "route": "/cart",
  "steps": [
    { "action": "goto", "url": "/cart" },
    { "action": "fill", "target": { "by": "label", "value": "Coupon" }, "value": " SAVE10 " },
    { "action": "click", "target": { "by": "role", "role": "button", "name": "Apply" } }
  ],
  "assertions": [
    { "kind": "noServerErrors" },
    { "kind": "text", "target": { "by": "testId", "value": "cart-total" }, "contains": "$" }
  ],
  "expected": "Coupon is trimmed and applied, or a friendly validation message appears",
  "actual": "POST /api/coupon returns 500 and the page shows a blank error overlay",
  "evidence": {
    "screenshots": ["/abs/path/from/browser_take_screenshot.png"],
    "console": ["TypeError: Cannot read properties of undefined (reading 'toUpperCase')"],
    "network": [{ "method": "POST", "url": "/api/coupon", "status": 500 }]
  },
  "reproduced": false
}
```

- **category**: `functional | ux | oddity | chaos | performance | security | accessibility`. Do not file `security` findings; that module is not part of v1.
- **steps**: structured and replayable. `goto` (path relative to the base URL), `click` (+`count` for double clicks), `fill`, `select`, `check`, `uncheck`, `hover`, `press` (`key`, optional `target`), `wait` (`ms`), `reload`, `back`, `forward`, `setOffline` (`offline`), `setViewport` (`width`, `height`), `http` (`method`, `url`, optional `headers`, `body`).
- **targets**: prefer `{ "by": "role", "role": "button", "name": "Place order" }`, then `label`, `placeholder`, `text`, `testId`. Use `css` only as a last resort. Read the names from `browser_snapshot`, not guesswork.
- **assertions** describe the **correct** behavior. The generated regression test runs the steps and then the assertions, so it must fail while the bug exists and pass once it's fixed. Kinds: `visible`, `hidden`, `text` (`contains`, optional `negate`), `url` (`contains`), `count` (`equals`), `noConsoleErrors`, `noServerErrors`, `httpStatus` (`equals`, `below` or `atLeast`, needs an `http` step). If you can't express the correct behavior, leave `assertions` empty; the test is generated as `test.fixme`.
- **Assertions must be false on the app right now.** Before recording, check each one against what you just saw. If the bug is present, would this assertion fail? Common mistakes:
  - asserting something the bug doesn't affect (checking a date when the bug is sort order)
  - pinning a value that changes per run (a random total, a stock count)
  - getting the direction backwards: for an invalid input the server wrongly accepts, use `{"kind":"httpStatus","atLeast":400}`, not `below`
- **Re-runnable data**: put `{{unique}}` in values that must be fresh each run (sign-up emails, usernames), e.g. `wreck.tester+{{unique}}@example.com`. Generated tests replace it with a per-run value.
- **screenshots**: pass the path the screenshot tool reported. The CLI copies it into `.wreck-it/shots/`. A missing file only produces a warning.

## Severity

| Severity | Use when |
|---|---|
| critical | Data loss or corruption, core flow (sign-up, login, checkout, create) impossible, server crash |
| high | Wrong results users will act on (wrong totals, duplicate orders), 500 on a reachable input, feature broken |
| medium | Feature works with a workaround, confusing UX that causes errors, visible oddity on a main page |
| low | Cosmetic, minor copy or format inconsistency, minor a11y issue |

Escalate an `oddity` to `functional` when it misleads users or loses data.

## Reproduce immediately (not later)

A finding counts toward the score only with `reproduced: true`. Unreproduced findings score nothing, and runs that "reproduce later" usually never do. So reproduce each finding **right after** `finding add`, before you move on:

1. Open a **fresh** context (`browser_close`, then navigate again, or a new isolated browser).
2. Replay `steps` exactly as written.
3. If the bug shows again: `npx wreck-it finding update WR-007 '{"reproduced":true}'`.
4. If it does not: leave it `false`. The report lists it under *Flaky / unconfirmed*. Do not delete it.

For `http` steps, replay the request with `curl` instead of the browser.

## Don'ts

- Don't invent source locations. Tracing is the `wreck-trace` stage. A low-confidence `source` lists `candidates` and no `line`.
- Don't file the same root cause twice. Check `npx wreck-it finding list` first and update the existing finding instead. One broken site-wide component (header, footer) is one finding, not one per page.
- Don't record expected behavior as a bug because it looks unusual. Say why a user would be hurt.
