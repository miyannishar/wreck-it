# wreck-it marketing analysis

Baseline date: October 19, 2026. Primary goal: grow adoption of the open-source skill among developers building local web apps with coding agents.

wreck-it is published and has useful launch foundations. The immediate priorities are stronger evidence, a visible demonstration, and reliable discovery. Work on priority one before expanding promotion.

## Priority one update on October 20

The [fresh benchmark and evidence review](docs/evals/2026-10-20-benchmark.md) is saved. Reviewed seeded-bug recall was **19/23 (82.6%) for Sonnet** and **21/23 (91.3%) for Codex**. Both exceeded the recall threshold; the existing scorer returned zero unmatched findings. Manual review corrected a raw Codex overcount, so use the reviewed result in marketing.

The two agents' runs exposed differences in screenshot coverage and procedural completeness. The skill instructions now require relevant inspected screenshots and image attachments when presenting browser bugs. The main skill’s YAML frontmatter was also corrected. The benchmark records the generated-test and matching defects that prompted the follow-up below.

The [reliability follow-up](docs/evals/2026-10-20-reliability-fixes.md) now addresses the identified false pass, brittle assertions, absolute navigation URLs, overwritten custom specs, and loose scoring. Six focused checks fail for the defects and pass after targeted corrections, with screenshot evidence. This verifies known cases, rather than another full blind run. On October 21, version 0.2.0 was published under the new npm account as [@miyanishar/wreck-it](https://www.npmjs.com/package/@miyanishar/wreck-it), linked to the same GitHub repository. Both the packed and published installations passed their checks; see the [release verification](docs/releases/0.2.0-verification.json). Proceed to priority two's demo. The adoption baseline below belongs to the original npm scope and should be tracked separately from the new package.

## What is already done

Priority two's assets are complete: the user selected their CapCut export `1021.mov` as the final product video. The [36.47-second MP4](docs/demo/wreck-it-demo.mp4) is embedded as a native GitHub video attachment near the top of the README, alongside the [sample report with relevant screenshots](docs/demo/sample/report.md). This selected edit supersedes the originally planned 60–90 second duration. The MP4 preserves the edited timeline and original audio, and passed full decoding and browser playback checks. The known-bug replay fails on the buggy copy and passes on the corrected copy with the same generated test. The [walkthrough guide](DEMO_WALKTHROUGH.md) retains the production references.

| Area | Current state |
|---|---|
| Product | Six agent skills and a deterministic CLI for exploration, personas, chaos, accessibility, performance, findings, reports, and regression-test generation. |
| Distribution | Public MIT-licensed GitHub repository, npm package, and a self-hosted Claude Code plugin marketplace. |
| Installation | Documented paths for Claude Code, Codex, Cursor, Gemini CLI, and Copilot. Installation support does not establish equal benchmark performance. |
| Positioning | Clear tagline: “Wreck your app before your users do.” The README describes concrete bugs and user scenarios. |
| Demo | Runnable Next.js shop containing 23 seeded bugs, with a manifest and evaluation script. |
| Evidence | October 4 Sonnet evaluation: 22/23 seeded bugs, zero recorded false positives, 17.4 minutes, approximately $3.95. This is a result on one synthetic app, not a general accuracy claim. |

The [benchmark notes](docs/evals/2026-10-04-release-gate.md) document the evaluation and its limitations.

## Adoption baseline

These figures are a dated snapshot, not live counters.

| Metric | October 19 baseline |
|---|---|
| npm version | 0.1.0, published October 4, 2026 |
| npm downloads | 183 during September 19–October 18; 8 during October 12–18 |
| GitHub | 0 stars, 0 forks, no published releases or tags |
| GitHub traffic | Authenticated repository analytics: 4 views and 4 unique visitors during October 5–18 |
| Successful external runs | Not established by download or traffic counts |

Sources: [GitHub repository](https://github.com/miyannishar/wreck-it), [npm registry metadata](https://registry.npmjs.org/@miyannishar%2fwreck-it), [dated monthly downloads](https://api.npmjs.org/downloads/point/2026-09-19:2026-10-18/@miyannishar/wreck-it), [dated weekly downloads](https://api.npmjs.org/downloads/point/2026-10-12:2026-10-18/@miyannishar/wreck-it), and authenticated GitHub traffic analytics.

## Search discoverability review on October 21

The repository is reachable and searchable inside GitHub. The main opportunities are clearer product identification and more independent discovery links. Web search checks did not surface the repository directly for the tested brand queries. This observation does not establish its exact Google index status or a universal ranking position.

| Finding | Evidence | Impact and action |
|---|---|---|
| No obvious crawl block | The public repository returned HTTP 200, no `noindex` meta tag or `X-Robots-Tag`, and GitHub's robots rules permitted the repository root for Googlebot and Bingbot. | No crawl-blocking change was indicated by these checks. This establishes crawl eligibility, not confirmed Google indexing. |
| GitHub search already works | GitHub's repository search API returned the project for `repo:miyannishar/wreck-it` and the owner-qualified name query. Eight relevant topics were already configured. | Preserve the existing topics and add accurate categories for browser testing, AI testing, regression testing, Codex, and Cursor. |
| The name is crowded | `wreck-it in:name` returned 169 matching repositories, including longer game-related names. Web searches also surfaced a different AI project at [wreckit.app](https://wreckit.app/). | Use the descriptor “AI QA testing for local web apps” consistently. The evidence suggests ambiguous search intent; it does not reveal the search engine's exact ranking reasons. |
| The product category appeared too late | The README heading contained only the name, and its explanation followed the demo. The About description began with the slogan. GitHub's rendered HTML used that description in its title and metadata. | Put the QA testing category and supported agents in the heading/lead paragraph, and replace the About description with a concise product description. |
| External search visibility remains limited | The tested queries included `wrect it github`, `wreck it github`, `"wreck-it" "miyannishar"`, `"miyannishar/wreck-it"`, and `site:github.com/miyannishar/wreck-it`. Results included another project, the owner profile, and an older npm-scope reference. | Earn relevant links through the owner's site/profile, genuine directory listings, and useful demonstrations. No backlink inventory or Search Console data was available, so link authority was not quantified. |

The README now leads with “wreck-it: AI QA testing for local web apps” and explains the skill, supported coding agents, Playwright workflow, and evidence before the demo. The repository About description and expanded topic list reinforce that description. These are discoverability improvements, not a promise of ranking for the broad or misspelled brand query.

Useful checks are `wreck-it QA testing`, `wreck-it miyannishar`, and the owner-qualified GitHub query `wreck-it user:miyannishar`. Do not add misspellings to the product copy or manufacture installs, stars, or backlinks.

The next web SEO step is an owned project landing page with a descriptive title, installation instructions, the final demo, and a link to the repository. Verify that site in Search Console and submit its URLs there. GitHub controls the repository page's outer HTML and robots configuration; adding a robots file or meta tags to the README would not configure `github.com`.

Google says crawling can take days to weeks and that a crawl request does not guarantee indexing. Its `site:` operator is not an exhaustive index check. Recheck discovery after the changes have been crawled; do not interpret an immediate unchanged result as a failed fix. Sources: [GitHub repository search](https://docs.github.com/en/search-github/searching-on-github/searching-for-repositories), [GitHub topics](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/classifying-your-repository-with-topics), [Google recrawling guidance](https://developers.google.com/search/docs/crawling-indexing/ask-google-to-recrawl), and [Google site-search limitations](https://developers.google.com/search/docs/monitor-debug/search-operators/all-search-site).

## Marketing gaps

- No demo video, product screenshots, public sample report, testimonials, or real-user case studies were present in the repository at the baseline date.
- Indexed searches did not establish a public launch campaign. Private and unindexed activity remain unknown.
- All six expected skills.sh pages displayed an unavailable message. The repository install-count badge also reported that its resource was not found.
- The plugin marketplace in this repository supports direct installation. wreck-it was absent from Anthropic’s official marketplace manifest; the two distribution paths are separate.
- The README is 511 lines long. Its opening would benefit from a short demo, report screenshot, and one clearly recommended installation path.
- The npm package has no keywords. There are no checked-in GitHub Actions workflows, contribution guide, or issue templates.

## Claims to validate before wider promotion

### Bug detection

The existing 22/23 result is useful when accompanied by its date, model, app, and evaluation method. The documented release gate requires at least 80% recall and at most two false positives on Claude Code and one other agent. Second-agent verification was incomplete at the baseline date.

Rerun against the current skill and CLI. Keep the seeded-bug manifest and previous results out of discovery sessions. Save raw findings before scoring and review automated matches for the same root cause.

### Generated regression tests

The previous evaluation generated 32 specs: 11 failed, 7 timed out, 9 were skipped as `fixme`, and 5 passed despite the bugs remaining. It predates subsequent assertion guidance. Timeouts alone do not prove a useful regression assertion.

Check whether each test reaches the intended assertion, fails for the actual defect, and passes after a minimal fix in an isolated copy. Report weak assertions, fixture failures, timeouts, and unsupported cases separately. Qualify “a regression test for every bug” until that evidence supports it; performance findings already have no generated browser test.

### Screenshots and readiness scores

Attach relevant screenshots to browser findings and include them when presenting bugs. A generic page screenshot is insufficient when it does not show the reported state. For API or load defects without a meaningful visual symptom, attach request or metric evidence and explain why a screenshot does not apply.

The score uses deterministic arithmetic, but findings depend on model behavior and coverage. Do not present the score as a guarantee that an app is ready to ship or as proof of equivalent coverage across agents.

## Priorities

| Priority | Work | Completion evidence |
|---|---|---|
| 1 | Refresh the benchmark, complete second-agent verification, evaluate generated-test quality, and require relevant screenshot evidence. | Dated evaluation with exact versions, recall, false positives, coverage, runtime, test outcomes, screenshot checks, and reproducible artifacts. |
| 2 | Record a 60–90 second demonstration of `/wreck focus checkout`; show a reproduced bug, its screenshot, report, and source location. | Video, screenshot, and sanitized sample report near the top of the README. |
| 3 | Repair skills.sh discovery, submit the validated plugin to Anthropic’s directory, and improve release presentation. | Verified listing URLs, submission status, versioned GitHub release, npm keywords, and a simple bug-report template. |
| 4 | Recruit five developers using coding agents on local web apps. Help them complete a first run and document useful findings. | Five completed external runs, installation feedback, and permission to publish selected case studies. |
| 5 | Publish short demonstrations and real findings in existing social channels and relevant developer communities. | Track which posts bring developers who complete a run and return. |

Priority one was authorized on October 19, 2026. Record its outcome in a new dated file under `docs/evals/`; update this document’s status afterward without overwriting the original baseline.

### Priority three status on October 24

| Item | Status |
|---|---|
| Versioned GitHub release | Done: [v0.2.0](https://github.com/miyannishar/wreck-it/releases/tag/v0.2.0), October 21. |
| npm keywords | Added to `packages/cli/package.json` with a description matching the README. Visible on npm only after the next publish. |
| Bug-report template | Added at `.github/ISSUE_TEMPLATE/bug_report.md`. |
| skills.sh | All six pages still show "isn't available". `npx skills add miyannishar/wreck-it --list` discovers the skills correctly, so the listing now waits on genuine installs (priority four). Add the badge once the pages resolve. |
| Anthropic directory | `claude plugin validate .` passes. Blocked: submitting needs a paid claude.ai plan (Pro/Max) on the owner's personal account; the work org account is not an owner. |
| Free directories (October 25) | Listed on [awesomeskills.dev](https://www.awesomeskills.dev/skill/wreck-it-wreck-it). PR opened to [karanb192/awesome-claude-skills#535](https://github.com/karanb192/awesome-claude-skills/pull/535). ComposioHQ/awesome-claude-skills now accepts PRs from collaborators only. Listed on [ClaudePluginHub](https://www.claudepluginhub.com/plugins/miyannishar-wreck-it) the same day. Awesome Skills still shows the old `>-` description from its first index and has no refresh option. |

## Audience and positioning

Start with Claude Code users building local web apps and approaching a first launch. That audience matches the existing plugin experience and strongest documented evaluation. Expand agent-specific claims as fresh evidence becomes available.

Suggested product description:

> wreck-it turns your coding agent into a QA team for your local web app—testing user flows, hostile inputs, accessibility, and traffic spikes, then reporting reproduced bugs with code locations.

Keep costs precise: the CLI needs no additional LLM API key, while the coding agent may consume paid usage. Security testing is outside v1.

## Distribution research

### Skills directory

skills.sh states that listings arise automatically from anonymous installation telemetry when users run `npx skills add <owner/repo>`. Verify the published installation path with genuine external testers, confirm all six listing pages, then add the official badge. Do not manufacture installs to influence rankings.

Sources: [listing mechanism](https://www.skills.sh/docs/faq), [badge documentation](https://www.skills.sh/docs), [expected main listing](https://www.skills.sh/miyannishar/wreck-it/wreck-it).

### Anthropic directory

After installation validation, submit the plugin bundle through the current developer portal. A repository marketplace alone does not create an official listing. Listing approval and timing belong to Anthropic.

Sources: [official marketplace](https://github.com/anthropics/claude-plugins-official), [submission instructions](https://claude.com/docs/directory/publish).

### Demonstrations and communities

Reuse one concrete bug story as a short video, a social post, and a technical walkthrough. Show the input, visible failure, relevant screenshot, and code location. Use community channels that permit product demonstrations and be available to answer questions. Defer paid acquisition until installation and first-run completion are understood.

Show HN is a possible later launch channel because the project can be run locally. HN currently publishes a temporary restriction notice for Show HNs, especially for people unfamiliar with the community; check eligibility and current guidance before planning around it.

Sources: [Show HN guidelines](https://news.ycombinator.com/showhn.html), [restriction notice](https://news.ycombinator.com/showlim).

## Competitive context

Generic AI testing is already served by established projects. [gstack](https://github.com/garrytan/gstack) offers exploratory QA, reproduced findings, and regression workflows. [Playwright Test Agents](https://playwright.dev/docs/test-agents) provide planner, generator, and healer agents. [Anthropic’s webapp-testing skill](https://github.com/anthropics/skills/tree/main/skills/webapp-testing) covers local web application testing with Playwright.

Demonstrate the value of wreck-it’s combined persona, chaos, accessibility, and load workflow. Avoid unsupported claims of unique capabilities or superiority. Another agent project uses the [wreck-it name](https://wreckit.app/); consistently include a descriptor such as “QA for AI-built web apps” to help distinguish this project.

## Initial learning targets

For the first two weeks of external testing, aim for five completed runs, three useful confirmed bugs, and two developers returning for another run. These are proposed learning targets, not adoption forecasts.

Track discovery source, agent and model, framework, setup time, first-report completion, useful confirmed bugs, and repeat use. Downloads and stars are supporting indicators; successful use is the main signal.
