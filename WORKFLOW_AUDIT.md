# AI workflow and dashboard review

Review date: 2026-10-05

## Scope

Reviewed the static dashboard implementation and its local operating documents, the 11 Markdown workflows in `AF_Snaplogic/06_Skills/`, and the current JSON snapshot shapes. This was a source review; the application and acceptance script were not run.

## Findings

The skills are generally well structured: each has a trigger, a defined output or write scope, and guardrails. The ownership model is mostly clear. There is no full duplicate workflow; the full-sync skill is intentionally a sequencing wrapper around Jira refresh, backlog refresh, and JSON export.

| Workflow | Primary responsibility | Relationship to other workflows |
|---|---|---|
| `af-daily-tracker-jira` | Refresh Jira-derived `Daily` data and sprint metrics | Separate from standup narrative updates |
| `af-daily-tracker-minutes` | Add standup narrative to `Daily` and `Other topics` | Called by `af-meeting-minutes` for Daily meetings |
| `af-daily-tracker-slack` | Add Slack asks to ticket rows or `Other topics` | Shares some narrative columns, but a distinct source and trigger |
| `af-daily-tracker-retro` | Append retro findings to `Retro Backlog` | Has a narrow secondary scope in `Backlog Prioritized`, which can overlap with the backlog skill |
| `af-backlog-prioritized` | Refresh/refine the Jira backlog bucket | Owns the normal backlog-bucket workflow |
| `af-dashboard-snapshot-export` | Generate the two JSON files from the tracker | Does not refresh the tracker or edit the app |
| `af-tracker-full-sync` | Sequence Jira refresh → backlog refresh → export | Intentional wrapper; should run only for an explicit full refresh request |
| `af-jira-changelog-scan` | Shared changelog algorithms and scan strategy | Correctly centralizes repeated Jira history logic |
| `af-daily-tracker-format` | Shared workbook structure and formatting | Canonical reference, but large enough to dominate context on tracker tasks |
| `af-meeting-minutes` | Create local minutes and a Confluence page | Delegates Daily tracker changes to the minutes skill |
| `af-snaplogic-file-location` | Resolve correct delivery location/account | Shared safety reference |

## Structural overlap and data consistency risks

1. **Backlog ownership needs one clearer rule.** `af-daily-tracker-retro` can also write `Backlog Prioritized` when a retro includes ticket-level readiness review, while `af-backlog-prioritized` owns that tab's normal refresh. Keep the retro skill as the source for retro findings; when the retro includes an actual refinement pass, explicitly preserve that human-reviewed snapshot and avoid also running the Jira bucket refresh unless requested.

2. **The export skill is out of sync with the exporter.** Its active `sprint`-object section describes a `returnedToBacklog` summary field. The current exporter and `sprint.json` instead expose a per-ticket `sprint.removed` array from the `Removed From Sprint` sheet; the dashboard consumes that array for burndown markers. The exporter comments say this array replaced the earlier scalar. Correct the Markdown mirror and its Claude-side counterpart together before relying on either description.

   Proposed replacement rule: “The current `sprint` object exports `carriedOver` as a Sprint Metrics passthrough and `removed` as a per-ticket array from `Removed From Sprint`. `removed` is `null` when that tab is absent and an array (possibly empty) when it exists. The exporter does not currently emit a `returnedToBacklog` summary property. The dashboard uses `sprint.removed` for removal markers; do not claim a summary KPI exists unless the exporter, schema, fixture, data contract, and app are updated together.”

3. **The shared tracker-format document is the main token cost.** The 11 files contain 32,439 words in total; `af-daily-tracker-format.md` is 8,704 words. It is loaded by several tracker workflows, so routine tasks repeatedly bring in details for tabs they do not edit. A compact index plus focused sheet references would reduce repeated context while keeping one authoritative definition per tab.

4. **Operational histories are mixed into workflow instructions.** Some skills include long dated incident histories after the active procedure. Keep the current rule and the reason that changes its behavior in the skill; move the full chronology into a separate history/decision record. Archive superseded content rather than deleting it.

5. **There is no central project skill for front-end dashboard changes.** The app-local `AGENTS.md` provides good engineering constraints, but the central skill set covers export and orchestration only. The app docs now point agents to the correct independent repository and data-pipeline sources.

## Dashboard review

The code has a sensible static-app split: `dashboard.js` owns shared loading, filtering, aggregation and DOM helpers; `sprint.js` and `backlog.js` own page rendering; the HTML files are small shells; snapshots are fetched locally. The implementation uses text nodes and inline SVG, with no package/build layer.

The operating documents still contained pre-move instructions for `07_Dashboard/` and relative links into the old sibling layout. Those paths and commands have been corrected in `AGENTS.md`, `README.md`, `BUILD_PLAN.md`, and `REBUILD_PROMPT.md`. `IMPLEMENTATION.md` also incorrectly said removals were not reflected; it now states that removals are reflected when `sprint.removed` is present.

The current `sprint.json` contains `sprint.removed` and the renderer groups those entries into burndown markers. There is no `returnedToBacklog` property in the current snapshot. No application feature changes were needed for this review.

## Recommended next improvements

1. Correct the export skill's active field contract and synchronize its Claude-side copy.
2. Make the retro/backlog precedence explicit in both skills.
3. Split the tracker-format reference by tab, leaving a short index and loading only the relevant tab contract for a write.
4. Move lengthy incident timelines out of routine skill context while preserving them in an archive/history document.
5. Add a compact front-end skill only if dashboard coding will recur; for now, the corrected app-local `AGENTS.md` and this rebuild prompt provide the app workflow without adding another overlapping project skill.

## Token estimate limits

The measured figures above are word counts, not model-token counts. Actual tokenization depends on the model. The strongest savings opportunity is reducing the 8,704-word shared workbook reference loaded by unrelated tracker tasks; reducing prose in one-off skills is a smaller gain. The changelog skill's compact-output guidance is already well targeted and should be retained.
