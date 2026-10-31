# SPEC.md — App Foundation team dashboard (v2, BI-style)

Data rules are in `DATA_CONTRACT.md`. Done criteria are in `ACCEPTANCE.md`. Decisions and open questions are in `DECISIONS.md`. v2 replaces the v1 "scrolling report" layout with a full-screen, cross-filtering dashboard (DECISIONS D23 to D32).

**Precedence (D80).** When this file and `DATA_CONTRACT.md` disagree, `DATA_CONTRACT.md` wins on what the data means and how numbers are calculated (field rules, null handling, buckets, formulas) and this file wins on presentation and behaviour (pages, layout, labels, wording, interactions). Fix the other document in the same pass and log it in `DECISIONS.md`. `IMPLEMENTATION.md` and `ACCEPTANCE.md` follow both; the code is the reference only where none of them says anything.

## 1. Goal and users

A local, read-only dashboard that turns tracker data into a fast, explorable view for the Scrum Master, the Product Owner and the engineering team. It supports: daily standup preparation, sprint review, workload review, tester-coverage review, backlog refinement, and sprint-window quality intake comparison.

Questions it must answer, mostly by clicking:
- Is the sprint progressing, and how much is done?
- How many work items and story points are in each status?
- How many work items and story points are in each Jira issue type?
- Who owns the work, and who tests it?
- Which tickets have no tester, and what status are they in?
- Which backlog items are ready, weak, or missing for refinement, and how old are they?
- How many PSWAT issues and APP Bugs were created in each sprint intake window?

## 2. Scope

**In v2:** three pages: `index.html` (Current sprint), `backlog.html` (Backlog), and `quality-intake.html` (Quality Intake). The first two keep their existing data and interactions. Quality Intake reads `quality-intake.json` and compares tracker-defined intake windows across sprints.

**Non-goals:** reading Excel in the app; Jira write-back or live Jira calls; history or trend charts other than the current-sprint burndown (§6.3) and the Quality Intake comparison (§8); authentication, hosting or sharing built into the app (hosting is external to the app: the data is published to the GitHub repository `javierespitia83/AF_Dashboard` and served through Cloudflare Pages behind Cloudflare Access; that repository is public as of 2026-10-29 — see `README.md` "Hosting"); a new backlog ranking algorithm; editing data; dark mode; a build step or any dependency; sorting in tables other than the specified sprint Ticket detail columns; saving or sharing filter state.

## 3. Runtime and screen target

- Served with `python3 -m http.server`; opened in a modern Chromium-based browser. `file://` is not supported. Works offline once the local data files exist. No CDN, web fonts, or remote app requests; the sprint page fetches the manifest and one selected sprint snapshot, the backlog page fetches its snapshot, and Quality Intake fetches `quality-intake.json`.
- **Primary target: 1920 x 1080 browser viewport.** The dashboard uses the whole viewport: no page-level scroll, no wasted side margins, no max-width cap.
- **The dashboard layout applies at a viewport width of at least 1366 and height of at least 760.** It must also work cleanly at 1440 x 900 and 1536 x 864.
- **Below that (narrower or shorter), fall back to a normal scrolling layout:** tiles stack in one or two columns, each tile has a fixed height with its own inner scroll, no page-level horizontal scroll.

## 4. App shell (all pages)

Top to bottom:
1. **Top bar** (fixed height on desktop, wraps on narrow screens): app name, tabs **Current sprint**, **Backlog**, and **Quality Intake** (the active tab is marked), the sprint page's accessible **Sprint** selector when a valid manifest is available, and a highlighted **SNAPSHOT · NOT LIVE** badge beside "Data as of <local date> · <local HH:MM> UTC±HH:MM". Convert `exportedAt` to the viewing browser's local timezone; older snapshots show `refreshedAt` only. Beside the snapshot status, show a prominent **Jira dashboard · LIVE** link to `https://mysnaplogic.atlassian.net/jira/dashboards/18635`, opening in a new tab. It is user-clicked only; the app makes no external request on page load. The badge and timestamp clarify that the app can be stale; Jira is the place to go for current Jira data.
2. **Filter bar** (fixed height) on Current sprint and Backlog: active-filter tags, page-specific controls (see §6 and §7), and a **Reset all** button. Quality Intake has no filters. With no filter active it says: "No filters. Click a bar, a person, or a cell to filter."
3. **Board**: the tiles, filling all remaining height.
4. **Footer** (slim, fixed height): "Internal — team only. Do not reuse in executive or external documents without review."

States: while loading show "Loading…". A missing or invalid JSON file shows a clear message naming the file ("Can’t load <file>") and how to regenerate it (`python3 05_Automation/export_dashboard_snapshots.py`), and tells the user to use the local server if the page was opened as a file. When a file loads but is wrong in a known way, the message says what is wrong instead of "missing or not valid JSON" (an invalid manifest; a snapshot whose sprint id or dates differ from its manifest entry). If the data loads but drawing the page fails, the page shows "Can’t draw this page" (a dashboard bug, details in the console), never a load error. An empty snapshot says so instead of drawing empty tiles. Placeholders: `—` for missing values; `Unassigned` for missing owner or tester.

Every page has one `h1` (visually hidden on the sprint and backlog pages, visible on Quality Intake) and the same Content-Security-Policy meta tag: everything from `'self'`, images also from `data:` (the inline favicon), no inline scripts or styles (D79).

## 5. Cross-filter model (Current sprint and Backlog)

- **Dimensions.** Sprint: Status, Type, Assignee, Tester (the Assignee x tester column group, which includes `Self-tested`; D84), plus the search box (§6.4). Assignee and Tester are set from the Assignee x tester cells. Backlog: DoR, Priority, Type, Age (days in current status), plus the search box (§7.3). There are no dropdown filters on either page (R001-19, D87); the Sprint selector stays. A selection per dimension is a set of values.
- **Combining.** Several values in one dimension combine with OR; different dimensions combine with AND; the text search (both pages; §6.4, §7.3) is AND with everything.
- **Click behavior** on a clickable element (a bar row, a person row, a matrix cell):
  - On status rows, every plain click toggles that status independently, so repeated clicks can select or clear several statuses without modifier keys. On other clickable elements, a plain click **selects only that value** in that dimension (replacing any other value in it).
  - Clicking a selected status clears only that status; clicking the only selected value in another dimension **clears** that dimension.
  - **Ctrl, Cmd or Shift + click** adds or removes values in other dimensions for multi-select. Status rows toggle with or without a modifier key.
  - A matrix cell sets both of its dimensions (row value and column value) the same way; a cell that is already the exact current selection clears both.
- **What each tile shows.**
  - **KPI tiles and the ticket table** reflect all active filters.
  - **A dimension tile** is computed with all filters **except its own dimension**, so the alternatives stay visible. Selected values are highlighted; unselected values are dimmed but still clickable. A matrix tile excludes both of its dimensions. Needs attention today is not a dimension tile: it uses the same filtered set as the KPIs.
- **Visible state.** Every active selection appears as a tag in the filter bar (for example "Tester: Self-tested ×" or "KPI: No tester & not self-tested ×"). Clicking × on a tag removes that value. **Reset all** clears every filter and the search.
- **Zero results.** If the filters match no ticket, tiles show a short empty-state line ("No work items match these filters. Remove a tag or use Reset all.") instead of blank charts; the KPI tiles show 0.
- Filters are not persisted: a reload starts clear.

## 6. Page 1 — Current sprint (`index.html`)

Dimensions: Status, Type, Assignee, Tester (set by clicking tiles and grid cells). The filter bar holds the **search box** (§6.4), the active-filter tags and Reset all. The Fix version and Parent dropdowns were removed on 2026-10-30 (R001-19, D87): the search finds a fix version (`4.46`) or a parent (key or title).

**Sprint selection:** when `sprints.json` is valid, show a keyboard-accessible native select labelled **Sprint** in the top bar. Default to the manifest entry whose id is `current`. Each option shows the sprint name and `(active)` or `(closed)`; do not repeat dates in the option label. A `?sprint=<id>` URL parameter selects that manifest entry; an unknown id shows a clear error while leaving the selector available. Changing the select updates the query parameter with `history.replaceState` and loads the selected snapshot without a full-page reload. Snapshot loads are cached in memory; changing sprints resets all filters. Never construct a path from the query parameter: resolve the id through the manifest; each entry's file must be `snapshots/sprint-<id>.json` (D74; unknown manifest keys are ignored). A missing or invalid manifest shows a clear error naming `sprints.json`, with no selector and no fallback (there is no root `sprint.json`, D73). A snapshot whose `sprint.id`, `startDate` or `endDate` differ from its manifest entry is refused with a message saying so. Because of these checks every rendered sprint has a `sprint` object with valid dates. If the user picks another sprint while one is loading, only the last choice is shown.

For a `state: "closed"` sprint, mark the view with a high-contrast **HISTORICAL VIEW · CLOSED SPRINT** banner, the snapshot's own data-as-of date/time, and the manifest note when present. Use a subtly grayer page background to distinguish the view without changing status colors. The snapshot controls all KPI/chart/table values. Treat the burndown's final day as the sprint end; hide the live Today marker and label the summary as at sprint end. Preserve ordinary null handling, including the uncalculated carried-over hint and `—` for null ticket fields.

### 6.1 Board layout at 1920 x 1080

```
KPI strip  [ Work items ][ Story points ][ Done ][ Added mid-sprint ][ Carried over ][ No tester & not self-tested ][ Long-running work · 7+ days ][ Avg cycle time ]
Main row   [ Burndown ][ Tickets by status ][ Tickets by type ][ Needs attention today (Ticket | Status | Days | Reason) ]
Lower row  [ Ticket detail table ][ Assignee x tester ]
```
Rows share the board height: the KPI strip is compact (about 90 px); the main row takes about 48.8% of the remaining height and the lower row about 51.2%. Main row column widths keep Burndown and Needs attention today generous while reserving at least 250 px each for Tickets by status and Tickets by type. In the lower row the heat grid has about 28% of the width (at least 440 px) and the ticket table the rest. (Revised 2026-10-01: the burndown joined the main row and the heat grid moved to the lower row, D41.) Every tile has a title, a one-line subtitle, a body that scrolls internally when it overflows (sticky header, visible scrollbar), and where useful a pinned Total line.

### 6.2 Tiles

- **KPI: Work items** — number of work items in the filtered set; hint "of N" when a filter is active, else "tickets in the sprint".
- **KPI: Story points** — sum of story points (missing = 0); hint "of P" when filtered.
- **KPI: Done** — Done story points as a percentage of the filtered story points (shown `—` when the filtered points are 0); hint "X of Y points done".
- **KPI: No tester & not self-tested** (renamed from No tester & Not Dev to Test, R001-18, D85) — count of filtered work items with `tester` null, blank, missing, or `Unassigned`, excluding work items whose `classifications` split on `"; "` includes the exact value `Dev to Test` or `QA to Test`; hint "no tester, excluding Dev to Test and QA to Test" plus the filtered total.
- **KPI: Avg cycle time** — average `cycleTime` (days) over the filtered tickets that are Done and have a `cycleTime`; shown with at most one decimal; hint "days, over N Done tickets"; `—` when there are none. Responds to filters.
- **KPI: Added mid-sprint** — number of filtered tickets whose `addedDate` is later than `sprint.startDate` + the mid-sprint threshold (1 day, D72; an easy-to-change setting, D38), compared as calendar days (a value that is not a `YYYY-MM-DD` date never counts); hint "P points, added after day 1". Uses the exported `Added to Sprint` date; older snapshots may not distinguish dates from before the approximation marker was retired (DATA_CONTRACT §2a). Responds to filters.
- **KPI: Long-running work · 7+ days** — count of tickets whose `status` is `In Progress` or `In Review` and whose `statusAging` is a number `>= AF.config.timeInStatusThresholdDays` (7 by default). The value is a ticket count, not a number of days. The hint identifies the included statuses: "In Progress / In Review tickets". When no ticket in those statuses has a `statusAging`, show `—` and "Days in status not available yet". This is a neutral follow-up list, not a risk rating or a claim that work has stopped. Clicking it filters the ticket detail and Assignee x tester tiles like the other KPI filters; the detail table has a sortable **Days in status** column (`*` suffix when `statusAgingApprox`).
- **KPI filters:** clicking Added mid-sprint, Long-running work · 7+ days or No tester & not self-tested filters the ticket detail and Assignee x tester tiles in the lower section, while preserving the regular dashboard filters; click again to clear. One KPI filter is active at a time. Clicking Carried over does the same when `sprint.carriedOver.ticketKeys` is present. Without ticket keys, the KPI is not clickable and is not exposed as a button. Each active KPI filter appears as a removable `KPI: <name>` tag; removing it clears only the KPI filter. **Reset all** clears both KPI and regular filters.
- **KPI: Carried over** — what carried over from the previous sprint, read straight from `sprint.carriedOver` (never recalculated). Value = ticket count; hint = "X% of tickets, N points" (a part that is null is left out). If `carriedOver` is `null` the tile shows `—` and "Not calculated yet for this sprint". Never shows 0 for "not calculated". (A snapshot without a `sprint` object cannot be opened, see §6, so the former "No sprint data" state no longer exists; D77.)
- **Burndown** — see §6.3.
- **Tickets by status** (dimension Status) — one tile, one clickable horizontal bar row per bucket (To Do/Open, In Progress, In Review, Done, and Other only when present in the data). Each row: status name with its colour dot, a bar (length = the bucket's share of the tile's work items), and the pair **work items | story points** with units shown (e.g. `16 W.I | 48 SP`). A header line reads "Work items | Story points". A Total row is pinned below.
- **Tickets by type** (dimension Type) — one tile, one clickable horizontal bar row per exact Jira issue type present (including unknown values; null or missing Type groups under `—`). Each row shows the type, a bar sized by its share of the tile's work items, and `N W.I | P SP`; a pinned Total row shows the tile totals. Rows sort by W.I descending, then type name. Like other dimension tiles, it excludes its own Type filter while respecting other filters.
- **Needs attention today** (R001-02, 2026-10-30; replaces Team Contribution, D83) — a table of the filtered tickets that are **not Done** and meet at least one rule, sorted by days in status descending (no value last), then key. Columns: Ticket (Jira link), Status (original text with colour dot), Days (`statusAging`, `*` when `statusAgingApprox`) and Reason. Reasons, shown as small labels in this order: "Long-running · 7+ days" (the Long-running work rule), "Carried over" (key in `sprint.carriedOver.ticketKeys`; not shown when the snapshot has no keys), "Blocked by <key>" (one per `linkedWorkItems` entry `<key> (is blocked by)`, left out when that ticket is Done in this snapshot; a key outside the sprint is assumed open) and "Blocker recorded" (`blocker` not blank). The panel shows **no person names and no `blocker` text** (the site is public; R001-02 condition 1). Subtitle "N open tickets: long-running, carried over or blocked". A pinned line under it reads "Missing: A no tester (excluding Dev to Test) · B no fix version · C no story points" over the filtered set (A is the No tester KPI rule, C counts tickets whose `points` is not a number). It follows the regular filters, not the KPI filters. When no ticket qualifies the body reads "Nothing needs attention under these filters."
- **Assignee x tester** (dimensions Assignee and Tester) — a heat grid: rows are assignees, columns are tester groups, each cell shows the number of work items, shaded by count. The tester group of a ticket (R001-17, R001-18, 2026-10-30) is **`Self-tested`** when it has the exact `Dev to Test` or `QA to Test` classification and no tester, or when its tester is the same person as its assignee; **`Unassigned`** when it has no tester and is not self-tested (so the column total equals the No tester & not self-tested KPI); otherwise the tester's name (a Dev to Test or QA to Test ticket with a different tester stays under that tester). Rows and columns are sorted by total work items descending, with `Self-tested` and then `Unassigned` last. The `Self-tested` header tooltip reads "Tested by the assignee. No separate tester needed (Dev to Test, QA to Test, or the assignee is also the tester)."; the `Unassigned` one reads "No tester and not self-tested (not Dev to Test or QA to Test)". Clicking a cell filters to that assignee and tester group (the Tester dimension uses the same groups, so its tag can read "Tester: Self-tested"). Names stay in this grid; it is used to see whether a tester's work must be covered (for example during PTO).
- **Ticket detail** — all filtered tickets in tracker order until the user sorts them. Columns: Ticket, Summary, Owner, Tester, Self-tested, Status (original text, with colour dot), Days in status (`statusAging`, with `*` when `statusAgingApprox`), Story points, Parent, Fix version, Linked work items, Last sync update. Ticket, Owner, Tester, Status, Days in status, Story points, Parent and Fix version have small arrow controls in their headers (D69, D76); clicking a different header sorts ascending and clicking it again reverses direction. Text values use natural alphabetical/numeric ordering; Story points and Days in status sort numerically; missing values sort last ascending and first descending, so descending can bring unassigned Fix version values to the top. Sorting applies to visible filtered rows and is retained as filters change; a sprint switch restores tracker order. Self-tested (R001-18, D85; formerly `Dev to Test` with Yes / `—`) shows why no separate tester is needed: `Dev to Test`, `QA to Test` (exact classifications, in that precedence) or `Same person` (tester = assignee), else `—` (another person tests, or no tester); header tooltip "Tested by the assignee. No separate tester needed (Dev to Test, QA to Test, or the assignee is also the tester).". Owner, Tester and Status widths are automatic; their text wraps at spaces to fit the available table width. Last sync update is the note captured in the snapshot and may not include changes made afterward; it is at least 350 px wide so its short status and next step wrap across a few lines. Header shows "n of N work items". Sticky header, inner scroll with visible scrollbar, long text wraps.

### 6.3 Burndown tile

A line chart of story points remaining, day by day, for the current sprint (the one place a trend chart is in scope, D37; scope steps over time since D45). Drawn as inline SVG, sized to the tile (redrawn when the window is resized), no library.

- **Needs** `sprint.startDate` and `sprint.endDate` (always present, because the manifest check guarantees them; the former "Sprint dates are not in the sprint snapshot" message was removed, D77) and, per Done ticket, `doneDate`.
- **X axis:** every calendar day from `startDate` to `endDate`, inclusive (weekends included); date labels as `M/D`, thinned to fit.
- **Y axis:** story points, from 0 up to the largest scope on any sprint day, rounded to a nice number. This preserves headroom if removals make the final scope smaller than an earlier scope.
- **Removal markers (D52, only when `sprint.removed` is in the data):** a **red downward-pointing triangle** hanging **below** the x axis, with the number of removed tickets (e.g. `−2`) under it, on every date on which filtered tickets left the sprint. Clicking it (or Enter or Space) opens the same kind of panel as the added markers, titled "Removed Sep. 24, 2026", with the removed tickets (Jira link, summary, points, status at removal, assignee). When any removal marker exists, the date labels of the x axis move down so they never touch the triangles. The legend gains "Removed" only then. At narrow chart widths with removal markers, the legend uses two rows: Remaining, Ideal and Scope first; Added after day N, Earlier and Removed second. The plot starts below both rows so no label is clipped or overlaps the chart.
- **Scope (steps up as tickets are added, D45):** on each day, the story points of the filtered tickets whose `addedDate` is on or before that day (missing points = 0). A ticket with no `addedDate`, or one dated on or before the start, is in scope from the first day; a date after the end counts on the last day. When `sprint.removed` is present, scope also **steps down** on the day each removed ticket left (DATA_CONTRACT §2a, §6). The scope is drawn as a thin light step line up to today. Re-estimates are never modelled (the data has no estimate history). Tickets removed from the sprint are modelled only when `sprint.removed` exists; otherwise they are not reflected.
- **Remaining line (actual):** for each day up to **today**, that day's scope minus the story points of Done tickets whose `doneDate` is on or before that day. A Done ticket with a `doneDate` before the start counts on the first day; a Done ticket cannot be subtracted before it entered the scope (its done day is the later of `doneDate` and `addedDate`). "Today" is the snapshot date (`refreshedAt`), not the browser clock; the line stops there. A Done ticket without a `doneDate` is not on the line; a footnote says how many. Because scope grows, the line can go up on a day when more points were added than finished.
- **Ideal line:** a straight dashed line from the **starting scope** (the scope on the first day, before anything was added) to 0 on the last day, linear over calendar days. Work added later therefore shows as the remaining line sitting above the ideal, as in Jira's own burndown.
- **Today marker:** a thin vertical line labelled "Today" (when today is inside the sprint).
- **Addition markers (D46):** a small marker on the x axis, with the number of tickets, at **every date after the start day** on which filtered tickets were added (`addedDate` later than `startDate`; tickets dated on the start day are the starting scope and get no marker). Two styles: a **filled amber triangle** for dates after the mid-sprint threshold (§6.2; these are the tickets the Added mid-sprint KPI counts) and a **hollow triangle** for earlier dates (within the first days, inside the threshold). Hover shows the tickets and points. Older snapshots may not distinguish dates from before the approximation marker was retired (DATA_CONTRACT §2a). The scope step line rises on the same days.
- **Marker click (added tickets list):** clicking a marker (or pressing Enter or Space on it; markers are focusable buttons with `aria-pressed` and a visible teal focus ring) opens a small, non-modal panel (a labelled region; focus stays on the marker) inside the burndown tile titled "Added Sep. 28, 2026" (the date written out as `Mon. D, YYYY`, in English; older snapshot caveat is explained in the footnote and the marker tooltip) with the ticket and point counts and one row per ticket: Ticket (Jira link, §9a), Summary, Points, Status, Assignee. Clicking the same marker again, the × button or Escape closes it; clicking another marker replaces it. The panel is information only: it does not change any filter, KPI or tile. It follows the filters (if the open date has no tickets after a filter change it closes) and stays open when the chart is redrawn on resize. The panel scrolls inside itself when the list is long (D44).
- **Hover:** every day has a tooltip: date, points remaining (or the ideal for future days), points done that day and how many tickets.
- **Subtitle:** "X of Y points remaining today, ideal Z" where Y is the scope today and Z the ideal for today (for the filtered set).
- **Footnote (always visible):** without `sprint.removed`: "Scope grows on each ticket's added date. Tickets removed from the sprint and re-estimates are not reflected. Older snapshots may not identify legacy estimated dates." With `sprint.removed`: "Scope grows on each ticket's added date and shrinks on the date a ticket left the sprint. Re-estimates are not reflected. Older snapshots may not identify legacy estimated dates."
- **Filters:** responds to every filter like the KPIs (the chart is for the filtered set; its ideal line is for that set's scope).
- **Legend:** Remaining, Ideal, Scope, (Removed, only when there are removal markers), "Added after day N" (filled marker) and "Earlier" (hollow marker).
- **Colours:** remaining line navy `#1f3a5f` with small dots; ideal line gray, dashed; scope line light gray, thin, stepped; today marker teal; addition markers amber. Text and numbers carry the information, not colour alone.
- **Accessibility:** the SVG has an `aria-label` summarising the chart and the same figures appear in the subtitle. The per-day figures of the tooltips (date, scope, remaining, ideal, done that day) are also in a visually hidden table after the chart, for screen readers.

### 6.4 Search (R001-19)
One search box at the start of the filter bar, placeholder "Search by key, title, status, Self-tested, fix version, person...". It matches **only**: (1) the ticket key, partial allowed; (2) summary words; (3) the status (`in review`, `in progress`, `done`, `open`); (4) the Self-tested column value (`dev to test`, `qa to test`, `same person`, and `self-tested`, which matches any of the three); (5) the parent / epic, by key or title; (6) the fix version (`4.46`, `4.46.1.0`); (7) the assignee name; (8) the tester name. Nothing else (not Last sync update, linked work items, type or points). Whole phrases: `in review`, `in progress` (status), `dev to test`, `qa to test`, `same person`, `self-tested` (Self-tested column). The Ticket detail counter "n of N work items" shows the result count.

**Behaviour (both pages, R001-19, D86).** Not case or accent sensitive. The query is split into words; the known phrases of the page are matched first as **whole phrases against their own field** (so `dev to test` returns only Dev to Test tickets, not every ticket containing the words dev, to and test); every other word must match at least one allowed field, and several words are **AND**. A word matches a key anywhere in it (partial keys: `2970`, `APP-29`), the start of a word of a text field (`pipe` finds Pipeline, `4.46` finds 4.46.1.0), or a Jira key inside the parent or epic. When the query names a ticket key exactly (`APP-2970` or `2970`) that ticket comes first in the table. The search is AND with every tile, chart and grid filter, appears as a tag "Search: “…”", updates as the user types, and has a clear button (×); Reset all and the tag × also clear it. The text is kept in the page URL as `q` (`?q=in%20review`), and a link with `?q=` restores it; on the sprint page `sprint` keeps working alongside it (`?sprint=12176&q=in%20review`).

## 7. Page 2 — Backlog (`backlog.html`)

Dimensions: DoR, Priority, Type, Age. The filter bar holds the **search box** (see §7.3) next to the tags. The Epic dropdown was removed on 2026-10-30 (R001-19, D87): the search finds an epic by key or title (§7.4).

### 7.1 Board layout at 1920 x 1080

```
KPI strip  [ Backlog tickets ][ Estimated points ][ Needing refinement ][ Needs splitting ][ Median days ]
Main row   [ Readiness (DoR) ][ Priority ][ Type ][ Days in status ][ Readiness x priority ]
Detail     [ Backlog table (full width) ]
```

### 7.2 Tiles

- **KPIs** — all reflect the filtered set: Backlog tickets; Estimated story points (missing = 0); Needing refinement (DoR Weak or Missing); Needs splitting (count with a Needs Splitting value); Median days in current status (over non-null values).
- **Readiness (DoR)** (dimension DoR) — clickable bar rows in the order Well-Formed, Ready, Weak, Missing, N/A (Epic) (then any unrecognised value; a value with no tickets in the data is not listed). `Ready` is the older name of Well-Formed and is kept so older snapshots still work. Bars are coloured green for Well-Formed and Ready, yellow for Weak, red for Missing and gray for N/A (Epic) and anything else; count at the right (D51).
- **Priority** (dimension Priority) — clickable bar rows in the order Highest, High, Medium, Low, Lowest, then any other value, then `—`.
- **Type** (dimension Type) — clickable bar rows by count descending (values from the data).
- **Days in status** (dimension Age) — clickable bar rows for the buckets `0–30`, `31–90`, `91–180`, `181–365`, `366+`, and `No value`.
- **Readiness x priority** (dimensions DoR and Priority) — heat grid, rows = priorities, columns = DoR values, cell = ticket count; click filters both.
- **Backlog table** — filtered tickets in sheet order (the refinement ranking; no re-ranking). Columns: Ticket, Summary, DoR status (coloured pill), Priority, Type, Story points, Days in status, Epic, Needs splitting, Risk / open question, Related / cluster. Header shows "Showing X of Y tickets". Sticky header, inner scroll, wrapped text.

### 7.3 Search (R001-19; replaces the DoR prefix search of D22 / D51)
One search box in the filter bar, placeholder "Search by key, title, status, epic...". It matches **only**: (1) the ticket key, partial allowed (`2970`, `APP-29`); (2) summary words; (3) the DoR status, as the whole phrases `well-formed`, `weak`, `missing`; (4) the epic, by key or title. Nothing else (not type, priority, risk, the split flag, cluster or the comment draft). Whole phrases: `well-formed`, `weak`, `missing`, each matched only against the DoR field (2026-10-31, D88): `missing` returns only the DoR Missing tickets, not a ticket whose title merely contains "missing"; `weak` returns only the DoR Weak tickets. "Showing X of Y tickets" shows the result count. The former readiness hint ("Searching by readiness: …") is gone.

**Behaviour (both pages, R001-19, D86).** Not case or accent sensitive. The query is split into words; the known phrases of the page are matched first as **whole phrases against their own field** (so `dev to test` returns only Dev to Test tickets, not every ticket containing the words dev, to and test); every other word must match at least one allowed field, and several words are **AND**. A word matches a key anywhere in it (partial keys: `2970`, `APP-29`), the start of a word of a text field (`pipe` finds Pipeline, `4.46` finds 4.46.1.0), or a Jira key inside the parent or epic. When the query names a ticket key exactly (`APP-2970` or `2970`) that ticket comes first in the table. The search is AND with every tile, chart and grid filter, appears as a tag "Search: “…”", updates as the user types, and has a clear button (×); Reset all and the tag × also clear it. The text is kept in the page URL as `q` (`?q=in%20review`), and a link with `?q=` restores it; on the sprint page `sprint` keeps working alongside it (`?sprint=12176&q=in%20review`).

### 7.4 Epic (no dropdown since 2026-10-30)
The Epic multi-select of D48 was removed (R001-19, D87; the code stays in git history). An epic is found with the search box by its key (`APP-55`, or part of it) or a word of its title; several epics at once are no longer offered (the search ANDs its words).

## 8. Page 3 — Quality Intake (`quality-intake.html`)

Quality Intake reads only `quality-intake.json`; it does not make Jira calls or read Excel. The page has no cross-filters. It lists sprints chronologically using the intake windows recorded in Sprint Metrics. The active window is marked **ACTIVE WINDOW · PARTIAL** when `partial` is true.

For each sprint, show the intake window start/end, weekday count, two source rows, raw tickets created, and rate per 10 weekdays. The rate is calculated from the exported count and weekday denominator (count × 10 ÷ weekdays), shown to one decimal. A zero count remains `0`; null or missing metrics show `n/a` without failing the page. Intake window dates come directly from the workbook and are inclusive dates in America/Los_Angeles; the window is not inferred from the sprint manifest dates.

The sources are fixed: **PSWAT** counts every PSWAT project issue created in the window, regardless of issue type; **APP Bugs** counts APP project issues created in the window whose Jira issue type is exactly `Bug`. These are intake signals, not defect or defect escape rates. PSWAT includes support requests and other non-defect issues.

Each numeric raw count is a button. Activating it expands a ticket list scoped to that sprint and source, and activating it again collapses the list. Zero is clickable and opens the empty list message; `n/a` is not clickable. On desktop the expanded detail fills the remaining card height down to the bottom; when the ticket list overflows, it has a visible scrollbar and a message telling the reader to scroll within it to see all tickets. The list shows Ticket, Summary, Type, Status and Created. A valid key links to its exported Jira URL in a new tab; no remote request occurs until the user follows that link. Ticket keys and summaries are deliberately published in this file because privacy is not a concern for this initial internal tool decision.

The exporter validates each populated source count against the number of matching rows in `Quality Intake Detail`; a mismatch stops export before files are written. Blank source counts and other missing intake values are exported as null and display as `n/a`. An empty `sprints` array shows an empty-state message.

## 9. Interactions summary

| Interaction | Behavior |
|---|---|
| Click a bar row / person row / matrix cell | Select only that value (or pair); click again to clear (§5). |
| Ctrl, Cmd or Shift + click | Add or remove the value (multi-select). |
| Click × on a filter tag | Remove that value. |
| Search box (both pages) | Free-text search over the page's allowed fields (§6.4, §7.3), AND with the rest; × clears it; kept in the URL as `q`. |
| Reset all | Clear all selections and the search. |
| Hover | Native tooltips on bars and cells show status, work items and story points (or the count). |
| Keyboard | Clickable rows and cells are real `button` elements, in tab order, with a visible focus outline. Enter or Space activates; Ctrl, Cmd or Shift + Enter/Space multi-selects. |

## 9a. Jira links

- **Where:** the **Ticket** column of both tables is a link. In the sprint table the **Parent** and **Linked work items** cells, and in the backlog table the **Epic** and **Related / cluster** cells, show every Jira key inside them as its own link; the rest of the cell text stays plain. Free-text columns (Summary, Last sync update, Risk / open question) are never linked, to avoid false matches such as `UTF-8`.
- **What a key is:** a whole word shaped like `ABC-123` (capital letter, then capital letters or digits, a hyphen, digits). Any project key works (`APP-189`, `DOC-3360`, `DI-989`).
- **Link target:** `https://mysnaplogic.atlassian.net/browse/<KEY>`. The Jira address is defined once, as a constant in `dashboard.js`.
- **Behavior:** opens in a new tab (`target="_blank"`, `rel="noopener noreferrer"`), tooltip "Open <KEY> in Jira", visible focus outline, never changes a filter. Following a link needs internet and a Jira login in that browser; loading the dashboard still makes no external request.
- **Not in v2:** an "Open in Jira" button for the current selection; links on tile rows or matrix cells (those filter).

## 10. Design

- **Light mode only.** Dense, calm, high-contrast; the numbers are the largest element on a tile. System font stack, tabular numerals, sentence-case labels.
- **Status colours** (bars, dots): To Do/Open = sky blue, In Progress = blue, In Review = green, Done = gray, Other = hatched amber.
- **DoR colours:** Well-Formed and Ready `#C6EFCE`, Weak `#FFEB9C`, Missing `#FFC7CE` (tracker fills), N/A (Epic) and any other value neutral gray; bar versions are slightly stronger.
- **Heat grids:** a single-hue teal ramp (project teal `#2a9d8f`) from 12% to at most 80% strength, count shown in the cell in ink (`--ink`) on every shade, so the text keeps at least 4.5:1 (about 6:1 on the darkest cell); the text never flips to white (D78).
- **Other colours:** existing project palette only (navy `#1f3a5f`, teal `#2a9d8f`, greys, red for warnings).
- **Selection state:** selected rows and cells get a teal outline and a light teal fill; when any selection exists in a tile the unselected items are dimmed (not hidden). Dimming never lowers the opacity of text: dimmed rows use muted text and faded bars, dimmed heat cells a lighter tint with muted text, all at least 4.5:1 (D78).
- **Tiles:** white surface, hairline border, small radius, no shadows; equal gutters; tile bodies scroll inside with a visible scrollbar and sticky headers.
- **Accessibility:** colour is never the only signal (names and numbers are always shown); contrast at least AA (4.5:1) for text, including dimmed items and the "Jira dashboard · LIVE" button; no text smaller than 10px; focus outlines; selection is exposed with `aria-pressed`. A tile body (or the Quality Intake ticket list) is a keyboard-focusable, labelled region (`tabindex="0"`, `role="region"`, `aria-label`) only while it actually scrolls, so tiles that fit add no tab stops.

## 10a. Chart colours

See §6.3 for the burndown. No other chart types exist; bars and heat grids are HTML.

## 10b. Priority and Type icons (D49; sprint Type added 2026-10-20)
Priority and Type values carry a small icon in the style of Jira's own, so they are recognisable at a glance. Icons appear **before the text** (the text is never removed) in the Priority and Type tile rows and Priority and Type columns of the backlog table; the sprint Tickets by type tile uses the same Type icons.
- **Priority:** Highest = red up arrow; High = orange "="; Medium = amber up chevron; Low = blue down chevron; Lowest = blue double down chevron. (Drawn to match the icons in the team's Jira.)
- **Type:** Story = green rounded square with a white bookmark; Bug = red square with a white bug; Epic = purple square with a white lightning bolt; Task = blue square with a white check; Sub-task = blue square with two linked boxes; Sub-Bug = red square with two linked boxes (the Sub-task glyph in the Bug colour); Initiative and Doc Task have icons too, in case they appear in the data.
- A value with no icon (any other name, or `—`) shows text only. Icons are inline SVG drawn by the app (no image files, no network), decorative (`aria-hidden`), carry no text of their own, and never replace the text, so colour is never the only signal. They are not Atlassian's original artwork; they are simple look-alikes.
- Priority icons remain backlog-only; the sprint Type tile reuses the Backlog Type icons.

## 11. Code structure (guidance)

The detailed structure (files, the `AF` API, page lifecycle, layout CSS, burndown model and drawing, DOM contract) is in `IMPLEMENTATION.md`; the build order is its Appendix A.

`index.html`, `backlog.html`, `quality-intake.html`, `dashboard.css`, `dashboard.js` (shared helpers, aggregation, filter store, tile builders), `sprint.js`, `backlog.js`, `quality-intake.js`. Keep the filter store and aggregation functions pure (no DOM) so numbers can be checked in the console and in Node (`scripts/unit.test.js`). No `innerHTML`; build DOM from text nodes.
