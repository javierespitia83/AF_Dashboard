# BUILD_PLAN.md — step-by-step plan to rebuild the dashboard

Audience: an AI agent rebuilding the app from the documents. Follow the steps in order; each ends with a check you can run. Do not skip the documentation reading (step 0) and do not build features that are not in `SPEC.md`. Design rationale lives in `DECISIONS.md`; code structure in `IMPLEMENTATION.md`.

Working rules (from `AGENTS.md`): English only; never hand-edit `sprint.json` / `backlog.json`; never invent missing values (`—` instead); update the docs *before* changing behaviour; never delete files permanently; do not touch the archive or tracker at their AF_Snaplogic paths documented in `AGENTS.md`.

## Step 0 — Read, in this order
1. `README.md` (orientation) → 2. `SPEC.md` → 3. `DATA_CONTRACT.md` → 4. `IMPLEMENTATION.md` → 5. `ACCEPTANCE.md` → 6. `DECISIONS.md` (sections 1–2c and the open questions) → 7. app `AGENTS.md`, then the AF_Snaplogic project rules at the absolute path listed there.
Confirm the data exists: `sprint.json`, `backlog.json`, `schema/snapshot.schema.json`, `fixtures/sample_snapshot.json`. If the JSON is missing or stale, see Step 12.

## Step 1 — Shell and data loading
Create `index.html` and `backlog.html` (identical shell, different page script and active tab), `dashboard.css` with the tokens and shell rules, and the beginning of `dashboard.js`: `loadSnapshot`, `showError`, `emptyState`, `setUpdated`, `el`, `clear`. Page scripts just load and show "Data as of …".
**Check:** both pages load via `python3 -m http.server 8000`; a missing/invalid JSON shows the specified message; opening by `file://` shows the "start the local server" message; the console is empty (inline favicon `data:,`).

## Step 2 — Pure logic
In `dashboard.js` add, with no DOM: `bucketOf`, value helpers, `sum`, `statusTotals`, `aggregateBy`, `countBy`, `crossTab`, `median`, `createStore` (§4 of `IMPLEMENTATION.md`).
**Check in the console:** `AF.statusTotals(tickets)` equals the reference numbers in `ACCEPTANCE.md` §2 for the 2026-10-01 snapshot (sprint 68 items / 173 points; Done 34/87 in that snapshot; backlog 125 tickets / 76 points); `store.click` semantics (select-only, clear on second click, multi toggle).

## Step 3 — Tiles and the sprint page (no chart yet)
Add DOM helpers (`tile`, `rebuild`, `rowButton`, `stackedBar`, `simpleBar`, `heatGrid`, `buildTable`, `filterBar`) and CSS for tiles, KPI tiles, bars, rows, heat grid, tables. Build `sprint.js`: four KPIs first (items, points, Done %, no tester), status tile, assignee and tester tiles, matrix, detail table, Fix version / Parent selects, tags, Reset all.
**Check:** unfiltered numbers equal an independent calculation; plain click, click again, Ctrl/Cmd/Shift click; AND across dimensions; a dimension tile ignores its own dimension; zero-result combination shows the empty state; `Open` counts as To Do/Open; unknown status shows as Other; null points show `—` and count 0.

## Step 4 — Backlog page
`backlog.js`: five KPIs, DoR/Priority/Type/Age tiles, readiness × priority grid, table, search with DoR prefix (≥ 3 characters: `mis`, `wea`, `rea`).
**Check:** `mis`/`miss`/`missi`/`missing` all give DoR = Missing; `ab` is a text search; search is AND with tile selections; DoR pills use the tracker fills.

## Step 5 — Dashboard layout
Add the `@media (min-width:1366px) and (min-height:760px)` block (grid rows, grid columns, `overflow:hidden`) and keep the base rules before it. Make tile bodies scroll inside the tile with sticky headers and a pinned Total row.
**Check:** at 1920×1080, 1536×864, 1440×900, 1366×768 there is no page scroll and the board fills the viewport; at 1280×720, 1024×768, 800×900, 480×900 the page scrolls normally with no horizontal page scroll.

## Step 6 — Jira links
`JIRA_BASE` once, `jiraLink`, `linkify`, `ticketCell`, `linkCell`; link the Ticket column and the Parent / Linked work items (sprint) and Epic / Related-cluster (backlog) cells only.
**Check:** every `href` is exactly `https://mysnaplogic.atlassian.net/browse/<KEY>`, `target="_blank"`, `rel` has `noopener`; free-text cells (Summary, Current situation, Risk) contain no link (`UTF-8` is not a key); odd data (HTML, `javascript:`) creates no extra element; clicking a link changes no filter.

## Step 7 — Sprint-page extension: data, then KPIs
Check `DATA_CONTRACT.md` §2a: the sprint file must carry `sprint {id,name,startDate,endDate,carriedOver}` and per-ticket `doneDate`, `addedDate`, `cycleTime`. If they are missing, **stop and request them from the exporter/skill** — do not invent them. Then add the three KPIs: Avg cycle time, Added mid-sprint (`AF.config.midSprintThresholdDays = 2`), Carried over (read `sprint.carriedOver` as is; `null` → "Not calculated yet for this sprint", never 0; no `sprint` object → "No sprint data in sprint.json").
**Check:** values equal the hand-computed answers from a small hand-made sprint (the harness uses six tickets; remaining `[9,4,1,1]` through today, 3.3 days, 2 added, 3 carried over).

## Step 8 — Burndown
Implement `burndown()` then `drawBurndown()` exactly as in `IMPLEMENTATION.md` §7 (scope steps for ticket additions and, when present, `sprint.removed`; ideal line from the starting scope to 0 over calendar days; today = `refreshedAt`; pre-start `doneDate` counts on day 1; Done without `doneDate` is not subtracted and is counted in the footnote). Place it first in the main row. Redraw on window resize with a `ResizeObserver`; derive the height from the container.
**Check:** one point per calendar day; no remaining value after today; Today marker only when inside the sprint; additions and removals respond to filters; empty state with zero tickets; message when dates are missing; no scroll bars; readable at 1366×768 (this is where the chart was once cut off).

## Step 9 — Change markers and ticket panels
Add keyboard-accessible x-axis markers for ticket additions (`g.bd-added`) and removals (`g.bd-removed`). Addition markers show `+N`; removal markers show `−N` below the axis and move date labels down. Tooltips show the date, tickets and points; the caveat for older snapshots is documented. Clicking a marker (or Enter/Space) opens the panel (`.bd-pop`) with that date's tickets; the same marker, ×, or Escape closes it. The panel follows filters, survives resize, changes no filter, and stays inside the tile. See `SPEC.md` §6.3 and `DECISIONS.md` D44/D52.
**Check:** `ACCEPTANCE.md` burndown block.

## Step 10 — Accessibility pass
Real buttons for everything clickable, `aria-pressed`, visible focus, keyboard focus kept after a redraw (`data-key`), scroll position kept, contrast, no colour-only signals, `aria-label` on the SVG, `aria-live` for the DoR hint.

## Step 11 — Automated acceptance
Write or reuse `scripts/run_acceptance.js` (design in `IMPLEMENTATION.md` §10). Run `node scripts/run_acceptance.js` from this app folder; the documented reference build has 204 checks (the count grows with features). Then do by eye what it cannot: Safari/Firefox, a real screen reader, and a physical 1920×1080 monitor.

## Step 12 — Refresh data (when needed)
Close the tracker in Excel, then `python3 05_Automation/export_dashboard_snapshots.py` from the project root (needs `openpyxl`; use a virtual environment if no system Python has it: `python3 -m venv <dir> && <dir>/bin/pip install openpyxl`). The exporter uses the local machine date for `refreshedAt`; a different time zone can shift "Today" by a day versus Pacific-dated Jira dates (known, D-log).

## Step 13 — Close out
Update `README.md` status and counts and add a dated line to `DECISIONS.md` (what was built, what was verified, known limits). Update the AF_Snaplogic root rules only if this work changes a project-wide fact or standing rule.

## Pitfalls found while building (do not repeat)
- A tile helper that skipped the subtitle element when `sub` was an empty string crashed the page; create the element whenever `sub !== undefined`.
- Use `.then(init, onError)`, not `.then(init).catch(...)`, or render errors look like "can't load file".
- Redrawing a tile loses keyboard focus and scroll: use `AF.rebuild` with `data-key`.
- CSS order: base rules before the media block, or the dashboard grid is overridden.
- Chart: never use a fixed minimum height; derive `H` from the container and use tighter margins below 260px; drop the axis title below 560px width; do not draw "Today" when the snapshot date is outside the sprint.
- Status rows: pair text needs spaces around `/`; status grid columns `92px minmax(20px,1fr) 80px` avoid clipping.
- Heat-grid headers need `overflow-wrap: break-word` or long tester names overflow.
- Stale favicon requests show up as a console error: inline `data:,` favicon; use a fresh Chrome profile for each test run.
- Schema and fixture drift: when the exporter gains fields (`cycleTime`, `sprint.carriedOver`), update `schema/snapshot.schema.json` and `fixtures/sample_snapshot.json` in the same pass.
- A test expectation that hard-codes the fixture size breaks when the fixture grows: compute it.
