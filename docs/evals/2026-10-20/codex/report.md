# wreck-it report — Gadgetly benchmark

**Readiness: 0/100 — Not ready**
> Fix this first: WR-001 Cart subtotal ignores quantity

## Scores by category
| Category | Findings | Subscore |
|---|---:|---:|
| functional | 5 | 37 |
| ux | 5 | 15 |
| oddity | 2 | 67 |
| chaos | 6 | 0 |
| performance | 3 | 40 |
| security | 0 | 100 |
| accessibility | 4 | 0 |

## Findings
### HIGH
#### WR-001 · Cart subtotal ignores quantity
- **Category:** functional · **Persona:** normal-user · **Route:** `/cart`
- **Expected:** Two $149.99 units total $299.98
- **Actual:** Gadgetly Shop Orders About Hi, Demo Shopper Log out 2 Your cart Product	Price	Qty	Total Pulse Over-Ear Headphones	$149.99		$299.98	Remove Coupon code Apply Subtotal $149.99 Total $149.99 Checkout Gadgetly Small gadgets, big joy. Free shipping over $50. 15 shoppers browsing right now All products About us Shipping & pricing Track an order Account
- **Source:** `lib/cart.ts:19` — Subtotal sums unit price instead of lineTotal, dropping quantity. (confidence: high)
- **Steps to reproduce:**
  1. Send `DELETE /api/cart?productId=2`
  2. Send `DELETE /api/cart/coupon`
  3. Send `POST /api/cart`
  4. Go to `/cart`
  5. Type "2" into the spinbutton "Quantity for Pulse Over-Ear Headphones"
  6. Press Tab in the spinbutton "Quantity for Pulse Over-Ear Headphones"
  7. Wait 300 ms
- **Screenshots:** ![WR-001-1](<shots/quantity-total.png>)
- **Trace:** `npx playwright show-trace shots/quantity-total.zip`
- **Regression test:** `tests/wreck-it/WR-001.spec.ts`

#### WR-002 · Order applies coupon twice
- **Category:** functional · **Persona:** normal-user · **Route:** `/checkout`
- **Expected:** One SAVE10 discount yields $134.99 consistently through confirmation
- **Actual:** Gadgetly Shop Orders About Hi, Demo Shopper Log out ← All orders Order #1004 Placed 2026-10-20T02:09:33.697Z · Placed Product	Qty	Price Pulse Over-Ear Headphones	1	$149.99 Subtotal $149.99 Coupon SAVE10 −$15.00 Total charged $121.49 Shipping to wreck-it 123 Test Lane Gadgetly Small gadgets, big joy. Free shipping over $50. 15 shoppers browsing right now All products About us Shipping & pricing Track an order Account
- **Source:** `app/api/orders/route.ts:38` — summary.total is already discounted; applying the coupon again changes charged total. (confidence: high)
- **Steps to reproduce:**
  1. Send `DELETE /api/cart?productId=2`
  2. Send `POST /api/cart`
  3. Send `POST /api/cart/coupon`
  4. Go to `/checkout`
  5. Type "wreck-it 123 Test Lane" into the field labelled "Delivery address"
  6. Click the button "Place order"
  7. Wait 1200 ms
- **Screenshots:** ![WR-002-1](<shots/coupon-double.png>)
- **Trace:** `npx playwright show-trace shots/coupon-double.zip`
- **Regression test:** `tests/wreck-it/WR-002.spec.ts`

#### WR-003 · Profile reports saved but name disappears on reload
- **Category:** functional · **Persona:** normal-user · **Route:** `/account/settings`
- **Expected:** Saved name persists after reload
- **Actual:** Gadgetly Shop Orders About Hi, Demo Shopper Log out Account settings Signed in as demo@gadgetly.test Display name Save changes Gadgetly Small gadgets, big joy. Free shipping over $50. 15 shoppers browsing right now All products About us Shipping & pricing Track an order Account
- **Source:** `lib/db.ts:64` — updateUser returns an updated object but never stores it in store.users. (confidence: high)
- **Steps to reproduce:**
  1. Go to `/account/settings`
  2. Type "wreck-it saved name" into the field labelled "Display name"
  3. Click the button "Save changes"
  4. Wait 400 ms
  5. Reload the page
- **Screenshots:** ![WR-003-1](<shots/profile-persistence.png>)
- **Trace:** `npx playwright show-trace shots/profile-persistence.zip`
- **Regression test:** `tests/wreck-it/WR-003.spec.ts`

#### WR-006 · Cart accepts negative quantities
- **Category:** chaos · **Persona:** chaos-monkey · **Route:** `/cart`
- **Expected:** Reject negative quantity and preserve a valid cart
- **Actual:** Gadgetly Shop Orders About Hi, Demo Shopper Log out 3 Your cart Product	Price	Qty	Total Pulse Over-Ear Headphones	$149.99		-$299.98	Remove Coupon code Apply Subtotal $149.99 Total $149.99 Checkout Gadgetly Small gadgets, big joy. Free shipping over $50. 15 shoppers browsing right now All products About us Shipping & pricing Track an order Account
- **Source:** `app/api/cart/route.ts:42` — PATCH checks finiteness but accepts negative numbers and truncates fractions. (confidence: high)
- **Steps to reproduce:**
  1. Send `DELETE /api/cart?productId=2`
  2. Send `POST /api/cart`
  3. Go to `/cart`
  4. Type "-2" into the spinbutton "Quantity for Pulse Over-Ear Headphones"
  5. Press Tab in the spinbutton "Quantity for Pulse Over-Ear Headphones"
  6. Wait 300 ms
- **Screenshots:** ![WR-006-1](<shots/negative-quantity.png>)
- **Trace:** `npx playwright show-trace shots/negative-quantity.zip`
- **Regression test:** `tests/wreck-it/WR-006.spec.ts`

#### WR-007 · Padded valid coupon returns server error
- **Category:** chaos · **Persona:** rushed-beginner · **Route:** `/cart`
- **Expected:** Trim valid coupon or return validation without a 500
- **Actual:** Gadgetly Shop Orders About Hi, Demo Shopper Log out 5 Your cart Product	Price	Qty	Total Pulse Over-Ear Headphones	$149.99		$149.99	Remove Coupon code Apply Couldn't apply that code Subtotal $149.99 Total $149.99 Checkout Gadgetly Small gadgets, big joy. Free shipping over $50. 15 shoppers browsing right now All products About us Shipping & pricing Track an order Account
- **Source:** `app/api/cart/coupon/route.ts:17` — Membership check trims input but lookup does not; coupon is undefined and property access throws. (confidence: high)
- **Steps to reproduce:**
  1. Send `DELETE /api/cart?productId=2`
  2. Send `POST /api/cart`
  3. Go to `/cart`
  4. Type " SAVE10 " into the field labelled "Coupon code"
  5. Click the button "Apply"
- **Screenshots:** ![WR-007-1](<shots/coupon-spaces.png>)
- **Trace:** `npx playwright show-trace shots/coupon-spaces.zip`
- **Regression test:** `tests/wreck-it/WR-007.spec.ts`

#### WR-015 · a11y: Buttons must have discernible text (button-name)
- **Category:** accessibility · **Persona:** a11y-scan · **Route:** `/`
- **Expected:** Buttons must have discernible text (WCAG/axe rule button-name) satisfied on /
- **Actual:** axe-core reports 1 element failing button-name (critical), e.g. .cart-button; see https://dequeuniversity.com/rules/axe/4.14/button-name?application=axeAPI Also on http://localhost:4318/about (1 element). Also on http://localhost:4318/account/settings (1 element). Also on http://localhost:4318/cart (1 element). Also on http://localhost:4318/checkout (1 element). Also on http://localhost:4318/login (1 element). Also on http://localhost:4318/orders (1 element). Also on http://localhost:4318/pricing (1 element). Also on http://localhost:4318/products (1 element). Also on http://localhost:4318/signup (1 element). Also on http://localhost:4318/products/2 (1 element). Also on http://localhost:4318/orders/1001 (1 element). Fresh browser inspection: Small gadgets, big joy. Headphones, smart home, cameras and more. New here? Use code SAVE10 for 10% off your first order. Browse the shop Featured Pulse Over-Ear Headphones $149.99 Orbit Smartwatch $229.99 Dock Pro Hub $89.99 Forge Mechanical Keyboard $129.99 <button type="button" class="cart-button"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="21" r="1"></circle><circle cx="20" cy="21" r="1"></circle><path d="M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6"></path></svg></button>
- **Source:** `components/CartButton.tsx:34` — Icon-only button has no aria-label, title or text, so screen readers cannot identify it. (confidence: high)
- **Steps to reproduce:**
  1. Go to `http://localhost:4318/`
- **Screenshots:** ![WR-015-1](<shots/WR-015-replay.png>)
- **Regression test:** `tests/wreck-it/WR-015.spec.ts`

#### WR-020 · Percent search returns a server error
- **Category:** chaos · **Persona:** chaos-monkey · **Route:** `/products`
- **Expected:** Arbitrary search text is handled without a server error
- **Actual:** Gadgetly Shop Orders About Hi, Demo Shopper Log out 1 Results for “%” Search products Search All Audio Wearables Home Accessories Cameras Gaming Sorry, we couldn't load products. Please try again. Gadgetly Small gadgets, big joy. Free shipping over $50. 12 shoppers browsing right now All products About us Shipping & pricing Track an order Account
- **Source:** `app/api/search/route.ts:9` — URLSearchParams has decoded the value already; decoding a literal percent throws URIError. (confidence: high)
- **Steps to reproduce:**
  1. Go to `/products`
  2. Type "%" into the field labelled "Search products"
  3. Click the button "Search"
  4. Wait 1000 ms
- **Screenshots:** ![WR-020-1](<shots/search-percent.png>)
- **Trace:** `npx playwright show-trace shots/search-percent.zip`
- **Regression test:** `tests/wreck-it/WR-020.spec.ts`

#### WR-023 · Search latency breaks at 10 concurrent users
- **Category:** performance · **Persona:** load-tester · **Route:** `/api/search?q=headphones`
- **Expected:** p99 under 500 ms at 10 connections and no breaking point below 100 connections
- **Actual:** Repeated local production load: p50 1575ms, p99 2553ms at 10 connections; breaking point [object Object]. See .wreck-it/load and repeat transcripts. Concurrent browser and Lighthouse activity occurred during the initial runs; repeats confirm the signal.
- **Source:** `lib/search.ts:23` — Nested substring windows run editDistance synchronously across each product and review, blocking concurrent requests; catalog loading adds sequential database delays. (confidence: high)
- **Steps to reproduce:**
  1. Send `GET /api/search?q=headphones`

#### WR-024 · Double-clicking checkout creates duplicate orders
- **Category:** chaos · **Persona:** rushed-beginner · **Route:** `/checkout`
- **Expected:** Exactly one order is created per checkout attempt
- **Actual:** Gadgetly Shop Orders About Hi, Test User Log out ← All orders Order #1011 Placed 2026-10-20T11:32:56.236Z · Placed Product	Qty	Price Pulse Over-Ear Headphones	1	$149.99 Subtotal $149.99 Coupon SAVE10 −$15.00 Total charged $121.49 Shipping to wreck-it duplicate order Gadgetly Small gadgets, big joy. Free shipping over $50. 12 shoppers browsing right now All products About us Shipping & pricing Track an order Account
- **Source:** `app/api/orders/route.ts:28` — Concurrent handlers read the same cart before either clears it; no idempotency or reservation lock. (confidence: high)
- **Steps to reproduce:**
  1. Send `DELETE /api/cart?productId=2`
  2. Send `POST /api/cart`
  3. Go to `/checkout`
  4. Type "wreck-it duplicate order" into the field labelled "Delivery address"
  5. Click the button "Place order" ×2
  6. Wait 1500 ms
- **Screenshots:** ![WR-024-1](<shots/duplicate-orders.png>)
- **Trace:** `npx playwright show-trace shots/duplicate-orders.zip`
- **Regression test:** `tests/wreck-it/WR-024.spec.ts`

#### WR-029 · Product list slow from sequential per-product reads
- **Category:** performance · **Persona:** load-tester · **Route:** `/api/products`
- **Expected:** p99 under 500 ms at 10 connections and no breaking point below 100 connections
- **Actual:** Repeated local production load: p50 546ms, p99 1072ms at 10 connections; breaking point null. See .wreck-it/load and repeat transcripts. Concurrent browser and Lighthouse activity occurred during the initial runs; repeats confirm the signal.
- **Source:** `lib/catalog.ts:13` — Each product sequentially awaits reviews and stock inside a loop: 48 sequential round trips for the catalog. (confidence: high)
- **Steps to reproduce:**
  1. Send `GET /api/products`

#### WR-036 · Cart API failure crashes the page
- **Category:** chaos · **Persona:** chaos-monkey · **Route:** `/cart`
- **Expected:** Show an error and retry control without crashing
- **Actual:** With **/api/cart intercepted to return HTTP 500 JSON {"error":"wreck-it forced error"}, This page couldn’t load Reload to try again, or go back. Reload Back
- **Source:** `app/cart/page.tsx:19` — Non-401 errors are parsed as a valid cart; render dereferences cart.items.length on an error object. (confidence: high)
- **Steps to reproduce:**
  1. Go to `/cart`
- **Screenshots:** ![WR-036-1](<shots/cart-forced500.png>)
- **Trace:** `npx playwright show-trace shots/cart-forced500.zip`
- **Regression test:** `tests/wreck-it/WR-036.spec.ts`

### MEDIUM
#### WR-004 · Removing last cart item leaves header count
- **Category:** functional · **Persona:** normal-user · **Route:** `/cart`
- **Expected:** Removing last item clears cart badge
- **Actual:** Gadgetly Shop Orders About Hi, Demo Shopper Log out 1 Your cart Your cart is empty. Gadgetly Small gadgets, big joy. Free shipping over $50. 15 shoppers browsing right now All products About us Shipping & pricing Track an order Account
- **Source:** `app/api/cart/route.ts:52` — Delete removes items but never decrements cart.count. (confidence: high)
- **Steps to reproduce:**
  1. Send `DELETE /api/cart?productId=2`
  2. Send `POST /api/cart`
  3. Go to `/cart`
  4. Click the button "Remove"
- **Screenshots:** ![WR-004-1](<shots/badge-stale.png>)
- **Trace:** `npx playwright show-trace shots/badge-stale.zip`
- **Regression test:** `tests/wreck-it/WR-004.spec.ts`

#### WR-005 · Signup error wipes fields and hides validation detail
- **Category:** ux · **Persona:** rushed-beginner · **Route:** `/signup`
- **Expected:** Explain password length and preserve entered name and email
- **Actual:** Gadgetly Shop About Log in Sign up Create your account Your name Email Password At least 8 characters. Something went wrong Sign up Already have an account? Log in Gadgetly Small gadgets, big joy. Free shipping over $50. 15 shoppers browsing right now All products About us Shipping & pricing Track an order Account
- **Source:** `app/signup/page.tsx:30` — Error handler discards all input and replaces server validation with a generic error. (confidence: high)
- **Steps to reproduce:**
  1. Go to `/signup`
  2. Type "wreck-it new shopper" into the field labelled "Your name"
  3. Type "wreck.benchmark+{{unique}}@gadgetly.test" into the field labelled "Email"
  4. Type "short" into the field labelled "Password"
  5. Click the button "Sign up"
- **Screenshots:** ![WR-005-1](<shots/signup-errors.png>)
- **Trace:** `npx playwright show-trace shots/signup-errors.zip`
- **Regression test:** `tests/wreck-it/WR-005.spec.ts`

#### WR-008 · Shipping information link opens missing page
- **Category:** functional · **Persona:** normal-user · **Route:** `/`
- **Expected:** Shipping information link opens /pricing
- **Actual:** Gadgetly Shop Orders About Hi, Demo Shopper Log out 6 Page not found We couldn't find what you were looking for. Back to the shop Gadgetly Small gadgets, big joy. Free shipping over $50. 15 shoppers browsing right now All products About us Shipping & pricing Track an order Account
- **Source:** `components/Footer.tsx:16` — Footer links to a misspelled route with no page. (confidence: high)
- **Steps to reproduce:**
  1. Go to `/`
  2. Click the link "Shipping & pricing"
- **Screenshots:** ![WR-008-1](<shots/shipping-link.png>)
- **Trace:** `npx playwright show-trace shots/shipping-link.zip`
- **Regression test:** `tests/wreck-it/WR-008.spec.ts`

#### WR-010 · Product category strip overflows mobile viewport
- **Category:** ux · **Persona:** mobile-returner · **Route:** `/products`
- **Expected:** Categories fit a 390px viewport without horizontal page scroll
- **Actual:** Gadgetly Log out 6 All products Search products Search All Audio Wearables Home Accessories Cameras Gaming Aurora Wireless Earbuds ★ 3.7 (28) Audio $79.99 Pulse Over-Ear Headphones ★ 4.1 (27) Audio $149.99 Echo Mini Speaker ★ 4.0 (34) Audio $49.99 Studio Desk Microphone ★ 4.1 (31) Audio $119.99 Orbit Smartwatch ★ 3.9 (34) Wearables $229.99 Stride Fitness Band ★ undefined (0) Wearables $59.99 Lumen Smart Ring ★ 4.2 (20) Wearables $279.99 Halo Sleep Mask ★ 3.9 (14) Wearables $89.99 Nimbus Smart Bulb (4-pack) ★ 4.1 (28) Home $39.99 Hearth Smart Thermostat ★ 3.7 (34) Home $179.99 Sentinel Video Doorbell ★ 3.5 (20) Home $129.99 Breeze Air Purifier ★ 3.7 (32) Home $159.99 Volt 65W GaN Charger ★ undefined (0) Accessories $44.99 Coil Braided USB-C Cable ★ 4.2 (20) Accessories $14.99 Dock Pro Hub ★ 4.0 (17) Accessories $89.99 Folio Tablet Stand ★ 4.1 (22) Accessories $29.99 Snap Instant Camera ★ 3.9 (34) Cameras $99.99 Vista Action Cam ★ 4.2 (12) Cameras $249.99 Prism Webcam 4K ★ undefined (0) Cameras $139.99 Tripod Go ★ 4.0 (24) Cameras $34.99 Arcade Wireless Controller ★ 4.0 (22) Gaming $69.99 Quest Gaming Mouse ★ 4.2 (29) Gaming $54.99 Forge Mechanical Keyboard ★ 4.1 (24) Gaming $129.99 Nova Gaming Headset ★ undefined (0) Gaming $99.99 Gadgetly Small gadgets, big joy. Free shipping over $50. 15 shoppers browsing right now All products About us Shipping & pricing Track an order Account
- **Source:** `app/products/products.module.css:16` — Fixed width category strip exceeds mobile viewport. (confidence: high)
- **Steps to reproduce:**
  1. Resize viewport to 390x844
  2. Go to `/products`
  3. Wait 1000 ms
- **Screenshots:** ![WR-010-1](<shots/mobile-overflow.png>)
- **Trace:** `npx playwright show-trace shots/mobile-overflow.zip`
- **Regression test:** `tests/wreck-it/WR-010.spec.ts`

#### WR-012 · Unreviewed products display undefined rating
- **Category:** oddity · **Persona:** normal-user · **Route:** `/products`
- **Expected:** Unreviewed products show a helpful no-reviews state
- **Actual:** Gadgetly Shop Orders About Hi, Demo Shopper Log out 6 All products Search products Search All Audio Wearables Home Accessories Cameras Gaming Aurora Wireless Earbuds ★ 3.7 (28) Audio $79.99 Pulse Over-Ear Headphones ★ 4.1 (27) Audio $149.99 Echo Mini Speaker ★ 4.0 (34) Audio $49.99 Studio Desk Microphone ★ 4.1 (31) Audio $119.99 Orbit Smartwatch ★ 3.9 (34) Wearables $229.99 Stride Fitness Band ★ undefined (0) Wearables $59.99 Lumen Smart Ring ★ 4.2 (20) Wearables $279.99 Halo Sleep Mask ★ 3.9 (14) Wearables $89.99 Nimbus Smart Bulb (4-pack) ★ 4.1 (28) Home $39.99 Hearth Smart Thermostat ★ 3.7 (34) Home $179.99 Sentinel Video Doorbell ★ 3.5 (20) Home $129.99 Breeze Air Purifier ★ 3.7 (32) Home $159.99 Volt 65W GaN Charger ★ undefined (0) Accessories $44.99 Coil Braided USB-C Cable ★ 4.2 (20) Accessories $14.99 Dock Pro Hub ★ 4.0 (17) Accessories $89.99 Folio Tablet Stand ★ 4.1 (22) Accessories $29.99 Snap Instant Camera ★ 3.9 (34) Cameras $99.99 Vista Action Cam ★ 4.2 (12) Cameras $249.99 Prism Webcam 4K ★ undefined (0) Cameras $139.99 Tripod Go ★ 4.0 (24) Cameras $34.99 Arcade Wireless Controller ★ 4.0 (22) Gaming $69.99 Quest Gaming Mouse ★ 4.2 (29) Gaming $54.99 Forge Mechanical Keyboard ★ 4.1 (24) Gaming $129.99 Nova Gaming Headset ★ undefined (0) Gaming $99.99 Gadgetly Small gadgets, big joy. Free shipping over $50. 15 shoppers browsing right now All products About us Shipping & pricing Track an order Account
- **Source:** `components/ProductCard.tsx:14` — Optional rating is interpolated into a string, rendering undefined for products without reviews. (confidence: high)
- **Steps to reproduce:**
  1. Go to `/products`
  2. Wait 1500 ms
- **Screenshots:** ![WR-012-1](<shots/undefined-rating.png>)
- **Trace:** `npx playwright show-trace shots/undefined-rating.zip`
- **Regression test:** `tests/wreck-it/WR-012.spec.ts`

#### WR-016 · a11y: Elements must meet minimum color contrast ratio thresholds (color-contrast)
- **Category:** accessibility · **Persona:** a11y-scan · **Route:** `/products`
- **Expected:** Elements must meet minimum color contrast ratio thresholds (WCAG/axe rule color-contrast) satisfied on /products
- **Actual:** axe-core reports 24 elements failing color-contrast (serious), e.g. article:nth-child(1) > .ProductCard-module__9j1fXa__price; see https://dequeuniversity.com/rules/axe/4.14/color-contrast?application=axeAPI Fresh browser inspection: All products Search products Search All Audio Wearables Home Accessories Cameras Gaming Aurora Wireless Earbuds ★ 3.7 (28) Audio $79.99 Pulse Over-Ear Headphones ★ 4.1 (27) Audio $149.99 Echo Mini Speaker ★ 4.0 (34) Audio $49.99 Studio Desk Microphone ★ 4.1 (31) Audio $119.99 Orbit Smartwatch ★ 3.9 (34) Wearables $229.99 Stride Fitness Band ★ undefined (0) Wearables $59.99 Lumen Smart Ring ★ 4.2 (20) Wearables $279.99 Halo Sleep Mask ★ 3.9 (14) Wearables $89.99 Nimbus Smart Bulb (4-pack) ★ 4.1 (28) Home $39.99 Hearth Smart Thermostat ★ 3.7 (34) Home $179.99 Sentinel Video Doorbell ★ 3.5 (20) Home $129.99 Breeze Air Purifier ★ 3.7 (32) Home $159.99 Volt 65W GaN Charger ★ undefined (0) Accessories $44.99 Coil Braided USB-C Cable ★ 4.2 (20) Accessories $14.99 Dock Pro Hub ★ 4.0 (17) Accessories $89.99 Folio Tablet Stand ★ 4.1 (22) Accessories $29.99 Snap Instant Camera ★ 3.9 (34) Cameras $99.99 Vista Action Cam ★ 4.2 (12) Cameras $249.99 Prism Webcam 4K ★ undefined (0) Cameras $139.99 Tripod Go ★ 4.0 (24) Cameras $34.99 Arcade Wireless Controller ★ 4.0 (22) Gaming $69.99 Quest Gaming Mouse ★ 4.2 (29) Gaming $54.99 Forge Mechanical Keyboard ★ 4.1 (24) Gaming $129.99 Nova Gaming Headset ★ undefined (0) Gaming $99.99 rgb(180, 184, 191) Also on http://localhost:4318/cart (1 element). Also on http://localhost:4318/products (24 elements).
- **Source:** `components/ProductCard.module.css:47` — Light gray price text on white fails normal-text contrast threshold. (confidence: high)
- **Steps to reproduce:**
  1. Go to `http://localhost:4318/products`
- **Screenshots:** ![WR-016-1](<shots/WR-016-replay.png>)
- **Regression test:** `tests/wreck-it/WR-016.spec.ts`

#### WR-017 · Fresh account orders spin forever
- **Category:** ux · **Persona:** normal-user · **Route:** `/orders`
- **Expected:** Empty history resolves to an empty state and next action
- **Actual:** Gadgetly Shop Orders About Hi, wreck-it fresh shopper Log out Loading your orders Gadgetly Small gadgets, big joy. Free shipping over $50. 15 shoppers browsing right now All products About us Shipping & pricing Track an order Account
- **Source:** `app/orders/page.tsx:22` — Empty successful result is treated as still loading. (confidence: high)
- **Steps to reproduce:**
  1. Go to `/orders`
  2. Wait 5500 ms
- **Screenshots:** ![WR-017-1](<shots/empty-orders.png>)
- **Trace:** `npx playwright show-trace shots/empty-orders.zip`
- **Regression test:** `tests/wreck-it/WR-017.spec.ts`

#### WR-018 · CLS 0.43 on /products (mobile)
- **Category:** performance · **Persona:** perf-scan · **Route:** `/products`
- **Expected:** CLS within Google's "poor" threshold (0.25) on a mid-range phone on slow 4G
- **Actual:** Layout shift score 0.43 on a mid-range phone on slow 4G (Lighthouse performance score 81). Report: .wreck-it/perf/localhost-4318-products-mobile.html Fresh browser inspection: All products Search products Search All Audio Wearables Home Accessories Cameras Gaming Loading products
- **Source:** `app/products/page.tsx:77` — Products arrive asynchronously and replace a short spinner with an unreserved multi-row grid, moving the footer. (confidence: high)
- **Steps to reproduce:**
  1. Resize viewport to 412x823
  2. Go to `/products`
- **Screenshots:** ![WR-018-1](<shots/WR-018-replay.png>) ![WR-018-2](<shots/undefined-rating.png>)

#### WR-025 · Order history shows oldest orders first
- **Category:** ux · **Persona:** normal-user · **Route:** `/orders`
- **Expected:** Newest order appears first
- **Actual:** Gadgetly Shop Orders About Hi, Test User Log out Your orders Order	Date	Items	Status	Total #1011	Oct 20, 2026	1	Placed	$121.49 #1012	Oct 20, 2026	1	Placed	$121.49 #1013	Oct 20, 2026	1	Placed	$149.99 #1014	Oct 20, 2026	1	Placed	$149.99 #1015	Oct 20, 2026	1	Placed	$149.99 #1016	Oct 20, 2026	1	Placed	$149.99 Gadgetly Small gadgets, big joy. Free shipping over $50. 12 shoppers browsing right now All products About us Shipping & pricing Track an order Account
- **Source:** `app/api/orders/route.ts:12` — Ascending timestamp sort puts oldest records first. (confidence: high)
- **Steps to reproduce:**
  1. Send `DELETE /api/cart?productId=2`
  2. Send `POST /api/cart`
  3. Send `POST /api/orders`
  4. Send `POST /api/cart`
  5. Send `POST /api/orders`
  6. Go to `/orders`
- **Screenshots:** ![WR-025-1](<shots/order-sorting.png>)
- **Trace:** `npx playwright show-trace shots/order-sorting.zip`
- **Regression test:** `tests/wreck-it/WR-025.spec.ts`

#### WR-027 · Checkout phone input has no accessible label
- **Category:** accessibility · **Persona:** normal-user · **Route:** `/checkout`
- **Expected:** Phone input has a programmatically associated label
- **Actual:** Gadgetly Shop Orders About Hi, Test User Log out 1 Checkout Delivery address Phone number Place order Order summary Pulse Over-Ear Headphones × 1 $149.99 Total $149.99 Gadgetly Small gadgets, big joy. Free shipping over $50. 12 shoppers browsing right now All products About us Shipping & pricing Track an order Account
- **Source:** `app/checkout/page.tsx:71` — Visual div label is not associated with the tel input. (confidence: high)
- **Steps to reproduce:**
  1. Send `DELETE /api/cart?productId=2`
  2. Send `POST /api/cart`
  3. Go to `/checkout`
- **Screenshots:** ![WR-027-1](<shots/phone-label.png>)
- **Trace:** `npx playwright show-trace shots/phone-label.zip`
- **Regression test:** `tests/wreck-it/WR-027.spec.ts`

#### WR-035 · Offline checkout fails silently with an uncaught error
- **Category:** chaos · **Persona:** chaos-monkey · **Route:** `/checkout`
- **Expected:** Show an actionable offline error while preserving address
- **Actual:** Gadgetly Shop Orders About Hi, Demo Shopper Log out 1 Checkout Delivery address Phone number Place order Order summary Pulse Over-Ear Headphones × 1 $149.99 Total $149.99 Gadgetly Small gadgets, big joy. Free shipping over $50. 12 shoppers browsing right now All products About us Shipping & pricing Track an order Account
- **Source:** `app/checkout/page.tsx:28` — Checkout awaits fetch without catch; a network failure rejects without setting error state. (confidence: high)
- **Steps to reproduce:**
  1. Send `DELETE /api/cart?productId=2`
  2. Send `POST /api/cart`
  3. Go to `/checkout`
  4. Type "wreck-it offline address" into the field labelled "Delivery address"
  5. Go offline
  6. Click the button "Place order"
  7. Wait 700 ms
  8. Go back online
- **Screenshots:** ![WR-035-1](<shots/offline-checkout.png>)
- **Trace:** `npx playwright show-trace shots/offline-checkout.zip`
- **Regression test:** `tests/wreck-it/WR-035.spec.ts`

### LOW
#### WR-011 · Broken image: /images/team-photo.jpg
- **Category:** oddity · **Persona:** sweep · **Route:** `/about`
- **Expected:** Every image on the page loads
- **Actual:** http://localhost:4318/images/team-photo.jpg fails to load on /about. Fresh browser inspection: About Gadgetly Gadgetly started in 2019 as a weekend market stall selling refurbished headphones. Today we're a small team of gadget nerds who test everything we sell, so you don't have to. Every product ships within two business days, and you can return anything within 30 days. Questions? Email us at hello@gadgetly.test. Start shopping → [{"src":"http://localhost:4318/images/team-photo.jpg","naturalWidth":0,"complete":true}]
- **Source:** `app/about/page.tsx:9` — Page references a missing public image; request returns 404. (confidence: high)
- **Steps to reproduce:**
  1. Resize viewport to 1280x800
  2. Go to `/about`
  3. Send `GET /images/team-photo.jpg`
- **Screenshots:** ![WR-011-1](<shots/WR-011-replay.png>)
- **Regression test:** `tests/wreck-it/WR-011.spec.ts`

#### WR-026 · Order detail exposes raw timestamp unlike history
- **Category:** ux · **Persona:** normal-user · **Route:** `/orders`
- **Expected:** Order history and detail use consistent readable dates
- **Actual:** Gadgetly Shop Orders About Hi, Test User Log out ← All orders Order #1019 Placed 2026-10-20T11:33:15.636Z · Placed Product	Qty	Price Pulse Over-Ear Headphones	1	$149.99 Subtotal $149.99 Total charged $149.99 Shipping to wreck-it dates Gadgetly Small gadgets, big joy. Free shipping over $50. 12 shoppers browsing right now All products About us Shipping & pricing Track an order Account
- **Source:** `app/orders/[id]/page.tsx:21` — Detail renders raw ISO timestamp while history formats a localized calendar date. (confidence: high)
- **Steps to reproduce:**
  1. Send `DELETE /api/cart?productId=2`
  2. Send `POST /api/cart`
  3. Send `POST /api/orders`
  4. Go to `/orders`
  5. Click `tbody tr:last-child a`
- **Screenshots:** ![WR-026-1](<shots/order-date.png>)
- **Trace:** `npx playwright show-trace shots/order-date.zip`
- **Regression test:** `tests/wreck-it/WR-026.spec.ts`

#### WR-033 · a11y: Table header text should not be empty (empty-table-header)
- **Category:** accessibility · **Persona:** a11y-scan · **Route:** `/cart`
- **Expected:** Table header text should not be empty (WCAG/axe rule empty-table-header) satisfied on /cart
- **Actual:** axe-core reports 1 element failing empty-table-header (minor), e.g. th:nth-child(5); see https://dequeuniversity.com/rules/axe/4.14/empty-table-header?application=axeAPI
- **Source:** `app/cart/page.tsx:70` — Actions column header is empty, leaving a table header without an accessible name. (confidence: high)
- **Steps to reproduce:**
  1. Go to `http://localhost:4318/cart`
- **Screenshots:** ![WR-033-1](<shots/WR-033-cart-header.png>)
- **Regression test:** `tests/wreck-it/WR-033.spec.ts`

## Load testing
### GET http://localhost:4318/api/products (ramp)
| Connections | RPS | p50 | p90 | p99 | Error rate |
|---:|---:|---:|---:|---:|---:|
| 10 | 16 | 546 ms | 872 ms | 1072 ms | 0.0% |

No breaking point found up to 10 connections

Memory: 142.49 MB/min (stable)

### GET http://localhost:4318/api/products (spike)
| Connections | RPS | p50 | p90 | p99 | Error rate |
|---:|---:|---:|---:|---:|---:|
| 10 | 19 | 479 ms | 551 ms | 1113 ms | 0.0% |
| 100 | 200 | 483 ms | 521 ms | 558 ms | 0.0% |
| 10 | 2 | 540 ms | 8272 ms | 8277 ms | 0.0% |

No breaking point found up to 100 connections

Memory: -183.36 MB/min (stable)

### GET http://localhost:4318/api/search?q=headphones (ramp)
| Connections | RPS | p50 | p90 | p99 | Error rate |
|---:|---:|---:|---:|---:|---:|
| 10 | 6 | 1575 ms | 2209 ms | 2553 ms | 0.0% |

Breaking point: 10 connections — p99 2553 ms > 2000 ms

Memory: 115.32 MB/min (stable)

### GET http://localhost:4318/api/search?q=headphones (spike)
| Connections | RPS | p50 | p90 | p99 | Error rate |
|---:|---:|---:|---:|---:|---:|
| 10 | 5 | 1789 ms | 2732 ms | 5492 ms | 0.0% |
| 100 | 5 | 4180 ms | 5887 ms | 8391 ms | 100.0% |
| 10 | 0 | 0 ms | 0 ms | 0 ms | 100.0% |

Breaking point: 100 connections — error rate 100.0% > 1.0%

Memory: -10.78 MB/min (stable)

### GET http://localhost:4318/api/stats (soak)
| Connections | RPS | p50 | p90 | p99 | Error rate |
|---:|---:|---:|---:|---:|---:|
| 20 | 538 | 9 ms | 22 ms | 74 ms | 0.4% |
| 20 | 0 | 0 ms | 0 ms | 0 ms | 100.0% |
| 20 | 0 | 0 ms | 0 ms | 0 ms | 100.0% |
| 20 | 13 | 424 ms | 7983 ms | 416443 ms | 21.8% |
| 20 | 0 | 0 ms | 0 ms | 0 ms | 100.0% |
| 20 | 18 | 481 ms | 5146 ms | 900515 ms | 7.0% |

Breaking point: 20 connections — error rate 100.0% > 1.0%

Crashed under load; recovered: yes

Memory: -2.88 MB/min (stable)

### GET http://localhost:4318/ (ramp)
| Connections | RPS | p50 | p90 | p99 | Error rate |
|---:|---:|---:|---:|---:|---:|
| 10 | 717 | 13 ms | 19 ms | 26 ms | 0.0% |
| 25 | 1083 | 20 ms | 36 ms | 48 ms | 0.0% |
| 50 | 1186 | 36 ms | 61 ms | 119 ms | 0.0% |
| 100 | 1206 | 77 ms | 112 ms | 162 ms | 0.0% |
| 200 | 1244 | 134 ms | 202 ms | 622 ms | 0.0% |
| 350 | 1304 | 195 ms | 322 ms | 3305 ms | 0.0% |

Breaking point: 350 connections — p99 3305 ms > 2000 ms

Memory: 194.15 MB/min (leak suspected)

## Coverage
- Stages: preflight: done, discover: done, personas: done, normal: done, explore: done, chaos: done, load: done, security: skipped, trace: done, report: done
- Personas: sweep, perf-scan, deal-shopper, mobile-returner, rushed-beginner, normal-user, chaos-monkey
- Routes visited: 15/13; not visited: `/logout`, `/orders/[id]`, `/products/[id]`

## Test data created

wreck-it created these in the app (all runs so far). If it ran against a shared or production database, delete them:
- account wreck.benchmark+mvg1q8hn2@gadgetly.test _(by normal-user)_
- 14 accepted request(s) to POST /api/cart _(by fuzz)_
- 5 accepted request(s) to PATCH /api/account _(by fuzz)_
- 9 accepted request(s) to POST /api/auth/signup _(by fuzz)_
- Local cart mutations, fake orders and profile attempts from exercise.cjs/followup.cjs/chaos.cjs; see transcripts and trace archives _(by chaos-monkey)_
- keyboard account wreck.benchmark+mvgm0z6b3@gadgetly.test _(by normal-user)_

## Unconfirmed / flaky
- WR-009 · Duplicate of WR-008: consolidated scan result
- WR-013 · Duplicate of WR-012: consolidated scan result
- WR-014 · Duplicate of WR-010: consolidated scan result
- WR-019 · Server crashed under load at 20 connections
- WR-021 · Duplicate of WR-007: coupon fuzz confirmation
- WR-022 · Duplicate of WR-020: search fuzz confirmation
- WR-028 · Duplicate of WR-023: repeated search latency
- WR-030 · Duplicate of WR-008: rich sweep confirmation
- WR-031 · Duplicate of WR-012: rich sweep confirmation
- WR-032 · Duplicate of WR-010: rich sweep confirmation
- WR-034 · Duplicate of WR-027: rich sweep confirmation
