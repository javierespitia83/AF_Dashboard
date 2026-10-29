# AGENTS.md — AF_Dashboard

Rules for AI coding agents working in this standalone app folder. Before editing, read the project rules at `$AF_SNAPLOGIC_ROOT/AGENTS.md` and the app documents below. This file adds dashboard-specific rules; project-wide rules take precedence.

`$AF_SNAPLOGIC_ROOT` is the AF_Snaplogic project folder (on the owner's machine, the Google Drive folder `My Drive/AF_Snaplogic`); `README.md` "Paths" lists the files inside it that this app depends on. Never write absolute personal paths or e-mail addresses into tracked files. Hosting (GitHub, Cloudflare) is described once, in `README.md` "Hosting".

## Commands

```bash
# Run the dashboard (from this folder)
python3 -m http.server 8000        # then open http://localhost:8000/

# Refresh the data (from $AF_SNAPLOGIC_ROOT; close daily_tracker.xlsx first)
cd "$AF_SNAPLOGIC_ROOT"
python3 05_Automation/export_dashboard_snapshots.py
```

There is no build step and no `npm`. Verification is described in `ACCEPTANCE.md`. When the user requests implementation verification, run the automated checks (Node 22+, python3, Chrome; about two minutes; exit code 0 means all pass, 1 a check failed, 2 the harness itself failed):

```bash
node scripts/run_acceptance.js     # includes the unit tests
node --test scripts/unit.test.js   # unit tests only
```

Keep `scripts/run_acceptance.js` (and `scripts/lib/`) in sync with `SPEC.md`, `DATA_CONTRACT.md` and `ACCEPTANCE.md`. It must stay read-only with respect to the real data files and the tracker; it proves this by hashing every file in this folder before and after the run.

**Run the acceptance harness whenever the app changes (rule of 2026-10-20).** After any change to an HTML page, `sprint.js`, `backlog.js`, `quality-intake.js`, `dashboard.js`, `dashboard.css`, the schemas or the fixtures, run `node scripts/run_acceptance.js` in the same pass and report PASS/FAIL, instead of waiting for the next full sync. The harness derives every expected value (tile counts, carried-over keys, Team Contribution, filters) and every test target (people, epics, matrix cells, the closed sprint) from the live sprint snapshots, `backlog.json`, `sprints.json` and `quality-intake.json`; do not hard-code counts, ticket keys or sprint ids in it. The only fixed values allowed are layout expectations and hand-made test data. UI wording the checks expect lives in one place, `scripts/lib/ui_text.js`. The harness only reads the data files, so it cannot hide a data problem: a data failure is fixed at the source (tracker or exporter), never by editing the expected values.

## Read before coding

1. `SPEC.md` — pages, metrics, filters, design. Its first paragraph says which document wins when SPEC and DATA_CONTRACT disagree.
2. `DATA_CONTRACT.md` — field rules, null/status handling, calculations.
3. `ACCEPTANCE.md` — definition of done.
4. `DECISIONS.md` — settled choices and open questions. If a question you need is open, ask Carlos; do not guess.
5. `IMPLEMENTATION.md` — code structure, `AF` API, layout and burndown details; Appendix A is the build plan and Appendix B the prompt for handing a rebuild to another agent. If you change code structure, class names or `data-*` attributes, update `IMPLEMENTATION.md` and the harness (`scripts/lib/page.js` holds the DOM contract it reads) in the same pass.

## Stack limits (hard)

- Plain HTML, CSS and JavaScript. No framework, no `npm`, no CDN, no external fonts, no app-initiated remote requests. The sprint page fetches `sprints.json` and one selected snapshot, the backlog page `backlog.json`, Quality Intake `quality-intake.json`; user-clicked Jira links may navigate to Jira. Every page carries the same Content-Security-Policy meta (`'self'` only); do not add inline scripts, inline `style` attributes or string event handlers.
- No chart library. Draw bars with HTML/CSS (or inline SVG).
- No backend. The app is static files served by `python3 -m http.server`.
- Light mode only.
- Files in this folder include `index.html`, `backlog.html`, `quality-intake.html`, page scripts, shared `dashboard.css` / `dashboard.js`, and generated JSON data. Keep the file count small and the code readable by another agent. `node --test` (built into Node) is the only test runner; no test dependencies.

## Data rules (hard)

- The sprint page reads `sprints.json`, then only the selected sprint snapshot named by that validated manifest entry (`snapshots/sprint-<id>.json`). If the manifest is missing or invalid it shows an error; there has been no root `sprint.json` and no fallback since 2026-10-26 (D73). The backlog page reads `backlog.json`; Quality Intake reads `quality-intake.json`. All reads use relative local paths; the app never reads Excel or makes remote requests.
- The app is read-only: it must not write to Excel, Jira, or the JSON snapshots.
- Never hand-edit `sprints.json`, `snapshots/*.json`, `backlog.json` or `quality-intake.json`. They are generated. If the data looks wrong, fix the tracker or the exporter, then re-export.
- Never invent missing values. Show `—` or the documented placeholder instead.
- Preserve ticket keys and names exactly as exported.
- Do not recompute or change the exporter's rules in the UI. Display-layer mappings (for example `Open` shown as `To Do`) live in the UI and are listed in `DATA_CONTRACT.md`.

## Files you must not overwrite without inspecting first

`sprints.json`, `snapshots/*.json`, `backlog.json`, `quality-intake.json`, schemas, fixtures, the exporter and its skill (see `README.md` "Paths"). The generated data files must not be hand-edited. If a mapping changes, update the exporter, its skill, the relevant schema, fixtures when applicable, and `DATA_CONTRACT.md` together.

## Do not touch

- `$AF_SNAPLOGIC_ROOT/04_Data_and_Archive/Dashboard_Archive_v1/` — an older, separate attempt. Read-only reference at most; do not copy its code in without telling Carlos.
- `$AF_SNAPLOGIC_ROOT/03_Tracker/daily_tracker.xlsx` — only the tracker skills edit it. (Moved from `03_Team_Enablement/` on 2026-10-29; the harness looks in `03_Tracker/` first, then the old folder, and accepts `AF_TRACKER_PATH`.)
- Git: the publish pipeline owns the `snapshots` branch and merges it into `main`. Work on a feature branch; do not push unless asked.

## Conventions

- English only for UI text, comments, and file names.
- Show real names (team-only tool). Add a visible "Internal — team only" note to each page footer.
- Keep UI wording to the labels fixed in `SPEC.md` (including the combined "Team Contribution" table and `N W.I | P SP` metric format).
- Prefer small, clearly named functions: load, normalize, aggregate, render. Keep aggregation separate from rendering so the numbers can be checked (and unit-tested in Node).
- When you change behavior, update `SPEC.md` / `DATA_CONTRACT.md` and add a line to `DECISIONS.md` in the same pass.

## Definition of done

See `ACCEPTANCE.md`. Do not report a page as done until the checks pass in a browser with the console open.
