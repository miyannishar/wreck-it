---
name: wreck-load
description: Load and stress test a local web app's pages and API endpoints with the wreck-it CLI. It runs ramp, spike and soak profiles, measures p50/p90/p99 latency, error rate, breaking point and memory trend, then traces slow endpoints to causes such as N+1 queries, missing indexes or blocking work. Use as stage 7 of a wreck-it run, or when the user asks to "stress test my API", "load test", "how many users can my app handle", or "find slow endpoints".
---

# wreck-load

`npx wreck-it run stage load running`

## Safety (non-negotiable)

- Targets must be localhost or private addresses. The CLI enforces this and exits with code 3 otherwise.
- Use GET/HEAD only. Mutating load needs `"allowMutatingLoad": true` in `.wreck-it/config.json`, and the user has to set that themselves. Never set it yourself.
- If the CLI warns that the database looks **remote**, stop and ask the user before any load test. Load against a shared or production database harms real systems.
- Prefer a production build (`npm run build && npm start`) over a dev server when the user agrees. Dev servers compile on first hit and give misleading numbers. Either way, say which one you tested.

## 1. Choose 3–6 targets

Pick them from `.wreck-it/discovery.json` and what you've seen while exploring:
- The home page and the main list page
- GET API endpoints that return collections: lists, search, feeds, dashboards, stats
- Anything that felt slow in the browser (check `browser_network_requests` timings)
- Endpoints with query params (search, filter, pagination). Load-test with a realistic param, e.g. `/api/search?q=phone`.

Skip auth-only endpoints unless you can pass a session cookie with `--header "cookie: …"`.

## 2. Find the server PID (for memory trend)

The CLI tries `lsof` on the URL's port automatically. If that finds nothing, pass `--pid <n>` (from `lsof -ti tcp:3000 -sTCP:LISTEN` or `pgrep -f "next start"`).

## 3. Run profiles

```bash
npx wreck-it load http://localhost:3000/api/products --profile ramp     # 10→500 connections until thresholds break
npx wreck-it load http://localhost:3000/api/products --profile spike    # 10 → 100 → 10
npx wreck-it load http://localhost:3000/api/stats --profile soak --soak-duration 180   # memory trend / leaks
```

- Run **ramp** on every target.
- Run **spike** on the 1–2 most important targets.
- Run **soak** (`--soak-duration 180`) on at least one target. Pick, in order of preference:
  1. an endpoint the UI calls repeatedly or on every page (polling, analytics, counters, "who's online"); look for repeats in `browser_network_requests`
  2. an endpoint that keeps state in memory
  3. the busiest list endpoint

Results are written to `.wreck-it/load/*.json`, and the report renders their charts.

## 4. Interpret and record

The CLI records server crashes itself as `critical` findings.

You **must** record a `performance` finding for each of these:
- p99 > 500 ms at 10 connections (a simple GET should be far faster; this usually means N+1 queries or sequential awaits)
- a breaking point below 100 connections
- `leakSuspected`, or RSS rising steadily through a soak

Put the endpoint path and the word "slow", "latency" or "memory leak" in the title. For anything else, use judgment. Read the handler code first, then record (see the wreck-trace skill):

| Signal | Likely cause to check in code | Severity guide |
|---|---|---|
| p99 high even at 10 connections | N+1 queries (a query or fetch inside a loop over results), unbounded query (no `limit`), missing index on the filter/sort column, heavy serialization | high if > 1 s, medium if > 300 ms |
| Latency climbs linearly with connections, CPU-bound | synchronous work on the request path (sync crypto/fs, big JSON, regex, sorting large arrays) blocking the event loop | high |
| Error rate jumps at N connections | connection-pool exhaustion, no backpressure, rate limits | high if N < 100, medium otherwise |
| Spike doesn't recover | resource leak, stuck pool, crashed worker | high |
| `leakSuspected` / rising RSS in soak | module-level arrays/maps/caches that grow per request, listeners added per request | high |

Write the finding with:
- `steps`: `[{"action":"http","method":"GET","url":"/api/products"}]`
- `actual`: the numbers, e.g. "p99 1840 ms at 10 connections; 12% errors at 100"
- `expected`: a target, e.g. "p99 < 300 ms at 50 connections"
- `source`: from tracing

Set `reproduced: true` once a second run shows the same signal.

## Finish

`npx wreck-it run stage load done`

Summarize the results as a short table: endpoint, p50/p99 at 10 and 100 connections, breaking point, memory.
