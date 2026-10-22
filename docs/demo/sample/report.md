> Scripted replay of one known bug in the seeded Gadgetly demo. This is a product walkthrough sample, not a fresh agent discovery run or a whole-app assessment.

# wreck-it report — gadgetly-scripted-checkout-replay

**Focused run — checkout — scripted single-bug replay: 90/100 — Ship it**

> Only checkout — scripted single-bug replay was tested, so this score covers that feature, not the whole app.
> Fix this first: WR-001 Checkout total ignores item quantity

## Scores by category
| Category | Findings | Subscore |
|---|---:|---:|
| functional | 1 | 83 |
| ux | 0 | 100 |
| oddity | 0 | 100 |
| chaos | 0 | 100 |
| performance | 0 | 100 |
| security | 0 | 100 |
| accessibility | 0 | 100 |

## Findings
### HIGH
#### WR-001 · Checkout total ignores item quantity
- **Category:** functional · **Persona:** scripted-demo-replay · **Route:** `/checkout`
- **Expected:** Three Aurora Wireless Earbuds at $79.99 each total $239.97, with no coupon.
- **Actual:** The line total is $239.97 but the cart subtotal and checkout total show $79.99.
- **Source:** `lib/cart.ts:19` — The subtotal adds each unit price once instead of summing price multiplied by quantity (lineTotal). The corrected copy changes this one expression. (confidence: high)
- **Steps to reproduce:**
  1. Send `POST http://127.0.0.1:3100/api/auth/signup`
  2. Send `POST http://127.0.0.1:3100/api/cart`
  3. Go to `http://127.0.0.1:3100/cart`
  4. Type "3" into the field labelled "Quantity for Aurora Wireless Earbuds"
  5. Press Tab in the field labelled "Quantity for Aurora Wireless Earbuds"
  6. Wait for the cell "$239.97" to be visible
  7. Click the link "Checkout"
  8. Wait for the heading "Order summary" to be visible
- **Screenshots:** ![WR-001-1](<shots/buggy-cart.png>) ![WR-001-2](<shots/buggy-checkout.png>)
- **Regression test:** `tests/wreck-it/WR-001.spec.ts`

## Coverage
- Stages: preflight: skipped, discover: skipped, personas: skipped, normal: done, explore: skipped, chaos: skipped, load: skipped, security: skipped, trace: done, report: done
- Personas: scripted-demo-replay
- Routes visited: 2/0
