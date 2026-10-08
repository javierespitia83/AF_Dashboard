# AGENTS.md — AF_Dashboard

Rules for AI coding agents working in this standalone app folder. Before editing, read the project rules at `/Users/cespitia/Library/CloudStorage/GoogleDrive-cespitia@snaplogic.com/My Drive/AF_Snaplogic/AGENTS.md` and the app documents below. This file adds dashboard-specific rules; project-wide rules take precedence.

## Commands

```bash
# Run the dashboard (from this folder)
python3 -m http.server 8000        # then open http://localhost:8000/

# Refresh the data (from the AF_Snaplogic project root; close daily_tracker.xlsx first)
cd "/Users/cespitia/Library/CloudStorage/GoogleDrive-cespitia@snaplogic.com/My Drive/AF_Snaplogic"
python3 05_Automation/export_dashboard_snapshots.py
```

There is no build step and no `npm`. Verification is described in `ACCEPTANCE.md`. When the user requests implementation verification, run the automated checks (Node 22+, python3, Chrome; about two minutes; exit code 0 means all pass):

```bash
node scripts/run_acceptance.js
```

Keep `scripts/run_acceptance.js` in sync with `SPEC.md`, `DATA_CONTRACT.md` and `ACCEPTANCE.md`. It must stay read-only with respect to the real data files and the tracker.

## Read before coding

1. `SPEC.md` — pages, metrics, filters, design.
2. `DATA_CONTRACT.md` — field rules, null/status handling, calculations.
3. `ACCEPTANCE.md` — definition of done.
4. `DECISIONS.md` — settled choices and open questions. If a question you need is open, ask Carlos; do not guess.
5. `IMPLEMENTATION.md` — code structure, `AF` API, layout and burndown details. `BUILD_PLAN.md` lists the build steps; `REBUILD_PROMPT.md` is the prompt for handing a rebuild to another agent. If you change code structure, class names or `data-*` attributes, update `IMPLEMENTATION.md` and `scripts/run_acceptance.js` in the same pass.

## Stack limits (hard)

- Plain HTML, CSS and JavaScript. No framework, no `npm`, no CDN, no external fonts, no app-initiated remote requests. The app fetches only the two local snapshots; user-clicked Jira links may navigate to Jira.
- No chart library. Draw bars with HTML/CSS (or inline SVG).
- No backend. The app is static files served by `python3 -m http.server`.
- Light mode only.
- Files in this folder: `index.html`, `backlog.html`, and shared `dashboard.css` / `dashboard.js` (or equivalents). Keep the file count small and the code readable by another agent.

## Data rules (hard)

- The app reads `sprints.json` when available, then only the selected sprint snapshot named by that validated local manifest entry; it also reads `backlog.json` on the backlog page. If the manifest is missing or invalid, the sprint page falls back to `sprint.json`. All reads use relative local paths; the app never reads Excel or makes remote requests.
- The app is read-only: it must not write to Excel, Jira, or the JSON snapshots.
- Never hand-edit `sprint.json` or `backlog.json`. They are generated. If the data looks wrong, fix the tracker or the exporter, then re-export.
- Never invent missing values. Show `—` or the documented placeholder instead.
- Preserve ticket keys and names exactly as exported.
- Do not recompute or change the exporter's rules in the UI. Display-layer mappings (for example `Open` shown as `To Do`) live in the UI and are listed in `DATA_CONTRACT.md`.

## Files you must not overwrite without inspecting first

`sprint.json`, `backlog.json`, `sprints.json`, `snapshots/*.json`, `schema/snapshot.schema.json`, `schema/sprints.schema.json`, `fixtures/sample_snapshot.json`, `fixtures/sprints.json`, `/Users/cespitia/Library/CloudStorage/GoogleDrive-cespitia@snaplogic.com/My Drive/AF_Snaplogic/05_Automation/export_dashboard_snapshots.py`, and `/Users/cespitia/Library/CloudStorage/GoogleDrive-cespitia@snaplogic.com/My Drive/AF_Snaplogic/06_Skills/af-dashboard-snapshot-export.md`. Snapshots and the manifest are generated data; do not hand-edit them. If the mapping changes, update the exporter, its skill, the schema, the fixture and `DATA_CONTRACT.md` together.

## Do not touch

- `/Users/cespitia/Library/CloudStorage/GoogleDrive-cespitia@snaplogic.com/My Drive/AF_Snaplogic/08__Dashboard_Archive/` — an older, separate attempt. Read-only reference at most; do not copy its code in without telling Carlos.
- `/Users/cespitia/Library/CloudStorage/GoogleDrive-cespitia@snaplogic.com/My Drive/AF_Snaplogic/03_Team_Enablement/daily_tracker.xlsx` — only the tracker skills edit it.

## Conventions

- English only for UI text, comments, and file names.
- Show real names (team-only tool). Add a visible "Internal — team only" note to each page footer.
- Keep UI wording to the labels fixed in `SPEC.md` (for example "Story points on owned tickets", "Points on tickets they test").
- Prefer small, clearly named functions: load, normalize, aggregate, render. Keep aggregation separate from rendering so the numbers can be checked.
- When you change behavior, update `SPEC.md` / `DATA_CONTRACT.md` and add a line to `DECISIONS.md` in the same pass.

## Definition of done

See `ACCEPTANCE.md`. Do not report a page as done until the checks pass in a browser with the console open.
