# PORTFOLIO_REFRESH.md

How to refresh the portfolio data files (`portfolio/*.json`) from Jira.

**Important:** There is no Jira API token. All queries must run through the Atlassian MCP connector (read-only). Save large Jira results to scratch files outside AF_Snaplogic and AF_Dashboard, then run `scripts/build_portfolio.py` to rebuild the JSON.

## Data files

| File | Content |
|---|---|
| `portfolio/projects.json` | Manifest: allowed project keys, labels, current sprint ids, file paths |
| `portfolio/AC.json` | Agent Creator snapshot |
| `portfolio/PLATENG.json` | Platform Engineering snapshot |
| `portfolio/PLAT.json` | Plat Core (PLAT project, board 150) snapshot |

## Queries and JQL by metric

All queries use cloudId `34671ece-4d1c-4f7c-b59a-8f1f6aee498f`.

### Current sprint ids (update when a new sprint starts)

| Team | Board | Current sprint id |
|---|---|---|
| AC | 1236 | 12135 |
| PLATENG | 188 | 12230 |
| PLAT | 150 | 12189 |

### Step 1 – Current sprint issues (run once per refresh for all teams together)

```jql
sprint in (<current_sprint_ids>) ORDER BY key
```
Fields: `project, issuetype, status, customfield_10010, customfield_10008, resolutiondate, statuscategorychangedate, created, assignee, customfield_11106, fixVersions, parent`

Save each 100-issue page to a numbered scratch file (e.g. `/tmp/portfolio_refresh/sprint_p1.json`).

### Step 2 – Last 3 closed sprint issues (only for velocity / burndown; add the 3 closed sprint ids per team)

```jql
sprint in (10956, 12099, 12118,  12120, 12133, 12177,  10253, 10855, 12102,  12121, 12131, 12179) ORDER BY key
```
Same fields as Step 1. Save to scratch files.

### Step 3 – Backlog counts (6 queries per team, 24 total)

For each team and current sprint id:
```jql
project = <KEY> AND statusCategory != Done AND issuetype != Epic AND issuetype not in subTaskIssueTypes() AND (sprint is EMPTY OR sprint not in (<current_sprint_id>))
project = <KEY> ... AND created <= -90d
project = <KEY> ... AND created <= -180d
project = <KEY> ... AND created <= -365d
project = <KEY> ... AND "Story Points" is EMPTY
project = <KEY> ... AND parent is EMPTY
```
Use `searchResultMode = count`. Save counts to `/tmp/portfolio_refresh/counts.json`.

Optionally add `AND updated <= -365d` for "not updated in 1 year".

### Step 4 – Stuck buckets (2 queries total, all teams in one)

```jql
sprint in (<current_sprint_ids>) AND statusCategory = "In Progress" AND NOT status CHANGED AFTER -7d
sprint in (<current_sprint_ids>) AND statusCategory = "In Progress" AND NOT status CHANGED AFTER -14d
```
Group results by project key. Save to counts.

### Step 5 – Bugs created in last 14 days (4 count queries)

```jql
project = <KEY> AND issuetype in (Bug, Sub-Bug) AND created >= -14d
```

## Rebuild script

After saving all raw results to `/tmp/portfolio_refresh/`, run:

```bash
cd ~/Documents/Code_Projects/AF_Dashboard
python3 scripts/build_portfolio.py --scratch /tmp/portfolio_refresh
```

The script reads the scratch files and writes `portfolio/*.json`. It does not call Jira. It validates output against `schema/portfolio-team.schema.json`.

## Approximate marks

Every metric in the JSON that is approximated carries `"approx": true` and a `"method"` string. The UI shows `≈` with a tooltip.

- Velocity completion: `statusCategoryChangedDate` used as Done date; scope is the end-of-sprint list.
- Burndown: final points; added dates from `created` (lower bound); removals not tracked.
- Carry-over: tickets in two consecutive sprints not Done at close; ±1–4 vs. the other direction.
- Added mid-sprint (`createdAfterStart`): lower bound — tickets created after `startDate`; `sprint CHANGED` JQL returns HTTP 400 in this instance.

## Connector call budget

About 32–38 calls per refresh:
- 6 pages for current + recent closed sprint issues (shared across teams)
- 4 backlog counts × 6 queries = 24
- 2 stuck-bucket queries
- 4 bug-intake counts

## Notes on PLAT

`project = PLAT` covers all of Platform, not just the Plat Core team (board 150). The backlog numbers are for the whole project. When a board filter becomes available, re-query with `project = PLAT AND cf[XXXX] = "Plat Core"` or equivalent.

## Current-sprint burndown (added 2026-11-01, N-005)

One search per team (3 calls), same fields: `sprint = <current sprint id>`, fields `status`, `customfield_10010`, `customfield_10008`, `statuscategorychangedate`, `created`, `maxResults 100`. Save the three results as `cur_AC.json`, `cur_PLATENG.json` and `cur_PLAT.json` in a scratch folder, then run:

```bash
python3 scripts/build_portfolio.py --scratch <DIR> --current-burndown-only
```

It adds `burndownCurrent` to the existing team files (final points, Done date from `statuscategorychangedate`, series from the sprint start to today's Pacific date). APIM was removed from the portfolio on 2026-11-01.

## Flow metrics (AC only, changelog-based, added 2026-11-03, N-008)

One `getJiraIssue` call per unique AC ticket in the four tracked sprints (10956/12099/12118/12135; currently 60 tickets). Save all raw responses to scratch files and run a processing script (not yet integrated into `build_portfolio.py` — see `04_Data_and_Archive/data/ac_changelog_facts_2026-11-03.json` for the private per-ticket cache).

### AC status stages

| Stage | Statuses |
|---|---|
| intake | Open, To Do, Defined, To Be Refined, Refined, In Triage, Reopened |
| development | In Progress |
| review | In Code Review, Ready for Branch Testing, Branch Testing In Progress, Branch Testing Complete |
| testing | Ready for Testing, Testing in Progress |
| docs | Doc Review, Ready to Publish |
| done | Resolved, Closed, Rejected |

### What the flow block contains

- `scopeChange` per sprint: starting scope (tickets and points); added after start split into `addedAfterStart_createdNew_*` and `addedAfterStart_movedIn_*`; `removedNotDone_*` split into `removedRolledToLaterSprint_*` (moved to a later sprint) and `removedDropped_*`. Ticket counts are exact; points count only pointed tickets (`*_pointsMissing` gives the unpointed tickets, which contribute 0).
- `cycleTime` per sprint: median and 85th-percentile days from first In-Progress-or-later status transition to Done (status-change events only — not statuscategorychangedate), over tickets Done within the sprint close window.
- `carryoverAge_inSprint`: how many tickets are in their 1st, 2nd, or 3rd+ sprint (counting ALL boards seen in the ticket's full Sprint-field history, not only the 4 tracked AC sprints).
- `carryoverAge_atClose`: same split, for tickets not Done at the close of each closed sprint that also appear in the next sprint.
- `currentStatusAging` (current sprint only): count of open tickets by days-in-current-status bucket (0–2, 3–6, 7–13, 14+), broken down by stage.

**Blip rule (af-jira-changelog-scan Pattern 3):** if a ticket is removed from and re-added to the same sprint within 24 hours (a bulk-edit artefact), the blip is ignored and the earlier add event is used.

**Starting scope definition:** tickets in the sprint at the end of the sprint's start date (Pacific), reconstructed from Sprint-field events. A ticket whose Sprint field has no event for the sprint (created with the sprint already set) is treated as a member from its creation date: starting scope if created on or before the start date, otherwise created new. Tickets that left before the start are not counted. Check: starting scope + created new + moved in equals the tickets that were in the sprint at any time after the start.

**`removedNotDone`** counts tickets that left the sprint after its start without being in a Done-category status (Resolved, Closed, Rejected) at that moment. Those moved to a later sprint at the same time are reported separately as `removedRolledToLaterSprint` (planned carry-over, not abandoned work); the rest are `removedDropped`.

**Budget:** ~60 changelog reads per refresh (one per unique ticket). Run incremental by re-reading only tickets whose `updated` date is after the last scan.
