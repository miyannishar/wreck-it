# Normal-user checks

Target: production build at http://localhost:4318. Playwright MCP was available;
supplemental local Playwright scripts provided isolated contexts, traces and repeatable batches.
No tools installed; no agent settings or application source changed.

| # | Check | Result |
|---|---|---|
| 1 | Created entities appear in list/detail | ✓ Signup, cart additions and placed orders visible. Duplicate checkout separately fails WR-024. |
| 2 | Edits persist after reload and fresh context | ✗ WR-003: display-name save reports success but reload restores old name; freshly reproduced. |
| 3 | Deletes disappear in lists, totals and badges | ✗ WR-004: last item disappears but badge remains. Quantity edits also leave count stale. |
| 4 | Arithmetic at cart, checkout, order detail and history | ✗ WR-001: two headphones line total $299.98 but subtotal $149.99. WR-002: SAVE10 reduces $134.99 again to $121.49 when stored. List agrees with stored incorrect total. |
| 5 | Same facts and date format across list/detail | ✗ WR-026: history calendar date vs raw ISO timestamp in detail. Product price/name match. |
| 6 | Newest-first lists | ✗ WR-025: ascending order timestamps put oldest first. |
| 7 | Fresh-account collection empty states | ✗ WR-017: orders spins after successful empty response and >5s wait. Cart shows empty text; checkout provides shop link. |
| 8 | Specific errors preserve input | ✗ WR-005: short signup password produces generic error and clears fields. Settings empty/long name errors are specific; search percent fails WR-020. |
| 9 | Throwaway logout/login preserves data | ✓ session-check.json: throwaway account's cable remains after logout and login. Shared main account was never logged out. |

No onboarding or account/order deletion UI exists. Product catalog is read-only.
Email uses CLI-generated addresses under the configured gadgetly.test pattern; no email delivery occurs.

Desktop deal-shopper, mobile-returner and rushed-beginner missions were exercised sequentially.
Rushed signup, padded coupon and double checkout findings have isolated fresh-context reproductions.
Back/forward/reload runs encountered interrupted SPA navigation; retries and the final independent
keyboard purchase completed. See chaos logs for individual observations, not blanket success claims.

Keyboard-only signup, search, product selection, cart quantity, coupon, checkout, history and settings
completed (keyboard-log.json). The cart button and phone input lack accessible names (WR-015/027).
