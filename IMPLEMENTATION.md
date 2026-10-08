# IMPLEMENTATION.md — how the dashboard is built

Audience: an AI coding agent (or a developer) that must **recreate this app from the documents**. `SPEC.md` says *what* to build, `DATA_CONTRACT.md` says *what the data means*, `ACCEPTANCE.md` says *how to know it is done*, `DECISIONS.md` says *why*. This file says *how the code is organised*, so a rebuild lands on the same structure and the same behaviour. Where this file and `SPEC.md` disagree, `SPEC.md` wins. The current code in this folder is the reference implementation.

## 1. Stack and hard limits

- Static HTML, CSS and vanilla JavaScript (ES5-style: `var`, `function`, no modules, no classes, no build). Served with `python3 -m http.server` from this folder. `file://` is unsupported (browsers block `fetch` of local JSON).
- No npm, no CDN, no web fonts, no library, no remote network calls. `dashboard.js` has one fetch path for relative local JSON: the sprint page loads `sprints.json` then one selected sprint snapshot (or falls back to `sprint.json`), while the backlog page loads `backlog.json`. Charts are inline SVG built with `createElementNS`; bars and heat grids are HTML/CSS.
- **No `innerHTML`, `eval`, `document.write`.** Every DOM node is built with `AF.el` (text nodes only) so data can never inject markup. The acceptance script greps for this.
- Light mode only. System fonts only (`--font` stack in `dashboard.css`).
- The app is read-only: it writes nothing (not Excel, Jira or the JSON).

## 2. Files and responsibilities

| File | Responsibility | Approx. size |
|---|---|---|
| `index.html` / `backlog.html` | Shell only: top bar with tabs, sprint selector mount on the sprint page, `#asof`, `#filterbar`, `<main id="app" class="board">` (starts with "Loading…"), footer. Load `dashboard.js` then `sprint.js` (or `backlog.js`). Inline favicon `data:,` (avoids a 404 console error). | 28 lines each |
| `dashboard.js` | Shared engine, exported as `window.AF`: status buckets, value helpers, pure aggregation, the filter store, burndown model and SVG drawing, DOM helpers (tile, rebuild, rowButton, bars, table, heat grid, filter bar), Jira link helpers, loading and error states. | ~610 lines |
| `sprint.js` | Sprint page: validates the sprint manifest, creates the sprint selector, caches selected snapshots, builds the shell tiles, defines the five dimensions, one `render*` function per tile, the marker panel, the resize observer. | ~400 lines |
| `backlog.js` | Backlog page: DoR prefix search, age buckets, four distribution tiles, matrix, table. Exposes `AF.backlog` for tests. | ~205 lines |
| `dashboard.css` | Tokens, shell, tiles, KPI tiles, bars, clickable rows, heat grid, tables, chart tile, burndown panel, layout modes. | ~270 lines |
| `scripts/run_acceptance.js` | Automated acceptance (see §10). | ~800 lines |

Order of scripts matters: `dashboard.js` defines `AF`; the page script reads `window.AF` at load.

## 3. Page lifecycle (both pages)

1. `AF.loadJson(file)` → the single `fetch(file, {cache:'no-store'})` path for relative local JSON. `AF.loadSnapshot(file)` calls it and requires `data.tickets` to be an array. The sprint page validates `sprints.json` before using its file paths; a missing or invalid manifest silently falls back to `sprint.json`.
2. `.then(init, onError)` — use the two-argument form so a *render* error is not misreported as a "can't load file" error.
3. `init(data)`: set the header timestamp, show a closed-sprint banner if applicable, clear `#app` and sprint filter bar, handle an empty ticket list (neutral message, return), create a fresh store, build the shell and controls, subscribe `render` to the store, call `render()`. On sprint switch the page calls `init` again with the cached or newly loaded snapshot so all filters reset.
4. `render()` is the only way the screen changes: `f = store.apply(tickets)` then, in order, KPIs, burndown (sprint), each dimension tile, matrix, table, then `updateBar()` and control sync. Tiles are **redrawn from scratch on every filter change** (they are small); there is no incremental DOM diffing.

## 4. `AF` API (dashboard.js)

Pure (no DOM; unit-checkable in the browser console, e.g. `AF.statusTotals(AF.tickets)`):

| Function | Contract |
|---|---|
| `bucketOf(status)` | `To Do`/`Open` → 0, `In Progress` → 1, `In Review` → 2, `Done` → 3, anything else (incl. null) → 4 (`OTHER`). Constants `BUCKETS = ['To Do/Open','In Progress','In Review','Done','Other']`, `BUCKET_CLASS = ['b-todo','b-prog','b-review','b-done','b-other']`. |
| `isBlank(v)`, `pts(v)` (non-number → 0), `fmtNum(n)` (integer as is, else 2 decimals max), `show(v)` (`—` if blank), `showPoints(v)`, `personName(v)` (blank or literal `Unassigned` → `Unassigned`) | Display rules from `DATA_CONTRACT.md` §4. |
| `sum(tickets,key)`, `statusTotals(tickets)` → per-bucket `{items,points}`, `aggregateBy(tickets,keyFn)` → `{rows:[{name,items[5],points[5],itemsTotal,pointsTotal}],totals}` sorted by points desc then name, `countBy`, `median`, `crossTab(tickets,rowKey,colKey,{rowOrder,colOrder,lastCol})` → `{rows,cols,cells,rowTotals,colTotals,max}` sorted by total desc, `lastCol` pushed last | Aggregation. |
| `createStore(dims)` | `dims = {name:{label,get(ticket)→string}}`. State: `sel[name]` = `Set` of values, `search = {q,pred,tag}`. Methods: `apply(tickets, except)` (AND across dimensions, OR within; `except` is a name or array of names to ignore, so a tile ignores its own dimension), `click(dim,value,multi)`, `clickPair(dimA,a,dimB,b,multi)`, `set`, `remove`, `setSearch(q,pred,tag)`, `reset`, `tags()`, `isActive()`, `subscribe(fn)`. `click` without `multi`: if the dimension holds exactly that one value, clear it; otherwise replace the selection with it. With `multi` (Ctrl/Cmd/Shift): toggle. |
| `config.midSprintThresholdDays` (default 2) | The one place the mid-sprint threshold lives. |
| `dayNum(iso)` / `isoOf(n)` / `shortDate(iso)` | Dates as whole UTC days (no time-zone shifts); `shortDate` → `M/D`. |
| `avgCycleTime(tickets)` → `{avg,n}` | Mean `cycleTime` over Done tickets with a numeric value. |
| `midSprintAdded(tickets,sprint,thr)` → `{thresholdDate,count,points,tickets}` or `null` | `addedDate > startDate + thr days` (string compare of ISO dates). |
| `burndown(tickets,sprint,today,thr,removed,opts)` → model or `null` (see §7) | `removed` is the filtered `sprint.removed` list, or an empty list when absent; `opts.closed` computes through sprint end and suppresses the live Today marker. |

DOM helpers: `el(tag,attrs,children)` (attrs: `class`, `text`, `style`, `onclick`-style listeners, anything else becomes an attribute; children are nodes or strings), `clear`, `isMulti(event)`, `tile({title,sub,cls})` → `{root,head,colhead,body,foot}`, `rebuild(tile, fn)` (clears colhead/body/foot, runs `fn`, restores scroll and — via `data-key` — keyboard focus, hides empty colhead/foot), `rowButton({key,cls,selected,dimmed,title,onclick(multi)},children)` (a real `<button class="rowbtn [sel] [dim]" aria-pressed>`), `statusDot`, `stackedBar(segments,total,scale)`, `simpleBar(pct,cls,title)`, `heatStyle(n,max)`, `buildTable(cols,rows,{cls})` (each col `{label,cls,render(row)}`; `null` renders `—`), `filterBar(container,store,controls)` → `update()`, `heatGrid(tile,crossTab,{corner,rowSel,colSel,unit,onCell})`, `emptyState(text)`, `showError`, `setUpdated(refreshedAt, exportedAt)` (shows the date and, when present, renders `exportedAt` in the browser's local timezone).

Icons (D49): `AF.icon.priority(name)` and `AF.icon.type(name)` return a 16×16 inline `<svg class="ico" data-icon="priority:High" aria-hidden="true">` built with `createElementNS` (no text inside), or `null` for unknown values; `backlog.js` puts them before the text in the Priority and Type tile rows (`renderDist` takes an optional icon function) and table cells (`iconText`).

Jira links: `JIRA_BASE` constant (the **only** place the Jira address appears), `KEY_PATTERN = '[A-Z][A-Z0-9]+-[0-9]+'`, `jiraUrl`, `jiraLink(key)` (`<a class="jira" target="_blank" rel="noopener noreferrer" title="Open KEY in Jira">`), `linkify(text)` (plain text + one link per whole-word key), `ticketCell(key)`, `linkCell(value)`.

## 5. Page scripts

### sprint.js
- Dimensions: `status` (get → bucket label), `assignee` (`personName(owner)`), `tester` (`personName(tester)`), `fix` (`fixVersion` or `(none)`), `parent` (`parent` or `(none)`). `NONE = '(none)'`.
- The manifest validator enforces one active sprint matching `current`, unique integer ids, valid date ranges and safe relative paths. Only manifest entries can select files; query-string values are ids, never paths. The selector uses `history.replaceState`, and snapshots are cached by manifest file for this page session. A missing or invalid manifest silently loads `sprint.json` without showing the selector.
- A sprint switch calls `init` with a new snapshot and entry, disconnecting the prior resize observer and removing the prior Escape handler. The fresh store resets all filters. A closed entry adds the data-as-of banner and note; burndown calculation runs through `endDate` with `opts.closed`, so there is no Today marker.
- Shell: `.kpis.k7` (seven `kpi()` tiles, in order: Work items, Story points, Done, Added mid-sprint, Carried over, No tester, Avg cycle time), `.main.sprint` (Burndown, Tickets by status, Work by assignee, Work by tester), `.lower` (Ticket detail, Assignee x tester).
- Ticket detail shows `Dev to Test` immediately after Tester, using the exact `classifications` value and displaying Yes or `—`. Owner, Tester and Status cells use `.wrap-text` and wrap at spaces with automatic column widths; the final `.current-situation` column has a 350 px minimum width. The detail table scrolls horizontally inside its tile when needed.
- Tile renderers: `renderKpis(f)`, `renderBurndown(f)`, `renderStatus()`, `renderPeople(tile, dim, keyFn, label)` (called for assignee and tester), `renderMatrix()`, `renderDetail(f)`. KPIs, burndown and detail use the fully filtered set `f`; status, people and matrix tiles call `store.apply(tickets, ownDimension(s))`.
- Status tile always shows rows for buckets 0–3, plus `Other` only if some ticket is in it. Bars on people rows are two stacked bars (items, points) split by status bucket; scale per column = max in the tile.
- Fix version and Parent are `<select>` controls (ids `f-fix`, `f-parent`) passed to `AF.filterBar`; `syncCtl` keeps them equal to the store after any change (including Reset all and tag removal).
- Carried over KPI reads `sprint.carriedOver` as exported (see `SPEC.md` §6.2); it is **not** recalculated and does not respond to filters.
- Key listings for focus restore: `data-key` values are `status:<name>` and `<dim>:<name>`.
- At the end: `AF.store = store; AF.tickets = tickets;` for console and test access.

### backlog.js
- Dimensions: `dor`, `priority`, `type`, `age` (`ageOf(t)` buckets `0–30`, `31–90`, `91–180`, `181–365`, `366+`, `No value`; the en dash is U+2013). Value lists (`dorKeys`, `prioKeys`, `typeKeys`, `ageKeys`) are computed from the whole data once so tile rows stay put while filtering. Priority order: Highest, High, Medium, Low, Lowest, others by count, `—` last.
- Epic filter (D48): fifth dimension `epic` (value = full `epic` string or `—`). The control is a persistent button plus a popup of checkboxes in the filter bar (`.epicbtn`, `.epicpop`, one `label.epicopt` per epic with `input[type=checkbox]` and a count); `render()` only syncs checked state, counts and the button label (it never rebuilds the popup, so focus and the open state survive), and `store.click(dim, value, true)` toggles a value.
- Search: `searchFor(q)` → `{pred, tag, dor}`; `dorFromQuery(q)`: trimmed, lower-cased, ≥ 3 characters and a prefix of `missing`/`weak`/`well-formed`/`n/a (epic)`/`ready` → DoR filter, else text search over ticket, summary, epic, cluster, risk. Input id `q`; a hint line (`.dorhint`, `aria-live="polite"`) says "Searching by readiness: DoR = X."
- `.board.bl` class is added to `#app`'s board in the page script (`app.classList.add('bl')`) because the backlog grid has different row weights.

## 6. Layout and CSS

- Tokens on `:root`: `--bg #e9edf2`, `--surface #fff`, `--ink #17263b`, `--muted #566478`, `--line #d3dae3`, `--line-soft #e8ecf1`, `--navy #1f3a5f`, `--teal #2a9d8f`, `--teal-soft #e3f3f1`, `--warn #b83a2e`; status colours `--s-todo #86cdf2`, `--s-prog #2f6fd0`, `--s-review #34a56a`, `--s-done #a9b2bf`, `--s-other #e3a72f` (hatched); DoR fills `#c6efce` `#ffeb9c` `#ffc7ce`; heights `--topbar-h 52px`, `--filterbar-h 46px`, `--foot-h 24px`. Font stack `"Avenir Next","Segoe UI Variable Text","Segoe UI",system-ui,…`, 13px base, `font-variant-numeric: tabular-nums`.
- **Two layout modes.** Base rules (no media query) are the scrolling fallback: block layout, tiles stacked, tile bodies capped at 400–460px with their own scroll. `@media (min-width:1366px) and (min-height:760px)` turns the board into the dashboard: `html, body {overflow:hidden}`, `.app {height:100vh}`, `.board` sprint rows are `auto minmax(0,1.1475fr) minmax(0,1.2025fr)` (15% of the former main-row height transferred to the lower row; backlog: `auto minmax(0,0.62fr) minmax(0,1fr)`), tile bodies `max-height:none`, grid columns: `.main.sprint` = `minmax(0,1.8fr) minmax(250px,1fr) minmax(0,1.25fr) minmax(0,1.25fr)`; `.lower` = `minmax(0,1fr) minmax(440px,28%)`; `.main.backlog` = five equal columns; KPI strips `k4/k5/k7` = equal columns.
- **CSS order matters.** Base rules for `.lower`, the chart tile and the burndown panel must come *before* the media block, otherwise they override the grid declarations inside it (this bug happened once).
- `.tile` is a flex column (`head`, `colhead`, scrolling `.tile-body`, pinned `.tile-foot`), `min-height:0` so grid children can shrink; the body has a visible 12px scrollbar. Sticky table headers (`position:sticky; top:0`).
- Selected state: `.rowbtn.sel` = teal border + light teal fill; `.rowbtn.dim` = 50% opacity; heat cells `.cell.sel` dark outline, `td.dim` 40% opacity. Heat colour ramp: `rgba(42,157,143, 0.12 + 0.78·n/max)`, white text above 0.55.
- Chart tile: `.tile-body.chart {overflow:hidden; margin:4px -12px 0; padding:0; min-height:300px}` (min-height 0 in dashboard mode). `.tile:has(.chart) {position:relative}` anchors the marker panel.

## 7. Burndown (inline SVG)

**Model** — `AF.burndown(tickets, sprint, today, thr, removed, opts)`; returns `null` when `sprint` is missing or its dates are invalid (`end < start`). For a closed sprint, `opts.closed` makes the effective chart date the sprint end and hides the live Today marker:
- `n` = calendar days from `startDate` to `endDate` inclusive (weekends included); `scope(i)` = story points of filtered tickets with `addDay ≤ i` (D45; `addDay` from `addedDate`, null/before start → 0, after end → last day); `total` = the largest scope on any day (y-axis top, including when removals lower the final scope).
- For each Done ticket: if `doneDate` is not a date → counted in `unplacedDone` (and not subtracted); else `idx = max(0, doneDay − startDay)` (a pre-start date counts on day 1); `idx ≥ n` → `afterEndDone` (ignored); otherwise add its points to day `max(idx, addDay)` (never before it entered the scope).
- `todayIndex = clamp(dayNum(today) − start, −1, n−1)`, `todayInside` = today within `[start,end]`. `today` is the snapshot's `refreshedAt`, **not the browser clock**.
- `days[i] = {date, scope, ideal: scope(0)·(1 − i/(n−1)), remaining: i ≤ todayIndex ? scope(i) − cumulativeDone : null, doneToday, doneTickets}` (the ideal starts at the *starting* scope).
- Removals (D52): `burndown(tickets, sprint, today, thr, removed)`; `removed` = `sprint.removed` after `store.apply` (empty array when absent). Each entry adds its points at `addDay` and subtracts them at `removeDay`; `removedByDate[date]` feeds the markers; `total` = max scope.
- `mid = midSprintAdded(...)`; `addedByDate[date]` (every date after the start day, with an `early` flag when `date <= startDate + threshold`; `midByDate` is the same list restricted to dates after the threshold) = list of `{ticket, points, summary, status, owner}` grouped by `addedDate` (a date after the sprint end is clamped to the last day).

**Drawing** — `AF.drawBurndown(container, model, opts)`; `opts = {thresholdDays, label, selectedDate, onMarker(date,list)}`:
- Sized to the container (`W = max(280, clientWidth)`, `H = max(120, clientHeight)`); margins `L=42, R=16, T=small?34:42, B=small?36:50` where `small = H<260`; `narrow = W<560` drops the y-axis title and moves the legend to the left. Y axis from 0 to `niceScale(total)` (step from `[1,2,5,10,20,25,50,100,200,250,500,1000]` giving ≤ 6 intervals).
- Draw order (back to front): y grid + labels, per-day transparent hover rects (`rect.bd-day` with `data-date/remaining/ideal/done` and `<title>` tooltips), x ticks and `M/D` labels (thinned so labels are ≥ 36px apart, last day always labelled), scope step line (`polyline.bd-scope`, thin light gray, up to today), ideal polyline (`polyline.bd-ideal`, dashed gray `#8795a8`), Today marker (only if `todayInside`; teal dotted line + "Today"), remaining polyline (`polyline.bd-actual`, navy `#1f3a5f`, dots, bigger last dot), mid-sprint markers, legend.
- Marker = `g.bd-added` (`data-date/count/points`, `tabindex=0`, `role=button`, `aria-pressed`, `aria-label`) containing a transparent 28×32 hit rect, an amber triangle, a `+N` label and a `<title>` tooltip. Selected marker gets class `bd-sel`. Click, Enter or Space calls `opts.onMarker`.
- The page redraws the chart from a `ResizeObserver` on the tile body whenever its width or height changes. Chart height must come from the container, not from a fixed number (a fixed minimum cut the chart off at 1366×768).

**Marker panel** (`sprint.js`) — `selectedDate` and `pop` live in the page script. `onMarker(date,list)` toggles: same date → close; other date → `showPanel(list)`; then redraw (so `bd-sel`/`aria-pressed` update) and refocus the marker. `showPanel` appends `div.bd-pop[role=dialog]` to the tile root (header: "Added Sep. 28, 2026" via `AF.longDate`, "N tickets, P points", × button; body: table Ticket(Jira link) / Summary / Pts / Status / Assignee). `renderBurndown` removes the panel DOM at the start of every render and re-shows it only if `selectedDate` still exists in the new `midByDate`; empty or no-date states close it. Escape (document-level `keydown`) closes it. It changes no filter.

## 8. Accessibility and interaction contract

Clickable things are real `<button>`s in tab order with a visible focus outline (`:focus-visible`, teal 2px); selected state is `aria-pressed`; Enter/Space activates, and Ctrl/Cmd/Shift with Enter/Space multi-selects (the click event carries the modifier). Colour is never the only signal (names and numbers always shown). Contrast ≥ AA. Reduced motion is respected (no animations exist). Scroll position and keyboard focus survive a redraw (`AF.rebuild`).

## 9. Data pipeline (outside this folder, needed to refresh data)

`AF_Snaplogic/03_Team_Enablement/daily_tracker.xlsx` (sheets `Daily`, `Backlog Prioritized`) → `AF_Snaplogic/05_Automation/export_dashboard_snapshots.py` (read-only, manual, atomic write, refuses to run while the Excel lock file exists, needs `openpyxl`) → `sprint.json`, `backlog.json` validated by `schema/snapshot.schema.json`. Mapping rules: `DATA_CONTRACT.md` and the AF_Snaplogic skill `af-dashboard-snapshot-export.md` at the absolute path listed in `AGENTS.md`. A rebuild that has no tracker can develop against `fixtures/sample_snapshot.json` (four sprint tickets with edge cases) and hand-made JSON. If a new field is needed, update the exporter, its skill, the schema, the fixture and `DATA_CONTRACT.md` together.

Known data limits that the UI must keep showing, not hide: older snapshots may contain `addedDate` values from before the approximation marker was retired, but the marker is not preserved in JSON; removals are reflected only when `sprint.removed` is present, and re-estimates are not reflected; `sprint.carriedOver` has a ticket percentage only (no points percentage).

## 10. The acceptance script (`scripts/run_acceptance.js`)

Design to copy if you rebuild it: Node 22+ (global `fetch` and `WebSocket`), spawns `python3 -m http.server` on ports 8771–8782 for the real folder and for throwaway copies of the app with swapped data (missing, invalid, empty, fixture, links with odd data, a hand-made sprint with hand-computed answers, `carriedOver` null/zero/partial, a sprint without dates), launches headless Chrome with `--remote-debugging-port=9333` and a fresh profile, and drives it over the DevTools protocol. A page-side helper string (`H`) defines `tile()`, `rowsOf()`, `clickRow()`, `clickCell()`, `setSel()`, `setQ()`, `readCommon()`, `colCells()`, `matrixOf()`, `READ_BD`, `READ_SPRINT`. After **every** interaction it re-reads the screen and compares KPIs, tags, every tile, the table and the burndown with an **independent** expected-value model computed in Node from the JSON (never from the app's own functions). It also checks layouts at 1920×1080, 1536×864, 1440×900, 1366×768 (no page scroll) and 1280×720, 1024×768, 800×900, 480×900 (fallback), keyboard behaviour, console cleanliness, only-localhost requests, source greps (no `innerHTML`/`eval`/CDN), schema conformance, Jira links, and that the real data files are unchanged. Exit code 0 = all pass. It depends on the DOM class names and `data-*` attributes listed in this file; if you rename them, update the script in the same pass.
