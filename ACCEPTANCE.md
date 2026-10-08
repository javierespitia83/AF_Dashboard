# ACCEPTANCE.md (v2, BI-style)

A page is done only when every check below passes in a Chromium-based browser with the developer console open. Rules behind the numbers are in `DATA_CONTRACT.md`; the layout and behavior are in `SPEC.md`.

## 1. Setup

```bash
cd "<path to AF_Dashboard>"
python3 -m http.server 8000
# open http://localhost:8000/ (index.html) and http://localhost:8000/backlog.html
```

Test at a **1920 x 1080** viewport first, then the other sizes in section 4. Test edge cases with copies of the app folder (data files swapped for `fixtures/sample_snapshot.json`, an empty snapshot, a missing file, an invalid file). Never overwrite `sprint.json` or `backlog.json` for a test.

## 2. Expected values

Compute expected values from the JSON, not from this file. Reference numbers from the 2026-10-01 snapshot (orientation only): sprint 68 work items and 173 story points, Done 34 items / 87 points, In Review 16 / 48, In Progress 9 / 29, To Do/Open 9 / 9, 31 without a tester, 3 with null points; backlog 125 tickets and 76 estimated points, DoR Ready 74, Weak 28, Missing 23.

**Automated run:** `node scripts/run_acceptance.js` (from the AF_Dashboard folder) performs most of the checks below in headless Chrome and compares every tile with an independent calculation from the JSON. A passing run (exit code 0) covers loading, numbers, cross-filtering, layouts, keyboard, edge cases, error states and the safety checks. Not covered by it, so check by eye when relevant: Safari or Firefox, real screen-reader use, a physical 1920 x 1080 monitor. Keep the script in sync with this file, `SPEC.md` and `DATA_CONTRACT.md`. A filtered expectation is always: take the tickets matching the filters (OR within a dimension, AND across dimensions), then apply the metric definition.

## 3. Checks

**Loading and safety**
- [ ] Both pages load through `python3 -m http.server`; both JSON files return 200.
- [ ] No errors or warnings in the console on load or during any interaction.
- [ ] Only requests to localhost; works with the network off. No `npm`, CDN, web font, external library, `innerHTML`, `eval` or `document.write` in the source.
- [ ] `sprint.json`, `backlog.json` and `daily_tracker.xlsx` are unchanged after use (file timestamps).
- [ ] The footer shows "Internal — team only"; the top bar converts `exportedAt` to the browser's local date, time and UTC offset, falls back to `refreshedAt` for older snapshots, and shows the tabs Current sprint and Backlog with the active one marked.

**Layout at 1920 x 1080**
- [ ] No page-level scroll (document height does not exceed the viewport, no horizontal overflow) on both pages.
- [ ] The board fills the viewport: tiles reach the right edge with equal gutters; no max-width cap; no large empty areas.
- [ ] Sprint: KPI strip with seven tiles (work items, story points, done, no tester, avg cycle time, added mid-sprint, carried over); main row with four tiles (burndown, status, assignee, tester); lower row with the ticket table and the assignee x tester grid. Backlog: KPI strip with five tiles; main row with five tiles; table below.
- [ ] At dashboard sizes, the sprint main/lower row heights use a 1.1475:1.2025 ratio, transferring 15% of the former main-row height to the lower row; total board height stays within the viewport.
- [ ] Long tile bodies (assignee list, tester list, matrix, detail and backlog tables) scroll inside the tile with a visible scrollbar; headers stay sticky; Total lines stay pinned. The sprint detail table scrolls horizontally when its columns exceed the tile width; Owner, Tester and Status cells wrap at spaces with automatic widths, and Current situation is at least 340 px wide.
- [ ] Layout also works with no page scroll at 1440 x 900 and 1536 x 864.
- [ ] Below 1366 wide or 760 high the page falls back to a scrolling layout: no element extends beyond the viewport outside the tile scroll areas, no page-level horizontal scroll, tiles stack (checked at 1280 x 720, 1024 x 768, 800 x 900 and 480 x 900).

**Numbers with no filter — sprint**
- [ ] KPI tiles: work items, story points, Done percent (Done points ÷ points, whole percent), no-tester count (null, blank, missing or `Unassigned`, excluding exact `Dev to Test`) equal the independent calculation.
- [ ] Status tile: one tile, one clickable bar row per status; each row shows `work items / story points` equal to the calculation; Total row equals the sprint totals; Other row only when the data has an unknown status; `Open` counts inside To Do/Open.
- [ ] Assignee and tester tiles: one row per person group with the right work items and story points (two bars per person, number beside each bar); rows sorted by story points descending then name; Total rows equal the sprint totals; `Unassigned` appears for a null tester and for a null or literal `Unassigned` owner as a single row.
- [ ] Assignee x tester grid: every cell equals the count of tickets with that pair; sum of all cells = work items; rows and columns sorted by total descending, `Unassigned` column last.
- [ ] Detail table: one row per ticket in tracker order, exact keys and names; empty values show `—`, empty tester shows `Unassigned`; status shows the original text; the header shows "n of N".
- [ ] Labels "Story points on owned tickets", "Points on tickets they test" and the overlap note are visible.
- [ ] Selecting each clickable KPI filter adds a removable `KPI: <name>` tag; removing that tag clears only the KPI filter and preserves regular dashboard filters.

**Numbers with no filter — backlog**
- [ ] KPIs: total, estimated points, needing refinement (Weak + Missing), needs splitting, median days equal the calculation.
- [ ] DoR, Priority, Type, Days-in-status tiles show the right counts (bucket boundaries as in `DATA_CONTRACT.md` §6); priority order Highest to Lowest; Readiness x priority grid cells equal the counts and sum to the total.
- [ ] Table: all tickets in sheet order, exact keys; empty points, days, epic, risk, cluster and needs-splitting show `—`; DoR pills use `#C6EFCE`, `#FFEB9C`, `#FFC7CE`.

**Burndown and the new KPIs (sprint)**
- [ ] Avg cycle time equals the mean of `cycleTime` over filtered Done tickets with a value (one decimal at most, `—` when none); it changes with filters; the hint gives the number of tickets.
- [ ] Added mid-sprint equals the count (and points) of filtered tickets with `addedDate` later than `startDate` + 2 days; changing the threshold setting in one place changes the KPI and the markers; current values are shown without an approximation label, with the older-snapshot caveat documented.
- [ ] Carried over shows exactly `sprint.carriedOver` (count, percent, points) and does not change with filters; with `carriedOver: null` it shows "Not calculated yet for this sprint" and never 0; with no `sprint` object it shows "No sprint data in sprint.json". The percent shown is the exported one.
- [ ] Burndown: one point per calendar day from `startDate` to `endDate`; on every day up to today the scope equals the points of filtered tickets added on or before that day, and remaining equals that scope minus Done points with `doneDate` on or before that day (checked against an independent calculation, including a ticket added mid-sprint, a Done ticket dated before the start and a Done ticket with no date); the scope line steps up on the added dates and the remaining line starts at the starting scope, not at the final scope; no remaining value after today; the ideal line goes from the starting scope on day one to 0 on the last day, linear over calendar days; the subtitle uses the scope today.
- [ ] With `sprint.removed`: the scope steps down on each removal date (and up on the entry date of each removed ticket), remaining and ideal follow the independent calculation, the y axis tops out at the largest scope; a red down-triangle with `−N` sits below the axis on each removal date, the date labels are moved below it (no overlap), the legend shows Removed; clicking it opens a panel "Removed <Mon. D, YYYY>" listing exactly those tickets; the Removed marker follows the filters; without `sprint.removed` (or with `[]`) there is no marker, no Removed legend and the footnote is the one in SPEC §6.3.
- [ ] Burndown responds to every filter (assignee, tester, status, fix version, parent): scope and both lines are recomputed for the filtered set; with zero results it shows the empty state.
- [ ] Addition markers appear on every date after the start day that has added tickets, with the right counts: filled amber when the date is after the threshold, hollow when it is within it; the Added mid-sprint KPI counts only the filled ones; the tooltip lists tickets without labeling dates approximate; the older-snapshot caveat is in the footnote; the "Today" marker is on the snapshot date; hover tooltips exist for every day; the chart redraws to fit when the window is resized and has no scroll bars.
- [ ] Clicking a marker opens a panel titled "Added Sep. 28, 2026" (date format `Mon. D, YYYY`) listing exactly the tickets of that marker (key as a Jira link, summary, points, status, assignee) with the right counts; same marker again, × or Escape closes it; another marker replaces it; Enter or Space on a focused marker does the same as a click; `aria-pressed` follows the state; opening or closing it changes no filter, tag, KPI or tile; after a filter change the list matches the filtered set (closes when empty); it survives a window resize; it never covers the page layout (stays inside the burndown tile).
- [ ] Missing `sprint` dates: the burndown tile shows the explanatory message and the page still works; the unit checks run on a copy of the app with hand-made data whose answers are known.

**Cross-filtering — sprint**
- [ ] Clicking an assignee row selects it: the tag "Assignee: <name> ×" appears; KPIs, the status tile, the tester tile, the matrix and the detail table all equal the calculation for that assignee; the assignee tile still lists all assignees, with the selected one highlighted and the rest dimmed.
- [ ] Clicking the same row again clears it; clicking another row replaces the selection.
- [ ] Ctrl, Cmd or Shift + click adds a second value (OR within the dimension); results equal the calculation.
- [ ] Clicking a status row, a tester row, and an assignee row together applies AND across dimensions; results equal the calculation (example: tester Unassigned + status In Review gives the In Review tickets with no tester).
- [ ] Clicking a matrix cell sets both assignee and tester; clicking the same cell again clears both.
- [ ] Fix version and Parent selects filter correctly and show their value; "All" clears; `(none)` selects tickets without a value.
- [ ] Removing a tag with × removes only that value; **Reset all** clears every filter and selects.
- [ ] A selected sprint KPI filter enables **Reset all**; Reset all clears the KPI selection and restores both lower tiles.
- [ ] A filter combination that matches nothing shows the empty-state line in each tile, KPIs of 0, an empty-state message in the table, and does not break.
- [ ] Filtered tiles obey the per-view invariant: with an unselected dimension the tile's totals equal the filtered set's totals.

**Cross-filtering — backlog**
- [ ] Clicking a DoR, Priority, Type or Days-in-status row filters every tile, the KPIs and the table; the clicked tile keeps showing alternatives (own-dimension rule); results equal the calculation.
- [ ] Multi-select, AND across dimensions, matrix-cell click, tags, and Reset all behave as in the sprint checks.
- [ ] Search (in the filter bar): `mis`, `miss`, `missi`, `missing` (any case, surrounding spaces) all give DoR = Missing; `wea`, `weak` give Weak; `wel`, `well`, `well-formed` give Well-Formed; `n/a` gives N/A (Epic); `rea`, `ready` give Ready only if the data has it (older snapshots), otherwise zero results; counts equal the data. Under 3 characters, or `missingx`, runs a normal text search. Text search matches ticket, summary, epic, cluster and risk. The readiness hint and a search tag appear while a DoR prefix is active.
- [ ] Search combines with tile selections by AND; "Showing X of Y tickets" updates; clearing the search restores results.

**Priority and Type icons (backlog)**
- [ ] Every Priority tile row and Priority table cell whose value is Highest, High, Medium, Low or Lowest, and every Type tile row and Type table cell whose value is Story, Bug, Sub-Bug, Epic, Task, Sub-task, Initiative or Doc Task, shows exactly one icon of the right kind before the text; the text is unchanged.
- [ ] Values without an icon (unknown names, `—`) show text only; icons are `aria-hidden`, contain no text, and add no network request or element other than inline SVG.

**Epic filter (backlog)**
- [ ] The filter bar has an Epic button; clicking it opens a panel with one checkbox per distinct epic plus (no epic), sorted by ticket count descending then name, `(no epic)` last, each with its count; counts equal the calculation over the other active filters.
- [ ] Ticking one epic filters every KPI, tile, the matrix and the table to that epic and adds the tag "Epic: <epic>"; ticking a second adds its tickets (OR within Epic): the numbers equal the independent calculation for the union (example: APP-718 and APP-55 together).
- [ ] Epic combines with other filters by AND (for example Epic APP-55 + DoR Weak) and with the search.
- [ ] The panel stays open while ticking; Clear unticks all epics; Reset all and removing a tag untick the matching checkboxes; Escape or a click outside closes it and Escape returns focus to the button; the button shows "Epic (n)" when n epics are ticked and has `aria-expanded`.
- [ ] Checkboxes are real checkboxes, reachable with Tab, with a visible focus outline; opening or closing the panel changes no filter.

**Jira links**
- [ ] Every Ticket cell in both tables is a link whose text is the key and whose `href` is exactly `https://mysnaplogic.atlassian.net/browse/<KEY>`, with `target="_blank"` and `rel` containing `noopener`.
- [ ] In the Parent and Linked work items cells (sprint) and the Epic and Related / cluster cells (backlog), every key is its own link with the right `href`, the cell's text is identical to the data (nothing lost, separators and dashes kept), and cells without a key contain no link.
- [ ] Summary, Current situation and Risk / open question cells contain no links.
- [ ] Clicking a link does not change any filter, tag, KPI or tile.
- [ ] With odd data (HTML in a cell, `javascript:` text, lower-case or incomplete keys) only valid keys become links, no extra elements are created, and every `href` starts with the Jira address.
- [ ] The Jira address appears once in the app source (one constant); loading a page still makes no request except to localhost.
- [ ] Links have a visible focus outline and are reachable with Tab.

**Display of empty values (both pages)**
- [ ] Empty parent, epic, fix version, risk, cluster, linked work items show `—`; empty points and days show `—` and count as 0 in sums; empty tester and owner show `Unassigned`. No `null`, `undefined` or `NaN` appears in any tile or table.

**Edge cases (copies of the app)**
- [ ] With the fixture as `sprint.json`: an unknown status (`Blocked`) appears as **Other**, is counted in totals, can be clicked as a filter, and its original text shows in the table; null testers merge into one `Unassigned` row; a literal owner `Unassigned` is one `Unassigned` row; null points show `—`.
- [ ] Missing file, invalid JSON, empty snapshot, and opening by `file://` each show the clear messages from `SPEC.md` §4.

**Interaction quality**
- [ ] All clickable rows, cells, tags and controls are real buttons, selects or inputs; Tab reaches them; the focus outline is visible; Enter or Space activates; Ctrl, Cmd or Shift + Enter multi-selects; selected state is exposed with `aria-pressed`.
- [ ] Light mode only; text contrast at least AA; names and numbers are always shown (colour is never the only signal).
- [ ] Scroll positions inside a tile are kept when a filter changes.

## 4. After changes

- Re-run the exporter, then run `node scripts/run_acceptance.js` from the `AF_Dashboard` folder and repeat any checks it does not cover.
- If the data mapping changed, update the exporter, its skill, the schema, the fixture and `DATA_CONTRACT.md` together.
- Record any new decision in `DECISIONS.md`.
