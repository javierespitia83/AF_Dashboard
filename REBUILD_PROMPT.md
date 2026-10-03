# REBUILD_PROMPT.md — prompt to hand to another AI agent

Copy everything inside the block below into a new session of the other agent (Codex, Claude Code, Gemini CLI, etc.) opened in the project root `AF_Snaplogic/`. Before pasting, make sure that agent can read the whole `07_Dashboard/` folder, `05_Automation/export_dashboard_snapshots.py` and `06_Skills/af-dashboard-snapshot-export.md`.

To rebuild in a **clean folder** (so the existing app is not overwritten), copy only these inputs into it and tell the agent to build there: the documents (`README.md`, `SPEC.md`, `DATA_CONTRACT.md`, `IMPLEMENTATION.md`, `BUILD_PLAN.md`, `ACCEPTANCE.md`, `DECISIONS.md`, `AGENTS.md`), `schema/snapshot.schema.json`, `fixtures/sample_snapshot.json`, and a copy of `sprint.json` and `backlog.json`. Do **not** copy `index.html`, `backlog.html`, `*.js`, `dashboard.css` or `scripts/` if you want an independent rebuild; copy `scripts/run_acceptance.js` only if you want to use it as the independent judge.

```text
You are a senior front-end engineer. Build (or rebuild) the "App Foundation team dashboard":
a team-only, local, dependency-free, read-only web dashboard for a Jira project, made of two
pages (current sprint, backlog) that read two JSON snapshot files.

Read these files first, in this order, and treat them as the source of truth. Do not start
coding until you have read all of them:
1. ../AGENTS.md (project root rules) and 07_Dashboard/AGENTS.md
2. 07_Dashboard/README.md
3. 07_Dashboard/SPEC.md            (what to build: pages, tiles, cross-filtering, burndown, design)
4. 07_Dashboard/DATA_CONTRACT.md   (field meanings, null rules, calculations)
5. 07_Dashboard/IMPLEMENTATION.md  (code structure, API, layout, burndown algorithm, DOM contract)
6. 07_Dashboard/BUILD_PLAN.md      (ordered steps with a check at the end of each; pitfalls)
7. 07_Dashboard/ACCEPTANCE.md      (definition of done)
8. 07_Dashboard/DECISIONS.md       (why things are the way they are; if an open question blocks
                                    you, ask the user, do not guess)

Hard constraints:
- Plain HTML, CSS and vanilla JavaScript. No framework, no npm, no CDN, no web fonts, no chart
  library, no backend, no network request except fetch of sprint.json and backlog.json.
- Served with `python3 -m http.server` from the dashboard folder. file:// is not supported.
- No innerHTML, eval or document.write: build DOM with a helper that only creates text nodes.
- Light mode only. Target viewport 1920x1080 with no page scroll; works down to 1366x760;
  below that it falls back to a scrolling layout.
- Read-only: never write to Excel, Jira or the JSON files. Never hand-edit sprint.json or
  backlog.json (they are generated). Never invent missing values: show "—" or the documented
  placeholder. If a field the feature needs is missing from the JSON, STOP and tell the user
  exactly which field to request from the exporter instead of faking it.
- All text, comments and file names in English.
- Update SPEC.md / DATA_CONTRACT.md / ACCEPTANCE.md / DECISIONS.md BEFORE changing behaviour,
  and add a dated line to the DECISIONS.md log when you finish.
- Do not touch ../08__Dashboard_Archive/ or ../03_Team_Enablement/daily_tracker.xlsx.
- Never permanently delete files; move them to ../04_Data_and_Archive/ and tell the user.

Deliverables: index.html, backlog.html, dashboard.css, dashboard.js, sprint.js, backlog.js,
and scripts/run_acceptance.js (or reuse the existing one) so that
`node 07_Dashboard/scripts/run_acceptance.js` exits 0.

Work step by step following BUILD_PLAN.md. After each step run its check and report the result
before moving on. Verify in a real browser (headless Chrome is fine) with the console open;
compare every number on screen with an independent calculation from the JSON, after every
filter interaction, at 1920x1080 and the other sizes listed in ACCEPTANCE.md. Report outcomes
faithfully: if a check fails, say so with the output.

When you finish, reply with: what you built, what you verified (with the pass/fail totals), what
you could not verify (for example Safari, Firefox, a physical monitor), any field you needed but
the data did not have, and every decision you made that is not already in DECISIONS.md.
```

## Notes for the person handing this over

- The reference build (this folder) passes `node 07_Dashboard/scripts/run_acceptance.js` with `TOTAL 204 PASS 204 FAIL 0`. A rebuild should reach the same number of passing checks if it keeps the DOM class names and `data-*` attributes listed in `IMPLEMENTATION.md`; if it renames them, the script must be updated together.
- The data side (tracker → JSON) is a separate workflow: `05_Automation/export_dashboard_snapshots.py` and `06_Skills/af-dashboard-snapshot-export.md`. A rebuild of the web app does not require re-creating it.
- The Jira address (`https://mysnaplogic.atlassian.net`) is a single constant (`JIRA_BASE` in `dashboard.js`); change it there only.
- Open follow-ups that are *not* part of the current spec (do not build unless asked): an "Open in Jira" button for the current selection, a points percentage for carried-over work (needs exporter support), `removedDate` for exact scope changes, history/trends.
