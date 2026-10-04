# Release-gate eval: 2026-10-04

**Gate (spec §11):** ≥80% recall, ≤2 false positives on `examples/buggy-app` (23 seeded bugs), on Claude Code and at least one other agent.

**Result:** **met on Claude Code (Sonnet): 22/23 (96%) recall, 0 false positives.** Not yet verified on a second agent: Codex reached 74% on the earlier skills before its workspace ran out of credits. See *Open* below.

## Setup

- Each run used a fresh copy of the app in a scratch directory, served as a production build (`next start`) on its own port.
- The copy had no answer key: `wreck-manifest.json` removed, README and package name neutralized, lockfile removed.
- Claude Code ran headless (`claude -p "Wreck my app…" --plugin-dir <repo> --model <m>`). Tools were allowlisted (`npx wreck-it`, `curl`, read/write, the plugin's three browsers), and `Edit` was disallowed.
- Codex ran with `codex exec --approve-for-me`. It had the skills in `.agents/skills`, `AGENTS.md.snippet` as `AGENTS.md`, and Playwright MCP passed with `-c` (the user's global config was untouched).
- Scored with `node scripts/eval.mjs --app examples/buggy-app --root <copy>`.

## Runs

| Run | Skills | Recall | FP | Time | Cost | Notes |
|---|---|---|---|---|---|---|
| Haiku #1 | v0 | 6/23 (26%) | 2 | ~15 min | $2.64 | Load false-crash (CLI bug, fixed); 7 real findings never reproduced |
| Haiku #2 | v1 | 3/23 (13%) | 1 | — | $2.84 | Skipped stages, invented CLI flags, didn't wait for subagents |
| Haiku #3 | v2 (+`sweep`) | 7/23 (30%) | 0 | — | $1.93 | `sweep` alone contributed 6 hits; judgment stages still skipped |
| Sonnet #1 | v1 | 17/23 (74%) | 0* | 11.9 min | $4.02 | Missed broken image, overflow, UI error message, N+1, double-submit |
| Codex #1 | v1 | 17/23 (74%) | 1* | ~70 min | — | Missed all 3 performance bugs; stopped mid-trace (out of credits) |
| **Sonnet #2** | **v2** | **22/23 (96%)** | **0** | **17.4 min** | **$3.95** | **PASS.** Only miss: B12 (empty cart without guidance) |
| Codex #2 | v2 | — | — | — | — | Failed at start: Codex workspace out of credits |

\* Re-scored after the manifest corrections below. All runs use the same final manifest.

Skill versions:
- **v0:** the initial skills.
- **v1:** adds immediate reproduction, the reproduction sweep, the normal-user checklist, the chaos log, mandatory soak, and one browser per persona.
- **v2:** adds `wreck-it sweep`, error messages checked in the UI, concurrent double-submits, and the p99 > 500 ms threshold.

## Fixes the eval drove

**CLI**
- `load`: a crash now means the port refuses TCP connections. Previously, a 2 s HTTP timeout on a slow endpoint was read as a crash.
- `a11y --record`: one finding per rule across pages.
- New `sweep` command: every page at desktop and mobile widths, logged in, deduplicated and self-reproduced.
- The oddity script no longer probes logout, delete and similar links. It could log the tester out.
- `gen-tests`:
  - waits (capped) for the network to settle after navigation and clicks, so negated assertions can't pass on half-rendered pages
  - new `httpStatus.atLeast`
  - `{{unique}}` placeholders for re-runnable sign-ups

**App (unseeded bugs removed)**
- The cart table overflowed on mobile.
- Empty cart and checkout states had no `<h1>`.

**Manifest**
- Tightened B21's keywords.
- Added B04 and B14 synonyms.
- Added `extras` for real-but-unseeded issues. These count as neither hits nor false positives.
- Every corrected match was a same-root-cause case, checked by hand.

## Regression tests (Sonnet #2)

These are the 32 generated specs, run against the still-buggy app after the `gen-tests` settle fix:

| Outcome | Count | Meaning |
|---|---|---|
| failed | 11 | correct while the bug exists |
| timed out | 7 | correct while the bug exists |
| `fixme` | 9 | no assertions, so skipped |
| passed | 5 | weak assertions written by the agent |

The run predates the new assertion-quality guidance, `atLeast` and `{{unique}}`.

## Open

- **Second-agent verification:** rerun Codex (after a credit refill) or Gemini CLI on v2 skills.
- **Haiku-class models:** don't follow the multi-stage procedure. Document Sonnet/Opus-class as the recommended models.
- **Generated-test quality:** recheck the false-pass rate with the new guidance on the next Sonnet run.
