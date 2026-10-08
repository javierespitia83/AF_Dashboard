# SPEC.md — App Foundation team dashboard (v2, BI-style)

Data rules are in `DATA_CONTRACT.md`. Done criteria are in `ACCEPTANCE.md`. Decisions and open questions are in `DECISIONS.md`. v2 replaces the v1 "scrolling report" layout with a full-screen, cross-filtering dashboard (DECISIONS D23 to D32).

## 1. Goal and users

A local, read-only dashboard that turns the tracker's two sheets into a fast, explorable view for the Scrum Master, the Product Owner and the engineering team. It supports: daily standup preparation, sprint review, workload review, tester-coverage review, and backlog refinement.

Questions it must answer, mostly by clicking:
- Is the sprint progressing, and how much is done?
- How many work items and story points are in each status?
- Who owns the work, and who tests it?
- Which tickets have no tester, and what status are they in?
- Which backlog items are ready, weak, or missing for refinement, and how old are they?

## 2. Scope

**In v2:** two pages (`index.html` sprint, `backlog.html` backlog) reading `sprint.json` and `backlog.json`, full-screen tiles, page-wide cross-filtering.

**Non-goals:** reading Excel; Jira write-back or live Jira calls; history or trend charts other than the current-sprint burndown (§6.3); authentication; hosting or sharing; a new backlog ranking algorithm; editing data; dark mode; a build step or any dependency; column sorting; saving or sharing filter state.

## 3. Runtime and screen target

- Served with `python3 -m http.server`; opened in a modern Chromium-based browser. `file://` is not supported. Works offline once the snapshots exist. No CDN, web fonts, or network calls except the two local JSON files.
- **Primary target: 1920 x 1080 browser viewport.** The dashboard uses the whole viewport: no page-level scroll, no wasted side margins, no max-width cap.
- **The dashboard layout applies at a viewport width of at least 1366 and height of at least 760.** It must also work cleanly at 1440 x 900 and 1536 x 864.
- **Below that (narrower or shorter), fall back to a normal scrolling layout:** tiles stack in one or two columns, each tile has a fixed height with its own inner scroll, no page-level horizontal scroll.

## 4. App shell (both pages)

Top to bottom:
1. **Top bar** (fixed height): app name, tabs **Current sprint** and **Backlog** (the active tab is marked), and "Data as of <local date> · <local HH:MM> UTC±HH:MM" on the right when `exportedAt` is present. Convert the timestamp to the viewing browser's local timezone. Older snapshots show `refreshedAt` only.
2. **Filter bar** (fixed height): the active-filter tags, page-specific controls (see §6 and §7), and a **Reset all** button. With no filter active it says: "No filters. Click a bar, a person, or a cell to filter."
3. **Board**: the tiles, filling all remaining height.
4. **Footer** (slim, fixed height): "Internal — team only. Do not reuse in executive or external documents without review."

States: while loading show "Loading…". A missing or invalid JSON file shows a clear message naming the file and how to regenerate it (`python3 05_Automation/export_dashboard_snapshots.py`), and tells the user to use the local server if the page was opened as a file. An empty snapshot says so instead of drawing empty tiles. Placeholders: `—` for missing values; `Unassigned` for missing owner or tester.

## 5. Cross-filter model (applies to both pages)

- **Dimensions.** Sprint: Status, Assignee, Tester, Fix version, Parent. Backlog: DoR, Priority, Type, Age (days in current status), Epic (§7.4), plus a text search. A selection per dimension is a set of values.
- **Combining.** Several values in one dimension combine with OR; different dimensions combine with AND; the text search (backlog) is AND with everything.
- **Click behavior** on a clickable element (a bar row, a person row, a matrix cell):
  - Plain click **selects only that value** in that dimension (replacing any other value in it).
  - Clicking the only selected value **clears** that dimension.
  - **Ctrl, Cmd or Shift + click** adds or removes the value, for multi-select.
  - A matrix cell sets both of its dimensions (row value and column value) the same way; a cell that is already the exact current selection clears both.
- **What each tile shows.**
  - **KPI tiles and the ticket table** reflect all active filters.
  - **A dimension tile** (for example Work by assignee) is computed with all filters **except its own dimension**, so the alternatives stay visible. Selected rows are highlighted; unselected rows are dimmed but still clickable. A matrix tile excludes both of its dimensions.
- **Visible state.** Every active selection appears as a tag in the filter bar (for example "Tester: Poornima Srikantesh ×" or "KPI: No tester ×"). Clicking × on a tag removes that value. **Reset all** clears every filter and the search.
- **Zero results.** If the filters match no ticket, tiles show a short empty-state line ("No work items match these filters. Remove a tag or use Reset all.") instead of blank charts; the KPI tiles show 0.
- Filters are not persisted: a reload starts clear.

## 6. Page 1 — Current sprint (`index.html`)

Dimensions: Status, Assignee, Tester, Fix version, Parent. The filter bar also holds two selects, **Fix version** and **Parent** (options from the data, plus `(none)`). Choosing an option sets that dimension to one value; "All" clears it.

### 6.1 Board layout at 1920 x 1080

```
KPI strip  [ Work items ][ Story points ][ Done ][ Added mid-sprint ][ Carried over ][ No tester ][ Avg cycle time ]
Main row   [ Burndown ][ Tickets by status ][ Work by assignee ][ Work by tester ]
Lower row  [ Ticket detail table ][ Assignee x tester ]
```
Rows share the board height: the KPI strip is compact (about 90 px); the main row takes about 48.8% of the remaining height and the lower row about 51.2%. This transfers 15% of the main row's previous height to the lower row while keeping total height unchanged. Main row column widths are roughly 1.8 : 1 : 1.25 : 1.25 (the status tile never narrower than 250 px). In the lower row the heat grid has about 28% of the width (at least 440 px) and the ticket table the rest. (Revised 2026-10-01: the burndown joined the main row and the heat grid moved to the lower row, D41.) Every tile has a title, a one-line subtitle, a body that scrolls internally when it overflows (sticky header, visible scrollbar), and where useful a pinned Total line.

### 6.2 Tiles

- **KPI: Work items** — number of work items in the filtered set; hint "of N" when a filter is active, else "tickets in the sprint".
- **KPI: Story points** — sum of story points (missing = 0); hint "of P" when filtered.
- **KPI: Done** — Done story points as a percentage of the filtered story points (shown `—` when the filtered points are 0); hint "X of Y points done".
- **KPI: No tester** — count of filtered work items with `tester` null, blank, missing, or `Unassigned`, excluding work items whose `classifications` split on `"; "` includes the exact value `Dev to Test`; hint "no tester, excluding Dev to Test" plus the filtered total.
- **KPI: Avg cycle time** — average `cycleTime` (days) over the filtered tickets that are Done and have a `cycleTime`; shown with at most one decimal; hint "days, over N Done tickets"; `—` when there are none. Responds to filters.
- **KPI: Added mid-sprint** — number of filtered tickets whose `addedDate` is later than `sprint.startDate` + the mid-sprint threshold (2 days by default, an easy-to-change setting, D38); hint "P points, added after day 2". Uses the exported `Added to Sprint` date; older snapshots may not distinguish dates from before the approximation marker was retired (DATA_CONTRACT §2a). Responds to filters. `—` when the sprint has no start date.
- **KPI filters:** clicking Added mid-sprint or No tester filters the ticket detail and Assignee x tester tiles in the lower section, while preserving the regular dashboard filters; click again to clear. Clicking Carried over does the same when `sprint.carriedOver.ticketKeys` is present. Without ticket keys, the KPI is not clickable. Each active KPI filter appears as a removable `KPI: <name>` tag. **Reset all** clears both KPI and regular filters.
- **KPI: Carried over** — what carried over from the previous sprint, read straight from `sprint.carriedOver` (never recalculated). Value = ticket count; hint = "X% of tickets, N points" (a part that is null is left out). If `carriedOver` is `null` the tile shows `—` and "Not calculated yet for this sprint"; if `sprint.json` has no `sprint` object it shows `—` and "No sprint data in sprint.json". Never shows 0 for "not calculated".
- **Burndown** — see §6.3.
- **Tickets by status** (dimension Status) — one tile, one clickable horizontal bar row per bucket (To Do/Open, In Progress, In Review, Done, and Other only when present in the data). Each row: status name with its colour dot, a bar (length = the bucket's share of the tile's work items), and the pair **work items / story points** (e.g. `16 / 48`). A header line reads "Work items / Story points". A Total row is pinned below.
- **Work by assignee** (dimension Assignee) — subtitle "Story points on owned tickets". One clickable row per person, sorted by story points descending then name, with two stacked bars (work items, story points) coloured by status bucket and the number beside each bar (two bars per person, D13). Bars use a common scale per column within the tile. Pinned Total row.
- **Work by tester** (dimension Tester) — subtitle "Points on tickets they test"; same row design; `Unassigned` is a normal row. One-line note: "Assignee and tester views overlap by design. The sprint total counts each ticket once."
- **Assignee x tester** (dimensions Assignee and Tester) — a heat grid: rows are assignees, columns are testers (including `Unassigned`), each cell shows the number of work items, shaded by count. Rows and columns are sorted by total work items descending (`Unassigned` column last). Clicking a cell filters to that assignee and tester pair. The `Unassigned` tester column is where coverage gaps show.
- **Ticket detail** — all filtered tickets in tracker order. Columns: Ticket, Summary, Owner, Tester, Status (original text, with colour dot), Story points, Parent, Fix version, Linked work items, Current situation. Owner, Tester and Status widths are automatic; their text wraps at spaces to fit the available table width. Current situation is at least 350 px wide so its short status and next step wrap across a few lines. Header shows "n of N work items". Sticky header, inner scroll with visible scrollbar, long text wraps.

### 6.3 Burndown tile

A line chart of story points remaining, day by day, for the current sprint (the one place a trend chart is in scope, D37; scope steps over time since D45). Drawn as inline SVG, sized to the tile (redrawn when the window is resized), no library.

- **Needs** `sprint.startDate` and `sprint.endDate` and, per Done ticket, `doneDate`. Without the sprint dates the tile shows "Sprint dates are not in sprint.json. Run the Jira sync and the export." and nothing else.
- **X axis:** every calendar day from `startDate` to `endDate`, inclusive (weekends included); date labels as `M/D`, thinned to fit.
- **Y axis:** story points, from 0 up to the largest scope on any sprint day, rounded to a nice number. This preserves headroom if removals make the final scope smaller than an earlier scope.
- **Removal markers (D52, only when `sprint.removed` is in the data):** a **red downward-pointing triangle** hanging **below** the x axis, with the number of removed tickets (e.g. `−2`) under it, on every date on which filtered tickets left the sprint. Clicking it (or Enter or Space) opens the same kind of panel as the added markers, titled "Removed Sep. 24, 2026", with the removed tickets (Jira link, summary, points, status at removal, assignee). When any removal marker exists, the date labels of the x axis move down so they never touch the triangles. The legend gains "Removed" only then.
- **Scope (steps up as tickets are added, D45):** on each day, the story points of the filtered tickets whose `addedDate` is on or before that day (missing points = 0). A ticket with no `addedDate`, or one dated on or before the start, is in scope from the first day; a date after the end counts on the last day. When `sprint.removed` is present, scope also **steps down** on the day each removed ticket left (DATA_CONTRACT §2a, §6). The scope is drawn as a thin light step line up to today. Re-estimates are never modelled (the data has no estimate history). Tickets removed from the sprint are modelled only when `sprint.removed` exists; otherwise they are not reflected.
- **Remaining line (actual):** for each day up to **today**, that day's scope minus the story points of Done tickets whose `doneDate` is on or before that day. A Done ticket with a `doneDate` before the start counts on the first day; a Done ticket cannot be subtracted before it entered the scope (its done day is the later of `doneDate` and `addedDate`). "Today" is the snapshot date (`refreshedAt`), not the browser clock; the line stops there. A Done ticket without a `doneDate` is not on the line; a footnote says how many. Because scope grows, the line can go up on a day when more points were added than finished.
- **Ideal line:** a straight dashed line from the **starting scope** (the scope on the first day, before anything was added) to 0 on the last day, linear over calendar days. Work added later therefore shows as the remaining line sitting above the ideal, as in Jira's own burndown.
- **Today marker:** a thin vertical line labelled "Today" (when today is inside the sprint).
- **Addition markers (D46):** a small marker on the x axis, with the number of tickets, at **every date after the start day** on which filtered tickets were added (`addedDate` later than `startDate`; tickets dated on the start day are the starting scope and get no marker). Two styles: a **filled amber triangle** for dates after the mid-sprint threshold (§6.2; these are the tickets the Added mid-sprint KPI counts) and a **hollow triangle** for earlier dates (within the first days, inside the threshold). Hover shows the tickets and points. Older snapshots may not distinguish dates from before the approximation marker was retired (DATA_CONTRACT §2a). The scope step line rises on the same days.
- **Marker click (added tickets list):** clicking a marker (or pressing Enter or Space on it; markers are focusable buttons with `aria-pressed`) opens a small panel inside the burndown tile titled "Added Sep. 28, 2026" (the date written out as `Mon. D, YYYY`, in English; older snapshot caveat is explained in the footnote and the marker tooltip) with the ticket and point counts and one row per ticket: Ticket (Jira link, §8a), Summary, Points, Status, Assignee. Clicking the same marker again, the × button or Escape closes it; clicking another marker replaces it. The panel is information only: it does not change any filter, KPI or tile. It follows the filters (if the open date has no tickets after a filter change it closes) and stays open when the chart is redrawn on resize. The panel scrolls inside itself when the list is long (D44).
- **Hover:** every day has a tooltip: date, points remaining (or the ideal for future days), points done that day and how many tickets.
- **Subtitle:** "X of Y points remaining today, ideal Z" where Y is the scope today and Z the ideal for today (for the filtered set).
- **Footnote (always visible):** without `sprint.removed`: "Scope grows on each ticket's added date. Tickets removed from the sprint and re-estimates are not reflected. Older snapshots may not identify legacy estimated dates." With `sprint.removed`: "Scope grows on each ticket's added date and shrinks on the date a ticket left the sprint. Re-estimates are not reflected. Older snapshots may not identify legacy estimated dates."
- **Filters:** responds to every filter like the KPIs (the chart is for the filtered set; its ideal line is for that set's scope).
- **Legend:** Remaining, Ideal, Scope, (Removed, only when there are removal markers), "Added after day N" (filled marker) and "Earlier" (hollow marker).
- **Colours:** remaining line navy `#1f3a5f` with small dots; ideal line gray, dashed; scope line light gray, thin, stepped; today marker teal; addition markers amber. Text and numbers carry the information, not colour alone.
- **Accessibility:** the SVG has an `aria-label` summarising the chart and the same figures appear in the subtitle.

## 7. Page 2 — Backlog (`backlog.html`)

Dimensions: DoR, Priority, Type, Age, Epic. The filter bar holds the **Epic multi-select** (see §7.4) and the **search box** (see §7.3) next to the tags.

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

### 7.3 Search
Case-insensitive; trimmed. Matches `ticket`, `summary`, `epic`, `cluster`, `risk`. **DoR prefix search:** if the trimmed query is at least 3 characters and is a prefix of `missing`, `weak`, `well-formed`, `n/a (epic)` or `ready`, it filters by DoR status instead of matching text (`mis`, `miss`, `missi`, `missing` all give DoR = Missing; `wea`, `weak` give Weak; `wel`, `well`, `well-formed` give Well-Formed; `n/a`, `n/a (epic)` give N/A (Epic); `rea`, `read`, `ready` give Ready, which only matches older data). Under 3 characters, or not a prefix, it is a normal text search. The search is AND with every other filter and updates as the user types. While a DoR prefix is active a small hint says "Searching by readiness: DoR = Missing" and the search appears as a tag.

### 7.4 Epic filter (multi-select with checkboxes, D48)
A button in the filter bar labelled **Epic** (with the number of selected epics when any, e.g. "Epic (2)") opens a dropdown panel with one **checkbox per epic**. Several epics can be ticked at once; the page then shows the tickets of all ticked epics together (OR within the dimension, AND with every other filter and the search), so Carlos can compare or add up, for example, APP-718 and APP-55.
- **Options:** every distinct `epic` value in the data (full string, key plus summary, as exported) plus **(no epic)** for tickets without one. Sorted by number of tickets descending, then name, `(no epic)` last. Each option shows its ticket count, computed over the tickets that match every other active filter (the Epic dimension ignores itself, as the other dimension tiles do), so counts stay meaningful while filtering; an option with 0 stays visible and can still be ticked.
- **Behaviour:** ticking or unticking applies immediately to every tile, KPI and the table and adds or removes a tag "Epic: <epic> ×" in the filter bar; the panel stays open while ticking. A **Clear** button inside the panel unticks every epic. **Reset all** and removing a tag also update the checkboxes. The panel closes with Escape (focus returns to the button), a click outside it, or the button again.
- **Accessibility:** the button has `aria-expanded` and `aria-haspopup`; options are real `input type="checkbox"` elements inside `label`s, reachable with Tab; the focus outline is visible.
- A long epic name is shortened with an ellipsis in tags and options (the full text in the tooltip); nothing is lost from the data.

## 8. Interactions summary

| Interaction | Behavior |
|---|---|
| Click a bar row / person row / matrix cell | Select only that value (or pair); click again to clear (§5). |
| Ctrl, Cmd or Shift + click | Add or remove the value (multi-select). |
| Click × on a filter tag | Remove that value. |
| Fix version / Parent selects (sprint) | Set that dimension to one value; All clears it. |
| Backlog search | Text or DoR-prefix search, AND with the rest. |
| Backlog Epic dropdown | Tick several epics with checkboxes; the page shows their tickets together (§7.4). |
| Reset all | Clear all selections, selects and search. |
| Hover | Native tooltips on bars and cells show status, work items and story points (or the count). |
| Keyboard | Clickable rows and cells are real `button` elements, in tab order, with a visible focus outline. Enter or Space activates; Ctrl, Cmd or Shift + Enter/Space multi-selects. |

## 8a. Jira links

- **Where:** the **Ticket** column of both tables is a link. In the sprint table the **Parent** and **Linked work items** cells, and in the backlog table the **Epic** and **Related / cluster** cells, show every Jira key inside them as its own link; the rest of the cell text stays plain. Free-text columns (Summary, Current situation, Risk / open question) are never linked, to avoid false matches such as `UTF-8`.
- **What a key is:** a whole word shaped like `ABC-123` (capital letter, then capital letters or digits, a hyphen, digits). Any project key works (`APP-189`, `DOC-3360`, `DI-989`).
- **Link target:** `https://mysnaplogic.atlassian.net/browse/<KEY>`. The Jira address is defined once, as a constant in `dashboard.js`.
- **Behavior:** opens in a new tab (`target="_blank"`, `rel="noopener noreferrer"`), tooltip "Open <KEY> in Jira", visible focus outline, never changes a filter. Following a link needs internet and a Jira login in that browser; loading the dashboard still makes no external request.
- **Not in v2:** an "Open in Jira" button for the current selection; links on tile rows or matrix cells (those filter).

## 9. Design

- **Light mode only.** Dense, calm, high-contrast; the numbers are the largest element on a tile. System font stack, tabular numerals, sentence-case labels.
- **Status colours** (bars, dots): To Do/Open = sky blue, In Progress = blue, In Review = green, Done = gray, Other = hatched amber.
- **DoR colours:** Well-Formed and Ready `#C6EFCE`, Weak `#FFEB9C`, Missing `#FFC7CE` (tracker fills), N/A (Epic) and any other value neutral gray; bar versions are slightly stronger.
- **Heat grids:** a single-hue teal ramp (project teal `#2a9d8f`), count shown in the cell; text colour flips to white on dark cells.
- **Other colours:** existing project palette only (navy `#1f3a5f`, teal `#2a9d8f`, greys, red for warnings).
- **Selection state:** selected rows and cells get a teal outline and a light teal fill; when any selection exists in a tile the unselected items are dimmed (not hidden).
- **Tiles:** white surface, hairline border, small radius, no shadows; equal gutters; tile bodies scroll inside with a visible scrollbar and sticky headers.
- **Accessibility:** colour is never the only signal (names and numbers are always shown); contrast at least AA for text; focus outlines; selection is exposed with `aria-pressed`.

## 9b. Priority and Type icons (backlog, D49)
Priority and Type values carry a small icon in the style of Jira's own, so they are recognisable at a glance. Icons appear **before the text** (the text is never removed) in: the Priority and Type tile rows and the Priority and Type columns of the backlog table.
- **Priority:** Highest = red up arrow; High = orange "="; Medium = amber up chevron; Low = blue down chevron; Lowest = blue double down chevron. (Drawn to match the icons in the team's Jira.)
- **Type:** Story = green rounded square with a white bookmark; Bug = red square with a white bug; Epic = purple square with a white lightning bolt; Task = blue square with a white check; Sub-task = blue square with two linked boxes; Sub-Bug = red square with two linked boxes (the Sub-task glyph in the Bug colour); Initiative and Doc Task have icons too, in case they appear in the data.
- A value with no icon (any other name, or `—`) shows text only. Icons are inline SVG drawn by the app (no image files, no network), decorative (`aria-hidden`), carry no text of their own, and never replace the text, so colour is never the only signal. They are not Atlassian's original artwork; they are simple look-alikes.
- The sprint page has no Priority or Type, so it is unchanged.

## 9a. Chart colours

See §6.3 for the burndown. No other chart types exist; bars and heat grids are HTML.

## 10. Code structure (guidance)

The detailed structure (files, the `AF` API, page lifecycle, layout CSS, burndown model and drawing, DOM contract) is in `IMPLEMENTATION.md`; the build order is in `BUILD_PLAN.md`.

`index.html`, `backlog.html`, `dashboard.css`, `dashboard.js` (helpers, aggregation, filter store, tile builders), `sprint.js`, `backlog.js`. Keep the filter store and the aggregation functions pure (no DOM) so numbers can be checked in the console. No `innerHTML`; build DOM from text nodes.
