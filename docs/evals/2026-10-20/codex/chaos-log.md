# Chaos coverage

| Technique / flow | Result and evidence |
|---|---|
| Desktop + mobile sweep | ✓ sweep-output.txt; repeated with populated cart/orders in sweep-rich-output.txt; 12 pages each. |
| Real-request fuzz | ✓ requests.json and fuzz-output.txt; cart/coupon/search seed requests; CLI also exercised auth/account routes. Duplicate root causes consolidated. |
| Quantity hostile values | ✗ WR-006 negative quantity visible as -$299.98. Fuzzer also accepts huge/fraction/text quantities; not all accepted variants separately judged in UI. |
| Search hostile strings | ✗ WR-020 literal percent 500; empty, spaces, Unicode, markup, SQL-like text, slash and 5k text exercised. |
| Signup invalid input | ✗ WR-005 short password clears data; fuzz covered long values and malformed JSON. Exhaustive hostile matrix on every signup field was not completed in the UI. |
| Settings hostile strings | ✓ Empty, whitespace, Unicode, markup, query-like text and long input attempted; persistence fails WR-003 independently. |
| Coupon hostile strings | ✗ WR-007 padded active code 500; empty, spaces, Unicode, markup, query-like input, long text and lowercase attempted. |
| Delivery address / phone | Normal fake address, spaced phone, empty address, offline address and concurrent orders covered. Exhaustive long/Unicode phone and address matrix not completed. |
| UI double submit | ✗ WR-024 two orders observed after double-click; fresh-context replay traces retained. Add-to-cart double click increments quantity as expected. |
| Concurrent real requests | ✗ chaos-final.json contains two concurrent POST /api/orders responses. Same duplicate-checkout root cause as WR-024. |
| Back/forward/reload | Exercised at cart/checkout; navigation load waits sometimes aborted/timed out. Documented in chaos-output.txt; bounded retries and later flow completed. |
| Two tabs | ✓ Cart in second tab refreshed after first tab mutation; logs in chaos-final.json. Stale unrefreshed checkout-tab behavior was sampled, not comprehensively asserted. |
| Offline checkout | ✗ WR-035 uncaught fetch rejection and no user error; input retained. |
| Forced cart 500 | ✗ WR-036 error JSON treated as CartView and crashes page; two fresh-context reproductions and trace. |
| Forced orders/account 500 | ✓ User-facing errors observed; screenshot files forced500-orders.png / forced500-account.png. |
| Malformed successful JSON | Not completed: forced-500 checks were prioritized; no claim of 200 {} or [] fault coverage. |
| Slow network | ✓ Chromium CDP latency 400ms and 50kB/s; checkout reload and state observed. CDP used as programmatic equivalent of DevTools emulate. |
| Session expiry / tampering | ✓ Disposable context cookie clearing shows login prompt; tampered gadgetly_sid redirects orders to login. Main shared session not invalidated. |
| Corrupted localStorage | ✓ Injected cart='{' and reloaded; app recovers, cart remains server-owned. No original cart/price state in localStorage to tamper. |
| Accessibility scans | ✗ Site-wide axe plus populated sweep: WR-015 cart button name, WR-016 price contrast, WR-027 phone label, WR-033 empty action-column header. |
| Keyboard-only core flows | ✓ keyboard-log.json: signup through checkout, history and settings completed using Tab, typing and Enter. |
| Deep links / missing IDs | ✓ /products/999999, /products/abc, /orders/999999 explored; appropriate missing-page handling. |
| Schemathesis | Skipped: no OpenAPI spec discovered. CLI fuzzer completed. |
| Security module | Skipped per wreck-it v1 instructions. |

Evidence: chaos-observations.json, chaos-final.json, requests.json, screenshots and Playwright ZIP traces.
Oddity script and keyboard focus were captured for each core route in chaos-final.json.
Early oddity invocation returned no value; the final sweep invokes the function and records its signals.
Console/page errors and failed response statuses appear in logs and traces.

The first automated browser batch overlapped load activity and was interrupted; its absence of a result
is not counted as a pass. Independent reproductions and resumed batches establish the recorded findings.
