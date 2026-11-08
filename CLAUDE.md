# Agent guide

## What this is

A static GitHub Pages dashboard that tracks the cheapest weekend round-trip Coach fare between New Haven (NHV) and Boston South Station (BOS) on Amtrak's Northeast Regional. A daily Claude scheduled task appends rows to `data/amtrak_fare_log.csv`; the page fetches that CSV and turns it into charts, a book-now recommendation and a gated floor forecast. No build step, no dependencies, no server code. **Current state: working.** Tests and CI checks pass. The fare log's latest `captured_date` is **2026-07-28**, so the daily capture has not landed for months and, by its own 2-day rule, the page treats every quote as stale history. `README.md` holds the full list of what the page will and will not claim. Read it before you change a rule.

## Commands (all verified from repo root)

```bash
node --test 'test/**/*.test.js'                     # ~0.7s. Expect: tests 57, pass 57, fail 0
python scripts/validate_csv.py data/amtrak_fare_log.csv   # Expect: OK ... header + 249 data rows valid (grows as rows are appended)
python scripts/stamp_version.py --check             # Expect: OK: cache-busters up to date ... exit 0
python scripts/stamp_version.py                     # rewrite the ?v=<hash> stamps in index.html
python -m http.server 8000                          # view at http://localhost:8000; file:// falls back to a manual "Load fare log" button
```

- On this Windows machine use `python`, not `python3` (the README and CI say `python3`; it is not on PATH here). Set `PYTHONUTF8=1` or the validator's em dash prints garbled.
- CI also runs `TZ=Asia/Tokyo node --test ...`. **On Windows Node ignores `TZ`** (the offset stays local), so that run passes here without testing anything. The east-of-Greenwich weekend-keying check is only real in CI (ubuntu).
- Offline run used for verification: `NODE_OPTIONS="--require <sop-repo-sweep>/scripts/nonet.cjs" CI=1 node --test 'test/**/*.test.js'`.
- No `package.json` and no `node_modules`; there is nothing to install. Chart.js 4.4.1 loads from cdnjs with an SRI hash.

## Architecture map

| File | Role |
|---|---|
| `js/fare-data.js` | The trust layer: CSV parsing, row validation, weekend pairing, staleness, departed legs, gated floor fit. Pure and DOM-free; exported as `module.exports` (Node) and `window.FareData` (browser). Thresholds at the top (`STALE_AFTER_DAYS`, `MIN_LEAD_POINTS`, `MIN_FIT_CAPTURES`, `MIN_FIT_SPAN_DAYS`, `MIN_FIT_R2`). |
| `js/dashboard.js` | Rendering only. Draws what `fare-data.js` vouches for; computes nothing that decides truth. |
| `index.html` | Page shell, styles, Chart.js tag, and the two `<script src="js/...?v=<hash>">` tags. |
| `data/amtrak_fare_log.csv` | Append-only fare log, 14 columns (first 9 are the legacy schema; a 9-column file still loads). |
| `test/fare-data.test.js` | `node:test` suite; every test started as a reproduction of a shipped defect. `TODAY` is pinned to `2026-09-18`. |
| `test/fixtures/*.csv` | Synthetic logs: stale, sparse, duplicates, malformed, tz-boundary, departed legs, missing trains, legacy 9-column. |
| `scripts/validate_csv.py` | Stdlib schema validator for the log (CI gate). |
| `scripts/stamp_version.py` | Content-hash cache-busters for both JS files (`--check` for CI). |
| `.githooks/pre-commit` | Runs `stamp_version.py` when `js/dashboard.js` is staged. `core.hooksPath` is already set to `.githooks` on this machine. |
| `.github/workflows/validate-csv.yml` | CI "Checks": validator, stamp check, tests, tests under `TZ=Asia/Tokyo`. |
| `tracker/tracker-prompt.md` | The prompt the daily scheduled task runs (it drives amtrak.com in a browser). Reference copy, not executed here. |
| `docs/screenshots/*.png` | Rendered fixture states at a pinned date, for review. |

## Conventions and gotchas

- **A blank cell means "not observed", never `0`.** Both the validator and `fare-data.js` depend on it.
- **A round trip is two legs from the same capture.** Never sum an outbound seen one morning with a return seen another.
- **`days_ahead` is re-derived, never trusted.** Weekends are keyed in UTC epoch-days; "today" is `America/New_York`. Never build a `Date` from a local-midnight string.
- **The CSV schema is a contract with three readers**: the tracker prompt, `validate_csv.py` and `fare-data.js`. A column change must update all three plus fixtures.
- **The log is append-only.** Never rewrite or reorder past rows. Removing a same-day duplicate is a deliberate, separately committed data fix (see commit `7136d8d`).
- **Cache-buster trap:** the pre-commit hook fires only when `js/dashboard.js` is staged, but `stamp_version.py` stamps `js/fare-data.js` too. If you change only `fare-data.js`, run `python scripts/stamp_version.py` yourself and commit `index.html`, or CI's `--check` fails.
- The train-vs-drive table and lowest-of-day table are fixed July 2026 reference figures; they do not recompute from the log.
- The repo is public, so the fare log is public. No secrets exist here; the tracker's browser session and GitHub connector live in claude.ai, not in this repo.
- Do not read `docs/screenshots/*.png` unless you are reviewing a rendering change.

## Skills for this repo

Load these with the Skill tool when the situation comes up; the user does not need to ask.

| Situation in this repo | Skill |
|---|---|
| Writing or reviewing a parsing, pairing, staleness or forecast rule in `js/fare-data.js` | `sop-fail-loud` |
| A recommendation, round-trip total or forecast on the page looks wrong, or a test fails | `diagnosing-bugs` |
| Fixing a trust-layer defect: add a fixture and a failing test first | `tdd` |
| Changing a threshold that decides what the page claims (2-day staleness, forecast gates, the 10-observation "good to book" bar, the sensible-hours windows) | `sop-owner-decision` |
| Changing a chart, the KPI row or the season view in `index.html` / `js/dashboard.js` | `dataviz` |
| Proving a dashboard change renders against the real log (serve it, look, refresh a screenshot) | `run` |
| Committing (the hook may restage `index.html`) | `safe-commit` |
| Opening or merging a PR (CI "Checks" must pass) | `sop-ship-pr` |
| Editing this CLAUDE.md, or a change moves a number in it | `sop-project-guide` |

## Before you finish any task

1. `node --test 'test/**/*.test.js'` → `pass 57`, `fail 0` (more passes is fine if you added tests).
2. `python scripts/validate_csv.py data/amtrak_fare_log.csv` → `OK: ... valid`, exit 0.
3. `python scripts/stamp_version.py --check` → `OK: cache-busters up to date for js/fare-data.js, js/dashboard.js`, exit 0.
4. `git diff --stat` → only files you meant to change.

## Model routing

Safe for Sonnet: README/DEPLOY/CLAUDE.md edits; CSS and layout tweaks in `index.html`; adding a fixture plus a test for an existing rule; refreshing screenshots; appending captured fare rows that pass the validator; restamping cache-busters.

Escalate to Opus: any rule in `js/fare-data.js` that decides whether a fare is valid, current, bookable or paired; the forecast model and its gates; a CSV schema change; anything that changes what the recommendation card or forecast table claims; rewriting or deleting logged rows.
