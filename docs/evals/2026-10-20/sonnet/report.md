# wreck-it report — Gadgetly benchmark

**Readiness: 0/100 — Not ready**
> Fix this first: WR-007 Cart subtotal ignores item quantity

## Scores by category
| Category | Findings | Subscore |
|---|---:|---:|
| functional | 4 | 0 |
| ux | 3 | 55 |
| oddity | 4 | 53 |
| chaos | 6 | 0 |
| performance | 4 | 30 |
| security | 0 | 100 |
| accessibility | 2 | 7 |

## Findings
### CRITICAL
#### WR-007 · Cart subtotal ignores item quantity
- **Category:** functional · **Persona:** normal-user · **Route:** `/cart`
- **Expected:** Subtotal and total equal sum of price x quantity ($239.97 for 3 x $79.99 earbuds, plus any other lines)
- **Actual:** Line total shows $239.97 but Subtotal/Total show $79.99 (price counted once per line); checkout total is understated
- **Source:** `lib/cart.ts:19` — Subtotal sums price without multiplying by quantity (lineTotal is correct) (confidence: high)
- **Steps to reproduce:**
  1. Send `DELETE /api/cart?productId=1`
  2. Send `DELETE /api/cart?productId=2`
  3. Send `DELETE /api/cart?productId=3`
  4. Send `DELETE /api/cart/coupon`
  5. Send `POST /api/cart`
  6. Go to `/cart`
- **Screenshots:** ![WR-007-1](<shots/ui-cart-subtotal.png>)
- **Regression test:** `tests/wreck-it/WR-007.spec.ts`

#### WR-011 · Coupon discount is applied twice when placing an order
- **Category:** functional · **Persona:** gadget-shopper · **Route:** `/api/orders`
- **Expected:** Order total equals the checkout total ($44.99 for one $49.99 item with 10% off)
- **Actual:** Order total charged is $40.49: the coupon is applied once in summarize() and again in the order insert
- **Source:** `app/api/orders/route.ts:38` — summary.total already includes the coupon (cart.ts:20); applying it again double-discounts (confidence: high)
- **Steps to reproduce:**
  1. Send `POST /api/cart`
  2. Send `POST /api/cart/coupon`
  3. Go to `/checkout`
  4. Type "1 Wreck St" into the field labelled "Delivery address"
  5. Click the button "Place order"
  6. Wait 2500 ms
- **Screenshots:** ![WR-011-1](<shots/ui-order-detail.png>)
- **Regression test:** `tests/wreck-it/WR-011.spec.ts`

### HIGH
#### WR-005 · a11y: Buttons must have discernible text (button-name)
- **Category:** accessibility · **Persona:** a11y-scan · **Route:** `/`
- **Expected:** Buttons must have discernible text (WCAG/axe rule button-name) satisfied on /
- **Actual:** axe-core reports 1 element failing button-name (critical), e.g. .cart-button; see https://dequeuniversity.com/rules/axe/4.14/button-name?application=axeAPI Also on http://localhost:4317/about (1 element). Also on http://localhost:4317/account/settings (1 element). Also on http://localhost:4317/cart (1 element). Also on http://localhost:4317/checkout (1 element). Also on http://localhost:4317/login (1 element). Also on http://localhost:4317/orders (1 element). Also on http://localhost:4317/pricing (1 element). Also on http://localhost:4317/products (1 element). Also on http://localhost:4317/signup (1 element). Also on http://localhost:4317/products/2 (1 element). Also on http://localhost:4317/orders/1001 (1 element).
- **Source:** `components/CartButton.tsx:34` — Icon-only button without aria-label (confidence: high)
- **Steps to reproduce:**
  1. Go to `http://localhost:4317/`
- **Regression test:** `tests/wreck-it/WR-005.spec.ts`

#### WR-010 · Stats endpoint stores every request's full headers in memory without bound
- **Category:** performance · **Persona:** chaos-monkey · **Route:** `/api/stats`
- **Expected:** Lightweight counter that doesn't retain request headers (incl. cookies/auth) or grow forever
- **Actual:** Soak of 60 s at 20 connections: RSS 104 -> 313 MB (97.6 MB/min, leak) and p99 36 -> 114 ms while rps fell 2000 -> 494; each call retains the full request headers (cookies, authorization) in a global array that is also filtered linearly
- **Source:** `app/api/stats/route.ts:18` — Unbounded global array retains full headers per request and is re-filtered each call (confidence: high)
- **Steps to reproduce:**
  1. Send `GET /api/stats`

#### WR-012 · Double-clicking Place order creates duplicate orders
- **Category:** chaos · **Persona:** rushed-beginner · **Route:** `/checkout`
- **Expected:** One order per checkout; button disabled while submitting
- **Actual:** Two orders with identical contents are created (seen as #1004 and #1005) and stock is reserved twice
- **Source:** `app/checkout/page.tsx:75` — Place order button has no submitting/disabled state; POST /api/orders (app/api/orders/route.ts:16) has no idempotency (confidence: high)
- **Steps to reproduce:**
  1. Send `POST /api/cart`
  2. Go to `/checkout`
  3. Type "1 Wreck St" into the field labelled "Delivery address"
  4. Click the button "Place order" ×2
  5. Wait 2500 ms
  6. Go to `/api/orders`
- **Screenshots:** ![WR-012-1](<shots/ui-orders-list.png>)
- **Regression test:** `tests/wreck-it/WR-012.spec.ts`

#### WR-013 · Display name change is reported saved but never persisted
- **Category:** functional · **Persona:** normal-user · **Route:** `/account/settings`
- **Expected:** After save and reload the new name shows in the header and form
- **Actual:** 'Your changes have been saved.' appears but after reload the name is still 'Demo Shopper' (PATCH /api/account returns the updated copy without writing it back to the store)
- **Source:** `lib/db.ts:64` — updateUser builds a copy but never writes it back to store.users (confidence: high)
- **Steps to reproduce:**
  1. Go to `/account/settings`
  2. Type "Wreck Tester" into the field labelled "Display name"
  3. Click the button "Save changes"
  4. Wait 1000 ms
  5. Reload the page
- **Screenshots:** ![WR-013-1](<shots/ui-settings.png>)
- **Regression test:** `tests/wreck-it/WR-013.spec.ts`

#### WR-016 · Search with a percent sign returns HTTP 500
- **Category:** chaos · **Persona:** chaos-monkey · **Route:** `/api/search`
- **Expected:** Query treated as text and returns results/400
- **Actual:** 500: decodeURIComponent throws URIError on the already-decoded '%'
- **Source:** `app/api/search/route.ts:9` — searchParams is already decoded; decoding again throws URIError on a lone '%' (confidence: high)
- **Steps to reproduce:**
  1. Send `GET /api/search?q=%25`
- **Regression test:** `tests/wreck-it/WR-016.spec.ts`

#### WR-017 · Cart PATCH accepts negative quantity (negative line total)
- **Category:** chaos · **Persona:** chaos-monkey · **Route:** `/api/cart`
- **Expected:** Negative/fractional quantities rejected with 400
- **Actual:** 200; cart has quantity -5 and lineTotal -$249.95
- **Source:** `app/api/cart/route.ts:42` — Only checks finiteness; negative values and fractions that truncate are accepted (confidence: high)
- **Steps to reproduce:**
  1. Send `POST /api/cart`
  2. Send `PATCH /api/cart`
- **Regression test:** `tests/wreck-it/WR-017.spec.ts`

#### WR-019 · POST /api/cart/coupon returns 500 when code is padded with spaces
- **Category:** chaos · **Persona:** fuzz · **Route:** `/api/cart/coupon`
- **Expected:** Bad input for code is rejected with a 4xx and a helpful message
- **Actual:** POST /api/cart/coupon answered 500 (server error) for code = padded with spaces: " SAVE10 ". Also failed for: nothing else.
- **Source:** `app/api/cart/coupon/route.ts:17` — Validation uses trimmed input but lookup uses untrimmed, so getCoupon returns undefined and coupon.code throws (confidence: high)
- **Steps to reproduce:**
  1. Send `POST /api/cart/coupon`
- **Regression test:** `tests/wreck-it/WR-019.spec.ts`

#### WR-023 · Fuzzy search blocks the server: a 24-character query takes ~3 s of CPU
- **Category:** performance · **Persona:** chaos-monkey · **Route:** `/api/search`
- **Expected:** Search answers in <500 ms for any query and never blocks other requests
- **Actual:** Single request ~2.9 s (edit distance over every substring of all reviews, synchronous); with 10 concurrent connections p50 was 3032 ms and throughput 0.2 rps, so one user typing a long query stalls the whole site. Short queries like 'earbuds' already take ~180 ms
- **Source:** `lib/search.ts:18` — Synchronous edit-distance over every substring window blocks the event loop (confidence: high)
- **Steps to reproduce:**
  1. Send `GET /api/search?q=aaaaaaaaaaaaaaaaaaaaaaaa`

### MEDIUM
#### WR-003 · Page renders "undefined" as visible text
- **Category:** oddity · **Persona:** sweep · **Route:** `/products`
- **Expected:** Missing values are shown as a sensible fallback (e.g. "No reviews yet"), never as raw placeholders
- **Actual:** Visible text on /products contains "undefined", e.g. "undefined (0)".
- **Source:** `components/ProductCard.tsx:14` — Products without reviews have rating undefined, so the template renders 'undefined' (confidence: high)
- **Steps to reproduce:**
  1. Resize viewport to 1280x800
  2. Go to `/products`
- **Regression test:** `tests/wreck-it/WR-003.spec.ts`

#### WR-004 · /products scrolls horizontally at 390px (mobile)
- **Category:** ux · **Persona:** sweep · **Route:** `/products`
- **Expected:** Page fits a 390px-wide viewport without sideways scrolling
- **Actual:** On /products at 390px: page scrollWidth 736px exceeds viewport 390px.
- **Source:** `app/products/products.module.css:16` — Fixed 720px element overflows a 390px viewport (confidence: medium)
- **Steps to reproduce:**
  1. Resize viewport to 390x844
  2. Go to `/products`
- **Regression test:** `tests/wreck-it/WR-004.spec.ts`

#### WR-006 · a11y: Elements must meet minimum color contrast ratio thresholds (color-contrast)
- **Category:** accessibility · **Persona:** a11y-scan · **Route:** `/products`
- **Expected:** Elements must meet minimum color contrast ratio thresholds (WCAG/axe rule color-contrast) satisfied on /products
- **Actual:** axe-core reports 24 elements failing color-contrast (serious), e.g. article:nth-child(1) > .ProductCard-module__9j1fXa__price; see https://dequeuniversity.com/rules/axe/4.14/color-contrast?application=axeAPI
- **Likely in:** `app/products/products.module.css`, `components/ProductCard.module.css`, `app/globals.css` — Contrast failure on /products; exact rule not pinpointed
- **Steps to reproduce:**
  1. Go to `http://localhost:4317/products`
- **Regression test:** `tests/wreck-it/WR-006.spec.ts`

#### WR-008 · Cart badge count stays stale after removing an item or changing quantity
- **Category:** functional · **Persona:** deal-hunter-mobile · **Route:** `/cart`
- **Expected:** Badge reflects remaining items after removal (1)
- **Actual:** Badge keeps showing the old count (4) after removing the 3-quantity line; count is only incremented, never decremented
- **Source:** `app/api/cart/route.ts:26` — count is only incremented in POST; PATCH/DELETE never update it, and the header badge reads cart.count instead of summing items (confidence: high)
- **Steps to reproduce:**
  1. Send `POST /api/cart`
  2. Send `POST /api/cart`
  3. Go to `/cart`
  4. Click the button "Remove"
- **Screenshots:** ![WR-008-1](<shots/ui-cart-badge.png>)
- **Regression test:** `tests/wreck-it/WR-008.spec.ts`

#### WR-014 · Orders list is oldest-first instead of newest-first
- **Category:** ux · **Persona:** gadget-shopper · **Route:** `/orders`
- **Expected:** Most recent order listed first
- **Actual:** #1001 (oldest) is at the top and the newest order is at the bottom
- **Source:** `app/api/orders/route.ts:12` — Ascending sort; should be descending (confidence: high)
- **Steps to reproduce:**
  1. Go to `/orders`
  2. Wait 800 ms
- **Screenshots:** ![WR-014-1](<shots/ui-orders-list.png>)
- **Regression test:** `tests/wreck-it/WR-014.spec.ts`

#### WR-018 · Add to cart accepts negative quantity and ignores stock
- **Category:** chaos · **Persona:** chaos-monkey · **Route:** `/api/cart`
- **Expected:** Quantity must be a positive integer within stock
- **Actual:** 201 with a negative quantity; quantities above stock (e.g. 100000) are also accepted and stock goes negative at checkout
- **Source:** `app/api/cart/route.ts:21` — No positive-integer or stock check on add; orders/route.ts:28 reserveStock never checks availability (confidence: high)
- **Steps to reproduce:**
  1. Send `POST /api/cart`
- **Regression test:** `tests/wreck-it/WR-018.spec.ts`

#### WR-021 · CLS 0.41 on /products (mobile)
- **Category:** performance · **Persona:** perf-scan · **Route:** `/products`
- **Expected:** CLS within Google's "poor" threshold (0.25) on a mid-range phone on slow 4G
- **Actual:** Layout shift score 0.41 on a mid-range phone on slow 4G (Lighthouse performance score 79). Report: .wreck-it/perf/localhost-4317-products-mobile.html
- **Source:** `components/ProductCard.tsx:10` — Product grid renders after a fetch so content shifts when the spinner is replaced; layout space not reserved (confidence: medium)
- **Steps to reproduce:**
  1. Resize viewport to 412x823
  2. Go to `/products`

#### WR-022 · GET /api/products takes ~480 ms at any load (sequential per-product queries, N+1)
- **Category:** performance · **Persona:** chaos-monkey · **Route:** `/api/products`
- **Expected:** Product list responds in well under 200 ms
- **Actual:** p50 477-484 ms and p99 up to 657 ms from 10 to 100 connections; listProductsWithRatings awaits reviews and stock one product at a time (24 products x 2 round trips); /products also scores CLS 0.41 on mobile Lighthouse
- **Source:** `lib/catalog.ts:15` — Sequential awaits per product (N+1), each a simulated 5-15 ms round trip (confidence: high)
- **Steps to reproduce:**
  1. Send `GET /api/products`

### LOW
#### WR-001 · Dead link: /pricng (404)
- **Category:** oddity · **Persona:** sweep · **Route:** `/`
- **Expected:** Links on the page lead to existing pages
- **Actual:** A link on / points to /pricng, which returns 404. Also on: /about, /account/settings, /cart, /checkout, /login, /orders, /pricing, /signup, ….
- **Source:** `components/Footer.tsx:16` — Typo in footer href; page is /pricing (confidence: high)
- **Steps to reproduce:**
  1. Resize viewport to 1280x800
  2. Go to `/`
  3. Send `GET /pricng`
- **Regression test:** `tests/wreck-it/WR-001.spec.ts`

#### WR-002 · Broken image: /images/team-photo.jpg
- **Category:** oddity · **Persona:** sweep · **Route:** `/about`
- **Expected:** Every image on the page loads
- **Actual:** http://localhost:4317/images/team-photo.jpg fails to load on /about.
- **Source:** `app/about/page.tsx:9` — public/images/team-photo.jpg does not exist (confidence: high)
- **Steps to reproduce:**
  1. Resize viewport to 1280x800
  2. Go to `/about`
  3. Send `GET /images/team-photo.jpg`
- **Regression test:** `tests/wreck-it/WR-002.spec.ts`

#### WR-009 · Checkout accepts nonsense phone number
- **Category:** ux · **Persona:** rushed-beginner · **Route:** `/checkout`
- **Expected:** Invalid or empty phone is rejected with a specific message
- **Actual:** 201 order placed with phone 'not a phone'
- **Source:** `app/api/orders/route.ts:21` — Phone is never validated, only address is checked (confidence: high)
- **Steps to reproduce:**
  1. Send `POST /api/cart`
  2. Send `POST /api/orders`
- **Regression test:** `tests/wreck-it/WR-009.spec.ts`

#### WR-015 · Order detail shows raw ISO timestamp while list shows formatted date
- **Category:** oddity · **Persona:** normal-user · **Route:** `/orders/[id]`
- **Expected:** Date formatted like the list (e.g. Sep 28, 2026)
- **Actual:** Detail shows 'Placed 2026-10-20T01:55:07.088Z'
- **Source:** `app/orders/[id]/page.tsx:21` — Raw ISO string rendered; list formats with toLocaleDateString (confidence: high)
- **Steps to reproduce:**
  1. Go to `/orders/1001`
- **Screenshots:** ![WR-015-1](<shots/ui-order-detail.png>)
- **Regression test:** `tests/wreck-it/WR-015.spec.ts`

#### WR-020 · Signup accepts 5,000-character display name (settings caps at 60)
- **Category:** chaos · **Persona:** chaos-monkey · **Route:** `/api/auth/signup`
- **Expected:** Display name limited to 60 chars like /api/account PATCH
- **Actual:** 201; the 5,000-char name is stored and rendered in the header greeting
- **Source:** `app/api/auth/signup/route.ts:16` — No max length check unlike account PATCH (account/route.ts:18) (confidence: high)
- **Steps to reproduce:**
  1. Send `POST /api/auth/signup`
- **Regression test:** `tests/wreck-it/WR-020.spec.ts`

## Load testing
### GET http://localhost:4317/api/products (ramp)
| Connections | RPS | p50 | p90 | p99 | Error rate |
|---:|---:|---:|---:|---:|---:|
| 10 | 20 | 477 ms | 504 ms | 517 ms | 0.0% |
| 25 | 50 | 478 ms | 503 ms | 521 ms | 0.0% |
| 50 | 100 | 482 ms | 512 ms | 533 ms | 0.0% |
| 100 | 200 | 484 ms | 523 ms | 657 ms | 0.0% |

No breaking point found up to 100 connections

Memory: 260.30 MB/min (stable)

### GET http://localhost:4317/api/search?q=aaaaaaaaaaaaaaaaaaaaaaaa (ramp)
| Connections | RPS | p50 | p90 | p99 | Error rate |
|---:|---:|---:|---:|---:|---:|
| 10 | 0 | 3032 ms | 3032 ms | 3032 ms | 0.0% |

Breaking point: 10 connections — p99 3032 ms > 2000 ms

Memory: 336.30 MB/min (stable)

### GET http://localhost:4317/api/stats (soak)
| Connections | RPS | p50 | p90 | p99 | Error rate |
|---:|---:|---:|---:|---:|---:|
| 20 | 2000 | 7 ms | 19 ms | 36 ms | 0.0% |
| 20 | 818 | 19 ms | 44 ms | 76 ms | 0.0% |
| 20 | 701 | 22 ms | 50 ms | 88 ms | 0.0% |
| 20 | 687 | 22 ms | 51 ms | 95 ms | 0.0% |
| 20 | 652 | 24 ms | 52 ms | 89 ms | 0.0% |
| 20 | 494 | 30 ms | 72 ms | 114 ms | 0.0% |

No breaking point found up to 20 connections

Memory: 97.58 MB/min (leak suspected)

## Coverage
- Stages: preflight: done, discover: done, personas: done, normal: done, explore: done, chaos: done, load: done, security: not run, trace: done, report: done
- Personas: sweep, perf-scan
- Routes visited: 13/13; not visited: `/logout`, `/orders/[id]`, `/products/[id]`

## Test data created

wreck-it created these in the app (all runs so far). If it ran against a shared or production database, delete them:
- 7 accepted request(s) to POST /api/cart _(by fuzz)_
- 2 accepted request(s) to PATCH /api/cart _(by fuzz)_
- 5 accepted request(s) to PATCH /api/account _(by fuzz)_
- 9 accepted request(s) to POST /api/auth/signup _(by fuzz)_
