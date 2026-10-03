# 07_Dashboard — App Foundation team dashboard

Team-only, local dashboard for the App Foundation Agile Pilot (Jira project `APP`). It shows the current sprint and the refinement backlog from two JSON snapshots.

**Internal tool.** It shows real names. Do not reuse it in executive or external documents without review (see root `AGENTS.md` §4).

## Status

| Part | State |
|---|---|
| Data layer: `sprint.json`, `backlog.json`, schema, fixture, exporter | Done |
| Documentation (this folder's `.md` files) | Done |
| Web pages: `index.html` (sprint), `backlog.html` (backlog), `dashboard.css`, `dashboard.js`, `sprint.js`, `backlog.js` | v2 (BI-style, cross-filtering) built 2026-10-01; checks to run are in `ACCEPTANCE.md`; what was verified is in the `DECISIONS.md` log |

An earlier, separate attempt is archived in `../08__Dashboard_Archive/`. It is not part of this build.

## Pages

v2 is a full-screen, Power BI / Tableau-style dashboard for a **1920 x 1080** browser window (it also works from 1366 x 760 up; below that it falls back to a scrolling layout). Clicking any bar, person or cell filters every tile on the page (cross-filtering). Ctrl, Cmd or Shift + click selects several values; **Reset all** clears everything.

- `index.html` — current sprint: seven KPIs (work items, story points, done %, no tester, avg cycle time, added mid-sprint, carried over), the **burndown chart**, tickets by status, work by assignee, work by tester, the ticket table and an assignee x tester grid. Fix version and Parent selects in the filter bar. The burndown, cycle time, mid-sprint and carried-over figures need `sprint` and the date fields in `sprint.json` (see `DATA_CONTRACT.md` §2a); without them the page shows an explanatory message in those tiles and keeps working.
- `backlog.html` — backlog analysis: KPIs, readiness (DoR), priority, type, days-in-status buckets, a readiness x priority grid, and the ticket table. Search box in the filter bar (type `mis`, `wea` or `rea` to filter by readiness).

## How to run

```bash
cd "<project root>/07_Dashboard"
python3 -m http.server 8000
```

Open `http://localhost:8000/` in a Chromium-based browser (VS Code's primary environment). Opening the HTML files directly with `file://` is not supported, because browsers block `fetch()` of local JSON there. No internet connection is needed once the snapshots exist.

## How to refresh the data

The pages only read `sprint.json` and `backlog.json`. They never read Excel.

1. Update the tracker (`03_Team_Enablement/daily_tracker.xlsx`) and **close it in Excel** (the exporter refuses to run while the lock file `~$daily_tracker.xlsx` exists).
2. From the project root, run:
   ```bash
   python3 05_Automation/export_dashboard_snapshots.py
   ```
3. Reload the page in the browser.

The export is manual, read-only, and keeps only the latest snapshot (no history). Full behavior: `../06_Skills/af-dashboard-snapshot-export.md`.

## How to test

After any change to the pages or the data, run the automated acceptance checks from the project root:

```bash
node 07_Dashboard/scripts/run_acceptance.js
```

It needs Node 22 or newer, python3 and Google Chrome (set `CHROME_PATH` if Chrome is not in the default macOS location). It takes about two minutes, prints PASS or FAIL per check, and exits 0 only if everything passes. It is read-only: it never changes the real data files, the tracker or the app. Details of what it covers: `ACCEPTANCE.md`.

## Folder map

| Path | What it is | Edit by hand? |
|---|---|---|
| `sprint.json`, `backlog.json` | Latest snapshots, generated | No — regenerate with the exporter |
| `schema/snapshot.schema.json` | JSON Schema (shared top level, plus `sprintTicket` / `backlogTicket` definitions) | Only with the exporter and skill, in the same pass |
| `fixtures/sample_snapshot.json` | Small sample incl. edge cases (no tester, unknown status, null points) | Only to add edge cases |
| `index.html`, `backlog.html`, `dashboard.css`, `dashboard.js`, `sprint.js`, `backlog.js` | The app (static files) | Yes, following `SPEC.md` |
| `scripts/run_acceptance.js` | Automated acceptance run (204 checks in headless Chrome); see "How to test" below | Only together with `SPEC.md` / `ACCEPTANCE.md` |
| `SPEC.md` | What to build: pages, metrics, filters, design | Yes |
| `DATA_CONTRACT.md` | Field rules, null/status handling, calculations | Yes |
| `ACCEPTANCE.md` | Definition of done and checks | Yes |
| `DECISIONS.md` | Decisions, interpretations, open questions | Yes |
| `IMPLEMENTATION.md` | How the code is organised: files, `AF` API, page lifecycle, layout and CSS, burndown algorithm and drawing, DOM contract, acceptance-script design | Yes |
| `BUILD_PLAN.md` | Ordered, checkable steps to rebuild the app from the documents, with the pitfalls found | Yes |
| `REBUILD_PROMPT.md` | Paste-ready prompt to hand the rebuild to another AI agent | Yes |
| `AGENTS.md` | Rules for AI coding agents | Yes |

## Where to read next

1. `SPEC.md` — the product.
2. `DATA_CONTRACT.md` — the data.
3. `IMPLEMENTATION.md` — how it is built.
4. `BUILD_PLAN.md` — the steps to build it.
5. `ACCEPTANCE.md` — how to know it is done.

## Recreating the app with another AI

Everything needed is in this folder. Give the other agent `REBUILD_PROMPT.md` (it lists the reading order, the hard constraints and the deliverables), plus read access to the documents, `schema/`, `fixtures/` and a copy of `sprint.json` / `backlog.json`. For an independent rebuild in a clean folder, do not copy the existing `*.html`, `*.js`, `dashboard.css`; use `scripts/run_acceptance.js` as the judge.
