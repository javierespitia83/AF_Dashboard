# AF_Dashboard — App Foundation team dashboard

Team-only dashboard for the App Foundation Agile Pilot (Jira project `APP`). Three static pages show the selected current or closed sprint, the refinement backlog and sprint-window quality intake, from local JSON files.

**Internal tool.** It shows real names. Do not reuse it in executive or external documents without review (see the project `AGENTS.md` §4).

## Paths used in these documents

`$AF_SNAPLOGIC_ROOT` is the AF_Snaplogic project folder that holds the tracker, the exporter and the skills (on the owner's machine, the Google Drive folder `My Drive/AF_Snaplogic`). Tracked documents use this placeholder instead of absolute personal paths. On 2026-10-29 the tracker moved from `03_Team_Enablement/` to `03_Tracker/` (authorized by Carlos); other AF_Snaplogic folders keep the paths below.

| What | Where |
|---|---|
| Tracker workbook (source of truth) | `$AF_SNAPLOGIC_ROOT/03_Tracker/daily_tracker.xlsx` |
| Exporter | `$AF_SNAPLOGIC_ROOT/05_Automation/export_dashboard_snapshots.py` |
| Exporter skill (mapping rules) | `$AF_SNAPLOGIC_ROOT/06_Skills/af-dashboard-snapshot-export.md` |
| Project rules | `$AF_SNAPLOGIC_ROOT/AGENTS.md` |
| Older, separate dashboard attempt (archive, not part of this build) | `$AF_SNAPLOGIC_ROOT/04_Data_and_Archive/Dashboard_Archive_v1/` |

## Hosting

This is the one place the hosting setup is described; other documents refer here.

- The repository, including the generated JSON data, is published to the GitHub repository `javierespitia83/AF_Dashboard`. The site is served through Cloudflare Pages behind Cloudflare Access with Google Workspace single sign-on, as recorded in the `DECISIONS.md` log entry of 2026-10-15. That Cloudflare setup has not been independently verified in these documents.
- **As of 2026-10-29 the GitHub repository itself is public** (verified: an unauthenticated GitHub API request for it returns 200). The JSON snapshots, with real names and ticket details, are therefore publicly readable on GitHub regardless of Cloudflare Access. Making the repository private is recommended; that is the owner's action.
- An automated publish pipeline commits refreshed data to the `snapshots` branch and merges it into `main`. Do not commit by hand on `snapshots` or `main`; use a feature branch.
- The app itself has no authentication, no backend and no build step (SPEC §2).

## Status

| Part | State |
|---|---|
| Data layer: sprint manifest and snapshots, `backlog.json`, `quality-intake.json`, schemas, fixtures, exporter | Done |
| Documentation (this folder's `.md` files) | Done |
| Pages: `index.html` (Current sprint), `backlog.html` (Backlog), `quality-intake.html` (Quality Intake), with `dashboard.css`, `dashboard.js`, `sprint.js`, `backlog.js`, `quality-intake.js` | v2 (BI-style, cross-filtering). What was verified, and when, is in the `DECISIONS.md` log; checks are in `ACCEPTANCE.md` |

## Pages

The sprint and backlog pages are full-screen dashboards for a **1920 x 1080** browser window (they also work from 1366 x 760 up; below that they fall back to a scrolling layout). Clicking any bar, person or cell filters every tile on the page (cross-filtering). Status rows toggle with repeated clicks; other dimensions support Ctrl, Cmd or Shift + click for multiple values. **Reset all** clears everything.

- `index.html` — current and closed sprint review. A Sprint selector loads the active sprint by default, or a closed sprint from the manifest; `?sprint=<id>` opens one directly. The page shows eight KPIs, including **Long-running work · 7+ days** (a ticket count for In Progress / In Review), the **burndown chart**, Tickets by status, Tickets by type (`N W.I | P SP`), a unified Team Contribution table, the ticket detail table and an assignee x tester grid. Fix version and Parent selects sit in the filter bar. `sprints.json` lists the available sprints and each entry points to one snapshot `snapshots/sprint-<id>.json`. If the manifest is missing or invalid the page shows an error naming `sprints.json`; there is no fallback.
- `backlog.html` — backlog analysis: KPIs, readiness (DoR), priority, type, days-in-status buckets, a readiness x priority grid, the ticket table, an Epic multi-select and a search box (type `mis`, `wea` or `wel` to filter by readiness).
- `quality-intake.html` — PSWAT and APP Bugs created in each sprint's tracker-defined intake window, with rates per 10 weekdays and a click-through ticket list. No filters.

## How to run

```bash
cd "$HOME/Documents/Code_Projects/AF_Dashboard"
python3 -m http.server 8000
```

Open `http://localhost:8000/` in a Chromium-based browser. Opening the HTML files directly with `file://` is not supported, because browsers block `fetch()` of local JSON there. The dashboard loads without internet access; opening Jira links requires a connection.

## How to refresh the data

The sprint page reads `sprints.json` and only the selected snapshot it names; the backlog page reads `backlog.json`; Quality Intake reads `quality-intake.json`. The pages never read Excel. Closed-sprint snapshots are frozen at sprint rotation (`DATA_CONTRACT.md`, "Sprint rotation and manifest").

1. Update the tracker (`$AF_SNAPLOGIC_ROOT/03_Tracker/daily_tracker.xlsx`) and **close it in Excel** (the exporter refuses to run while the lock file `~$daily_tracker.xlsx` exists).
2. From `$AF_SNAPLOGIC_ROOT`, run:
   ```bash
   python3 05_Automation/export_dashboard_snapshots.py
   ```
3. Reload the page in the browser.

The export is manual and read-only with respect to the tracker. It writes the active sprint's snapshot (`snapshots/sprint-<id>.json`, the file of its `sprints.json` entry), `backlog.json` and `quality-intake.json`. Full behaviour: the exporter skill listed under "Paths".

## How to test

Run the automated acceptance checks from this folder when verification is requested:

```bash
node scripts/run_acceptance.js          # about two minutes
node --test scripts/unit.test.js        # unit tests only, about a second (the line above runs them too)
```

They need Node 22 or newer, python3 and Google Chrome (set `CHROME_PATH` if Chrome is not in the default macOS location). The acceptance run prints PASS, FAIL or SKIP per check and exits **0** when every check passes, **1** when a check fails and **2** when the harness itself fails; the results and screenshots are kept in the scratch folder unless the run is clean. It is read-only: it serves a staged copy of only the app and data files, and proves by content hash that nothing in this folder changed. It also checks that the tracker workbook is unchanged when it can find it (default `$AF_SNAPLOGIC_ROOT/03_Tracker/daily_tracker.xlsx`, falling back to the former `03_Team_Enablement/` location; set `AF_TRACKER_PATH` to point elsewhere; without a tracker that check is skipped). Details: `ACCEPTANCE.md` and `IMPLEMENTATION.md` §10.

## Folder map

| Path | What it is | Edit by hand? |
|---|---|---|
| `sprints.json`, `snapshots/sprint-<id>.json`, `backlog.json`, `quality-intake.json` | Sprint manifest and generated snapshots | No — generated by the exporter / rotation workflow |
| `schema/sprints.schema.json`, `schema/snapshot.schema.json`, `schema/quality-intake.schema.json` | JSON Schemas (2020-12) for the manifest, the sprint and backlog snapshots, and Quality Intake | Yes, with the exporter, its skill, the fixtures and `DATA_CONTRACT.md` in the same pass |
| `fixtures/sprints.json`, `fixtures/sample_snapshot.json` | Manifest fixture; small sprint sample with edge cases (no tester, unknown status, null points, Dev to Test, days in status, removed ticket) | Yes, to add edge cases |
| `index.html`, `backlog.html`, `quality-intake.html`, `dashboard.css`, `dashboard.js`, `sprint.js`, `backlog.js`, `quality-intake.js` | The app (static files) | Yes, following `SPEC.md` |
| `scripts/run_acceptance.js`, `scripts/lib/*.js` | Automated acceptance checks in headless Chrome | Only together with `SPEC.md` / `DATA_CONTRACT.md` / `ACCEPTANCE.md` |
| `scripts/unit.test.js` | Unit tests (`node --test`) for the pure functions and the schema validator | Yes |
| `SPEC.md` | What to build: pages, metrics, filters, design | Yes |
| `DATA_CONTRACT.md` | Field rules, null/status handling, calculations | Yes |
| `ACCEPTANCE.md` | Definition of done and checks | Yes |
| `DECISIONS.md` | Decisions, interpretations, open questions, log | Yes |
| `IMPLEMENTATION.md` | How the code is organised, plus the build plan (Appendix A) and the rebuild prompt (Appendix B) | Yes |
| `BUILD_PLAN.md`, `REBUILD_PROMPT.md` | Pointers to `IMPLEMENTATION.md` Appendices A and B | No |
| `AGENTS.md` | Rules for AI coding agents | Yes |
| `docs/archive/` | Superseded documents kept for reference (for example the 2026-10-05 workflow audit) | No |

## Where to read next

1. `SPEC.md` — the product.
2. `DATA_CONTRACT.md` — the data. Where it and `SPEC.md` disagree, see the precedence rule at the top of `SPEC.md`.
3. `IMPLEMENTATION.md` — how it is built, and how to rebuild it.
4. `ACCEPTANCE.md` — how to know it is done.
5. `DECISIONS.md` — why.

## Recreating the app with another AI

Everything needed is in this folder: give the other agent `IMPLEMENTATION.md` Appendix B (the paste-ready prompt with the reading order, hard constraints and deliverables), plus read access to the documents, `schema/`, `fixtures/` and copies of the data files. For an independent rebuild in a clean folder, do not copy the existing `*.html`, `*.js` and `dashboard.css`; use `scripts/run_acceptance.js` as the judge.
