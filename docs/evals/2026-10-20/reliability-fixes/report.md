# wreck-it report — final-report

**Readiness: 82/100 — Almost there**

> ⚠ Run incomplete: normal, explore, chaos, load did not finish

## Scores by category
| Category | Findings | Subscore |
|---|---:|---:|
| functional | 4 | 73 |
| ux | 0 | 100 |
| oddity | 2 | 87 |
| chaos | 0 | 100 |
| performance | 0 | 100 |
| security | 0 | 100 |
| accessibility | 0 | 100 |

## Findings
### MEDIUM
#### WR-003 · Signup validation preserves input after completed rejection
- **Category:** functional · **Persona:** reliability-check · **Route:** `/signup`
- **Expected:** Rejected signup keeps input and explains validation
- **Actual:** Generic error and cleared fields
- **Source:** _not traced_
- **Steps to reproduce:**
  1. Go to `http://localhost:4318/signup`
  2. Type "Reliability Shopper" into the field labelled "Your name"
  3. Type "reliability@example.com" into the field labelled "Email"
  4. Type "short" into the field labelled "Password"
  5. Click the button "Sign up"
  6. Wait for `.error` to be visible
- **Screenshots:** ![WR-003-1](<shots/WR-003-buggy.png>)
- **Regression test:** `tests/wreck-it/WR-003.spec.ts`

#### WR-004 · Coupon charge equals checkout total
- **Category:** functional · **Persona:** reliability-check · **Route:** `/checkout`
- **Expected:** One discount: $44.99
- **Actual:** Two discounts: $40.49
- **Source:** _not traced_
- **Steps to reproduce:**
  1. Send `POST http://localhost:4318/api/cart/coupon`
  2. Go to `http://localhost:4318/checkout`
  3. Type "123 Test Lane" into the field labelled "Delivery address"
  4. Click the button "Place order"
  5. Wait for the heading "Order #" to be visible
- **Screenshots:** ![WR-004-1](<shots/WR-004-buggy.png>)
- **Regression test:** `tests/wreck-it/WR-004.spec.ts`

#### WR-005 · Order date uses display format at every time of day
- **Category:** functional · **Persona:** reliability-check · **Route:** `/checkout`
- **Expected:** Formatted date without a raw ISO timestamp
- **Actual:** Raw timestamp rendered
- **Source:** _not traced_
- **Steps to reproduce:**
  1. Go to `http://localhost:4318/checkout`
  2. Type "123 Test Lane" into the field labelled "Delivery address"
  3. Click the button "Place order"
  4. Wait for the heading "Order #" to be visible
- **Screenshots:** ![WR-005-1](<shots/WR-005-buggy.png>)
- **Regression test:** `tests/wreck-it/WR-005.spec.ts`

#### WR-006 · Cart actions column has a named table header
- **Category:** functional · **Persona:** reliability-check · **Route:** `/cart`
- **Expected:** Named actions column
- **Actual:** Empty header
- **Source:** _not traced_
- **Steps to reproduce:**
  1. Go to `http://localhost:4318/cart`
- **Screenshots:** ![WR-006-1](<shots/WR-006-buggy.png>)
- **Regression test:** `tests/wreck-it/WR-006.spec.ts`

### LOW
#### WR-001 · Broken image: /images/team-photo.jpg
- **Category:** oddity · **Persona:** sweep · **Route:** `/about`
- **Expected:** Every image on the page loads
- **Actual:** http://127.0.0.1:57696/images/team-photo.jpg fails to load on /about.
- **Source:** _not traced_
- **Steps to reproduce:**
  1. Resize viewport to 1280x800
  2. Go to `/about`
- **Screenshots:** ![WR-001-1](<shots/sweep-db339640-2337-4377-a613-c825c3bdc9b2.png>) ![WR-001-2](<shots/WR-001-buggy.png>)
- **Regression test:** `tests/wreck-it/WR-001.spec.ts`

#### WR-002 · Dead link: /pricng (404)
- **Category:** oddity · **Persona:** sweep · **Route:** `/about`
- **Expected:** Links on the page lead to existing pages
- **Actual:** A link on /about points to /pricng, which returns 404.
- **Source:** _not traced_
- **Steps to reproduce:**
  1. Resize viewport to 1280x800
  2. Go to `/about`
- **Screenshots:** ![WR-002-1](<shots/sweep-07648030-f901-4559-8167-5af88c68f719.png>) ![WR-002-2](<shots/WR-002-buggy.png>)
- **Regression test:** `tests/wreck-it/WR-002.spec.ts`

## Coverage
- Stages: preflight: not run, discover: not run, personas: not run, normal: not run, explore: not run, chaos: not run, load: not run, security: not run, trace: not run, report: not run
- Personas: none
- Routes visited: 0/0
