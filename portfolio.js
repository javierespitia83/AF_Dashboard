/* portfolio.js — portfolio snapshot page (version 2): one team per screen, no comparison between teams.
 * Reads portfolio/projects.json (manifest), then portfolio/<KEY>.json (team data).
 * ?project=<KEY> selects the team; no KEY lists the teams; an unknown KEY shows an empty state.
 * No names, e-mails, ticket keys or summaries in any data file.
 */
(function () {
  'use strict';
  var AF = window.AF, el = AF.el, app = document.getElementById('app');
  var MANIFEST_FILE = 'portfolio/projects.json';
  var NS = 'http://www.w3.org/2000/svg';

  // ── helpers ──────────────────────────────────────────────────────────────
  function shown(value) {
    return value === null || value === undefined || value === '' ? 'n/a' : String(value);
  }

  function num(value) {
    if (value === null || value === undefined || value === '') return 'n/a';
    return typeof value === 'number' ? value.toLocaleString('en-US') : String(value);
  }

  function pct(n, total) {
    if (!total) return 'n/a';
    return Math.round(100 * n / total) + '%';
  }

  function dayDiff(a, b) { return Math.round((b - a) / 864e5); }

  function parseDay(s) { return new Date(s.slice(0, 10) + 'T00:00:00'); }

  function badge(kind, text) {
    var b = el('abbr', { class: 'approx-badge' + (kind === 'lower' ? ' approx-lower' : ''), title: text });
    b.textContent = kind === 'lower' ? '≥' : '≈';
    return b;
  }

  /* One label + value cell. approx: true (≈) or 'lower' (≥). tip: tooltip text (method), never printed. */
  function kv(label, value, tip, approx) {
    var cell = el('div', { class: 'pf-kv' });
    cell.appendChild(el('div', { class: 'pf-kv-label', text: label }));
    var val = el('div', { class: 'pf-kv-value' });
    val.appendChild(document.createTextNode(typeof value === 'number' ? num(value) : String(value)));
    if (approx) val.appendChild(badge(approx === 'lower' ? 'lower' : 'approx', tip || 'Approximate'));
    cell.appendChild(val);
    if (tip && !approx) cell.setAttribute('title', tip);
    return cell;
  }

  function node(name, attrs, text) {
    var e = document.createElementNS(NS, name);
    for (var k in attrs) { if (Object.prototype.hasOwnProperty.call(attrs, k)) e.setAttribute(k, attrs[k]); }
    if (text != null) e.textContent = text;
    return e;
  }

  function shortDate(s) { return s.slice(5, 10).replace('-', '/'); }

  /* A horizontal bar: filled share of a track. ratio in 0..1. */
  function bar(ratio, extraClass) {
    var track = el('div', { class: 'pf-track' });
    var fill = el('div', { class: 'pf-fill' + (extraClass ? ' ' + extraClass : '') });
    fill.style.width = Math.max(0, Math.min(1, ratio || 0)) * 100 + '%';
    track.appendChild(fill);
    return track;
  }

  // ── burndown chart ───────────────────────────────────────────────────────
  // bdata: { days: [[date, remaining], ...], startDate?, endDate?, sprintName }. The x axis spans
  // startDate..endDate when given (current sprint), else the first..last day of the series.
  function burndownChart(bdata) {
    var days = bdata.days;
    if (!days || !days.length) return el('p', { class: 'empty', text: 'n/a' });
    var W = 800, H = 210, L = 44, R = 16, T = 22, B = 26;
    var start = parseDay(bdata.startDate || days[0][0]);
    var end = parseDay(bdata.endDate || days[days.length - 1][0]);
    var span = Math.max(1, dayDiff(start, end));
    var maxR = 0, i;
    for (i = 0; i < days.length; i++) { if (days[i][1] > maxR) maxR = days[i][1]; }
    if (!maxR) maxR = 1;
    function X(date) { return L + (dayDiff(start, parseDay(date)) / span) * (W - L - R); }
    function Y(v) { return T + (H - T - B) * (1 - v / maxR); }
    var svg = node('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'class': 'pf-burn',
      'aria-label': 'Burndown: story points remaining per day, from ' + days[0][0] + ' to ' + days[days.length - 1][0] });
    var ticks = [0, Math.round(maxR / 2), maxR];
    for (i = 0; i < ticks.length; i++) {
      svg.appendChild(node('line', { x1: L, x2: W - R, y1: Y(ticks[i]), y2: Y(ticks[i]), stroke: '#dde2ea', 'stroke-width': 1 }));
      svg.appendChild(node('text', { x: L - 6, y: Y(ticks[i]) + 5, 'text-anchor': 'end', 'font-size': 13, fill: '#5b6676' }, String(ticks[i])));
    }
    svg.appendChild(node('text', { x: 4, y: 13, 'font-size': 13, fill: '#5b6676' }, 'points remaining'));
    var mid = new Date(start.getTime() + Math.round(span / 2) * 864e5);
    var labels = [[start, 'start'], [mid, 'middle'], [end, 'end']];
    for (i = 0; i < labels.length; i++) {
      var d = labels[i][0];
      var iso = d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
      svg.appendChild(node('text', { x: X(iso), y: H - 7, 'text-anchor': i === 0 ? 'start' : (i === 2 ? 'end' : 'middle'), 'font-size': 13, fill: '#5b6676' }, shortDate(iso)));
    }
    svg.appendChild(node('line', { x1: X(days[0][0]), y1: Y(days[0][1]), x2: X(bdata.endDate || days[days.length - 1][0]), y2: Y(0), stroke: '#8a94a6', 'stroke-width': 1.5, 'stroke-dasharray': '5 4' }));
    var pts = [];
    for (i = 0; i < days.length; i++) { pts.push(X(days[i][0]).toFixed(1) + ',' + Y(days[i][1]).toFixed(1)); }
    svg.appendChild(node('polyline', { points: pts.join(' '), fill: 'none', stroke: '#1f6f64', 'stroke-width': 2.5 }));
    for (i = 0; i < days.length; i++) {
      var c = node('circle', { cx: X(days[i][0]).toFixed(1), cy: Y(days[i][1]).toFixed(1), r: 4, fill: '#1f6f64' });
      c.appendChild(node('title', {}, days[i][0] + ': ' + days[i][1] + ' points remaining'));
      svg.appendChild(c);
    }
    var wrap = el('div', { class: 'pf-burn-wrap' });
    wrap.appendChild(svg);
    var legend = el('p', { class: 'pf-burn-cap' });
    legend.appendChild(el('span', { class: 'pf-lg pf-lg-real', text: '━ Points remaining (≈)' }));
    legend.appendChild(el('span', { class: 'pf-lg pf-lg-ideal', text: '┄ Ideal line' }));
    legend.appendChild(el('span', { text: bdata.sprintName + ' · ' + shortDate(bdata.startDate || days[0][0]) + ' to ' + shortDate(bdata.endDate || days[days.length - 1][0]) }));
    wrap.appendChild(legend);
    return wrap;
  }

  // ── legend ──────────────────────────────────────────────────────────────
  function renderLegend() {
    var det = el('details', { class: 'pf-legend' });
    det.appendChild(el('summary', { text: 'Legend: symbols and units' }));
    var body = el('div', { class: 'pf-legend-body' });
    body.appendChild(el('div', { text: '≈ = approximate value (method shown in tooltip)' }));
    body.appendChild(el('div', { text: '≥ = lower bound (actual value is equal or higher)' }));
    body.appendChild(el('div', { text: 'tickets = work items (Jira issues in the sprint or backlog)' }));
    body.appendChild(el('div', { text: 'points = Story Points as recorded in Jira — meaning not confirmed per team' }));
    det.appendChild(body);
    return det;
  }

  // ── time label: add Pacific time next to the snapshot time ───────────────
  function addPacificTime(exportedAt) {
    var asof = document.getElementById('asof');
    if (!asof || !exportedAt) return;
    try {
      var pt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(exportedAt));
      asof.textContent = asof.textContent + ' (' + pt + ' Pacific)';
    } catch (e) { /* keep the original label */ }
  }

  // ── tiles ────────────────────────────────────────────────────────────────
  function tile(label, title, subtitle) {
    var t = el('section', { class: 'tile pf-tile', 'aria-label': label });
    var head = [el('h3', { text: title })];
    if (subtitle) head.push(el('p', { class: 'sub', text: subtitle }));
    t.appendChild(el('div', { class: 'tile-head' }, head));
    return t;
  }

  function velocityTile(data) {
    var t = tile('Velocity', 'How much did the team finish? ≈', 'Last 3 closed sprints · done ÷ scope at close');
    var body = el('div', { class: 'tile-body' });
    if (!data.velocity || !data.velocity.length) {
      body.appendChild(el('p', { class: 'empty', text: 'No velocity data available.' }));
      t.appendChild(body); return t;
    }
    var list = el('div', { class: 'pf-vel-bars' });
    data.velocity.forEach(function (v) {
      var row = el('div', { class: 'pf-vel-row' });
      row.appendChild(el('div', { class: 'pf-vel-name', text: v.name }));
      var tk = el('div', { class: 'pf-vel-metric' });
      tk.appendChild(el('span', { class: 'pf-vel-cap', text: 'Tickets' }));
      tk.appendChild(bar(v.scopeTickets ? v.doneTickets / v.scopeTickets : 0));
      tk.appendChild(el('span', { class: 'pf-vel-num', text: v.doneTickets + ' / ' + v.scopeTickets + ' (' + v.completionTicketsPct + '%)' }));
      var pt = el('div', { class: 'pf-vel-metric' });
      pt.appendChild(el('span', { class: 'pf-vel-cap', text: 'Points' }));
      pt.appendChild(bar(v.scopePoints ? v.donePoints / v.scopePoints : 0, 'pf-fill-pts'));
      pt.appendChild(el('span', { class: 'pf-vel-num', text: v.donePoints + ' / ' + v.scopePoints + ' (' + v.completionPointsPct + '%)' }));
      var pair = el('div', { class: 'pf-vel-pair' }); pair.appendChild(tk); pair.appendChild(pt);
      var meta = el('div', { class: 'pf-vel-meta' });
      meta.appendChild(el('span', { text: 'Carried to next: ' + shown(v.carriedToNext) + ' tickets' }));
      meta.appendChild(el('span', { text: 'Created after start: ' + shown(v.createdAfterStart) + ' tickets ≥' }));
      var late = el('span', { text: v.closedLateDays > 0 ? 'Closed ' + v.closedLateDays + ' days after planned end' : 'Closed on time' });
      if (v.closedLateDays > 0) late.setAttribute('class', 'pf-late');
      meta.appendChild(late);
      row.appendChild(pair); row.appendChild(meta);
      list.appendChild(row);
    });
    body.appendChild(list);
    body.appendChild(velocityTable(data));
    t.appendChild(body);
    return t;
  }

  function velocityTable(data) {
    var det = el('details', { class: 'pf-vel-details' });
    det.appendChild(el('summary', { text: 'Show as a table' }));
    var wrap = el('div', { class: 'pf-vel-wrap' });
    var tbl = el('table', { class: 'data pf-vel-table' });
    tbl.appendChild(el('thead', null, [el('tr', null, [
      el('th', { scope: 'col', text: 'Sprint' }),
      el('th', { scope: 'col', text: 'Scope (tickets)' }),
      el('th', { scope: 'col', text: 'Done (tickets, %) ≈' }),
      el('th', { scope: 'col', text: 'Scope (points)' }),
      el('th', { scope: 'col', text: 'Done (points) ≈' }),
      el('th', { scope: 'col', text: 'Carried to next (tickets) ≈' }),
      el('th', { scope: 'col', text: 'Created after start (tickets) ≥' }),
      el('th', { scope: 'col', text: 'Closed late (days)' })
    ])]));
    var tbody = el('tbody');
    data.velocity.forEach(function (v) {
      var lateCell = el('td', { text: v.closedLateDays > 0 ? ('+' + v.closedLateDays + ' days after planned end') : '—' });
      if (v.closedLateDays > 0) lateCell.setAttribute('class', 'pf-late');
      tbody.appendChild(el('tr', null, [
        el('td', { text: v.name }),
        el('td', { text: String(v.scopeTickets) }),
        el('td', { text: v.doneTickets + ' (' + v.completionTicketsPct + '%)' }),
        el('td', { text: String(v.scopePoints) }),
        el('td', { text: String(v.donePoints) }),
        el('td', { text: String(v.carriedToNext) }),
        el('td', { text: v.createdAfterStart != null ? String(v.createdAfterStart) : 'n/a' }),
        lateCell
      ]));
    });
    tbl.appendChild(tbody);
    wrap.appendChild(tbl);
    det.appendChild(wrap);
    det.appendChild(el('p', { class: 'pf-note', text: 'Scope = end-of-sprint list (tickets). Completion may differ from Jira’s own report. Points created after start: not available.' }));
    return det;
  }

  function burndownTile(data) {
    var t = tile('Burndown', 'Is the sprint burning down? ≈', 'Story points remaining per day');
    var body = el('div', { class: 'tile-body pf-burn-body' });
    var cur = data.burndownCurrent, last = data.burndownLastClosed;
    var hasCur = cur && cur.days && cur.days.length, hasLast = last && last.days && last.days.length;
    var chartBox = el('div', { class: 'pf-burn-box' });
    function show(which) {
      AF.clear(chartBox);
      var d = which === 'last' ? last : cur;
      if (d && d.days && d.days.length) {
        chartBox.appendChild(burndownChart(d));
        chartBox.appendChild(el('p', { class: 'pf-note', text: '≈ ' + d.method }));
      } else {
        chartBox.appendChild(el('p', { class: 'empty', text: 'n/a' }));
      }
    }
    var toggle = el('div', { class: 'pf-toggle', role: 'group', 'aria-label': 'Burndown sprint' });
    var btnCur = el('button', { type: 'button', class: 'pf-toggle-btn is-on', 'aria-pressed': 'true', text: 'Current sprint' });
    var btnLast = el('button', { type: 'button', class: 'pf-toggle-btn', 'aria-pressed': 'false', text: 'Last closed sprint' });
    function select(which) {
      btnCur.className = 'pf-toggle-btn' + (which === 'cur' ? ' is-on' : ''); btnCur.setAttribute('aria-pressed', which === 'cur' ? 'true' : 'false');
      btnLast.className = 'pf-toggle-btn' + (which === 'last' ? ' is-on' : ''); btnLast.setAttribute('aria-pressed', which === 'last' ? 'true' : 'false');
      show(which);
    }
    btnCur.addEventListener('click', function () { select('cur'); });
    btnLast.addEventListener('click', function () { select('last'); });
    toggle.appendChild(btnCur); toggle.appendChild(btnLast);
    body.appendChild(toggle);
    body.appendChild(chartBox);
    select(hasCur ? 'cur' : (hasLast ? 'last' : 'cur'));
    t.appendChild(body);
    return t;
  }

  function healthTile(data) {
    var sprint = data.currentSprint;
    var t = tile('Sprint health', 'What is moving or stuck?', 'Current sprint, tickets');
    var body = el('div', { class: 'tile-body pf-kv-grid' });
    var d7 = sprint.stuckD7, d14 = sprint.stuckD14;
    body.appendChild(kv('No status change, 7 to 13 days (tickets)', (typeof d7 === 'number' && typeof d14 === 'number') ? Math.max(0, d7 - d14) : null, 'In Progress with no status change for 7 to 13 days: the 7+ days count minus the 14+ days count'));
    body.appendChild(kv('No status change, 14+ days (tickets)', d14, 'In Progress, NOT status CHANGED AFTER -14d'));
    body.appendChild(kv('Carried in (tickets)', sprint.carriedIn, 'Tickets also in the previous sprint; approximate', true));
    body.appendChild(kv('Created after sprint start (tickets)', sprint.createdAfterStart, 'Lower bound: tickets created after the sprint start date; sprint CHANGED JQL is not supported', 'lower'));
    body.appendChild(kv('Bugs in sprint (tickets)', sprint.bugsInSprint));
    body.appendChild(kv('Bugs created, last 14 days (tickets)', shown(data.bugsCreated14d)));
    body.appendChild(kv('All tickets created, last 14 days', num(data.ticketsCreated14d), data.ticketsCreated14d != null ? 'All issue types in the project, created in the last 14 days' : null));
    body.appendChild(kv('Team size (people with tickets)', sprint.teamSize, 'Distinct assignees in the current sprint; no names stored'));
    t.appendChild(body);
    return t;
  }

  function backlogTile(data) {
    var bl = data.backlog;
    var t = tile('Backlog health', 'How healthy is the backlog?', 'Tickets outside the current sprint, by age since creation (re-opened or moved tickets may look older)');
    var body = el('div', { class: 'tile-body' });
    var total = bl.total || 0;
    var segs = [
      { label: 'Up to 90 days', n: Math.max(0, total - bl.created90dPlus), cls: 'pf-seg-1' },
      { label: '90 to 180 days', n: Math.max(0, bl.created90dPlus - bl.created180dPlus), cls: 'pf-seg-2' },
      { label: '180 days to 1 year', n: Math.max(0, bl.created180dPlus - bl.created365dPlus), cls: 'pf-seg-3' },
      { label: 'Over 1 year', n: bl.created365dPlus, cls: 'pf-seg-4' }
    ];
    body.appendChild(el('div', { class: 'pf-bl-total', text: 'Total backlog: ' + num(total) + ' tickets' + (bl.scopeNote ? ' *' : '') }));
    var stack = el('div', { class: 'pf-stack', role: 'img', 'aria-label': 'Backlog by age: ' + segs.map(function (s) { return s.label + ' ' + s.n; }).join(', ') });
    segs.forEach(function (s) {
      var seg = el('div', { class: 'pf-seg ' + s.cls, title: s.label + ': ' + s.n + ' tickets' });
      seg.style.flexGrow = String(s.n);
      stack.appendChild(seg);
    });
    body.appendChild(stack);
    var keyRow = el('div', { class: 'pf-stack-key' });
    segs.forEach(function (s) {
      var k = el('div', { class: 'pf-stack-item' });
      k.appendChild(el('span', { class: 'pf-swatch ' + s.cls }));
      k.appendChild(el('span', { text: s.label + ': ' + num(s.n) + ' (' + pct(s.n, total) + ')' }));
      keyRow.appendChild(k);
    });
    body.appendChild(keyRow);
    var chips = el('div', { class: 'pf-chips pf-bl-chips' });
    if (bl.notUpdated365d !== null && bl.notUpdated365d !== undefined) {
      chips.appendChild(el('span', { class: 'pf-chip', text: 'Not updated in 1 year (tickets): ' + num(bl.notUpdated365d) + ' (' + pct(bl.notUpdated365d, total) + ')' }));
    }
    chips.appendChild(el('span', { class: 'pf-chip', text: 'No points (tickets): ' + num(bl.noPoints) + ' (' + pct(bl.noPoints, total) + ')' }));
    chips.appendChild(el('span', { class: 'pf-chip', text: 'No parent (tickets): ' + num(bl.noParent) + ' (' + pct(bl.noParent, total) + ')' }));
    body.appendChild(chips);
    if (bl.scopeNote) body.appendChild(el('p', { class: 'pf-note', text: '* ' + bl.scopeNote }));
    t.appendChild(body);
    return t;
  }

  // ── render team ──────────────────────────────────────────────────────────
  function renderTeam(data) {
    AF.clear(app);
    app.classList.add('portfolio-view');
    AF.setUpdated(data.refreshedAt, data.exportedAt);
    addPacificTime(data.exportedAt);

    var sprint = data.currentSprint;
    var asOf = (data.burndownCurrent && data.burndownCurrent.asOf) || data.refreshedAt;
    var dayN = null, dayTotal = null, elapsedPct = null, lengthDays = null;
    if (sprint.startDate && sprint.endDate && asOf) {
      var s = parseDay(sprint.startDate), e = parseDay(sprint.endDate), t = parseDay(asOf);
      lengthDays = dayDiff(s, e) + 1;
      dayTotal = lengthDays;
      dayN = Math.min(dayTotal, Math.max(1, dayDiff(s, t) + 1));
      elapsedPct = Math.max(0, Math.min(100, Math.round(100 * dayDiff(s, t) / Math.max(1, dayDiff(s, e)))));
    }
    // Progress counts only what was closed inside the sprint: tickets already Done when the sprint started are listed apart.
    var preT = sprint.doneBeforeStartTickets || 0, preP = sprint.doneBeforeStartPoints || 0;
    var doneInT = Math.max(0, sprint.doneTickets - preT), doneInP = Math.max(0, sprint.donePoints - preP);
    var donePct = sprint.points ? Math.round(100 * doneInP / sprint.points) : null;
    var doneTicketsPct = sprint.tickets ? Math.round(100 * doneInT / sprint.tickets) : null;

    // top: title, summary line, notes, legend, past-end warning
    var top = el('div', { class: 'pf-top' });
    var titleRow = el('div', { class: 'pf-title-bar' });
    titleRow.appendChild(el('h2', { class: 'pf-team-title', text: data.label }));
    if (data.pointsNote) titleRow.appendChild(el('p', { class: 'pf-points-note', text: 'ℹ️ ' + data.pointsNote }));
    titleRow.appendChild(renderLegend());
    top.appendChild(titleRow);
    var parts = [];
    if (dayN !== null) parts.push('Day ' + dayN + ' of ' + dayTotal);
    if (donePct !== null && elapsedPct !== null) parts.push(donePct + '% of points done ≈ at ' + elapsedPct + '% of the sprint time (' + num(doneInT) + ' of ' + num(sprint.tickets) + ' tickets closed in the sprint)');
    parts.push(num(sprint.stuckD7) + ' tickets with no status change in 7+ days');
    parts.push('backlog ' + num(data.backlog.total) + ' tickets' + (data.backlog.scopeNote ? ' *' : ''));
    top.appendChild(el('p', { class: 'pf-summary', text: parts.join(' · ') }));
    if (sprint.pastEndDate) {
      var over = '';
      if (sprint.endDate && asOf) { var dOver = dayDiff(parseDay(sprint.endDate), parseDay(asOf)); if (dOver > 0) over = ' (' + dOver + ' days past the planned end date of ' + sprint.endDate + ')'; }
      var warn = el('div', { class: 'pf-warn', role: 'alert' });
      warn.textContent = '⚠️ Sprint past end date' + over + '. The sprint may still be active in Jira but has not been closed.';
      top.appendChild(warn);
    }
    app.appendChild(top);

    // header strip: sprint, time, progress vs time, points, data quality
    var strip = el('section', { class: 'pf-strip', 'aria-label': 'Current sprint' });
    strip.appendChild(kv('Sprint', sprint.name));
    strip.appendChild(kv('Dates', sprint.startDate + ' – ' + sprint.endDate + (dayTotal ? ' (' + dayTotal + ' days)' : '')));
    var prog = el('div', { class: 'pf-kv pf-progress' });
    prog.appendChild(el('div', { class: 'pf-kv-label', text: 'Done (points) vs sprint time' }));
    prog.appendChild(el('div', { class: 'pf-kv-value' }, [document.createTextNode(num(doneInP) + ' / ' + num(sprint.points) + ' points' + (donePct !== null ? ' (' + donePct + '%)' : '')), badge('approx', 'Approximate: final points; status-category change date used as the Done date; only tickets closed since the sprint start count')]));
    var pr1 = el('div', { class: 'pf-pace' }); pr1.appendChild(el('span', { class: 'pf-pace-cap', text: 'Done' })); pr1.appendChild(bar(donePct !== null ? donePct / 100 : 0)); prog.appendChild(pr1);
    var pr2 = el('div', { class: 'pf-pace' }); pr2.appendChild(el('span', { class: 'pf-pace-cap', text: 'Time' })); pr2.appendChild(bar(elapsedPct !== null ? elapsedPct / 100 : 0, 'pf-fill-time')); pr2.appendChild(el('span', { class: 'pf-pace-num', text: elapsedPct !== null ? elapsedPct + '% elapsed' : 'n/a' })); prog.appendChild(pr2);
    prog.appendChild(el('div', { class: 'pf-progress-tickets', text: num(doneInT) + ' / ' + num(sprint.tickets) + ' tickets closed in the sprint' + (doneTicketsPct !== null ? ' (' + doneTicketsPct + '%)' : '') + (preT ? ' · ' + num(preT) + ' already Done before it started' : '') }));
    strip.appendChild(prog);
    var dq = el('div', { class: 'pf-dq', 'aria-label': 'Data quality' });
    dq.appendChild(el('div', { class: 'pf-kv-label', text: 'How reliable is the data? (% of tickets filled)' }));
    var chips = el('div', { class: 'pf-chips' });
    var DQ_LOW = 50, lowFields = [];
    [['Points filled', sprint.pointsFillPct, 'Points'], ['Tester filled', sprint.testerFillPct, 'Tester'], ['Fix version filled', sprint.fixVersionFillPct, 'Fix version'], ['Parent filled', sprint.parentFillPct, 'Parent']].forEach(function (c) {
      var low = typeof c[1] === 'number' && c[1] < DQ_LOW;
      if (low) lowFields.push(c[2] + ' ' + c[1] + '%');
      chips.appendChild(el('span', { class: 'pf-chip' + (low ? ' pf-chip-low' : ''), title: low ? 'Under ' + DQ_LOW + '% of the tickets have this field' : null, text: c[0] + ' ' + c[1] + '%' }));
    });
    dq.appendChild(chips);
    if (lowFields.length) dq.appendChild(el('p', { class: 'pf-dq-note', title: 'Numbers that depend on these fields are incomplete.', text: 'Low fill (under ' + DQ_LOW + '%): ' + lowFields.join(', ') }));
    strip.appendChild(dq);
    app.appendChild(strip);

    // main: two columns of two tiles
    var main = el('div', { class: 'pf-main' });
    var left = el('div', { class: 'pf-col' }), right = el('div', { class: 'pf-col' });
    left.appendChild(velocityTile(data)); left.appendChild(healthTile(data));
    right.appendChild(burndownTile(data)); right.appendChild(backlogTile(data));
    main.appendChild(left); main.appendChild(right);
    app.appendChild(main);

    // flow metrics section — present when data.flow exists; works for any team
    if (data.flow) {
      var flow = data.flow;
      var curSp = flow.sprints && flow.sprints[sprint.id];
      var lastClosedId = null;
      var sprintIds = Object.keys(flow.sprints || {}).map(Number).sort();
      for (var fi = sprintIds.length - 1; fi >= 0; fi--) {
        if (flow.sprints[sprintIds[fi]].carryoverAge_atClose !== null) { lastClosedId = sprintIds[fi]; break; }
      }
      var lastSp = lastClosedId ? flow.sprints[lastClosedId] : null;

      var flowSec = el('section', { class: 'pf-flow', 'aria-label': 'Flow metrics (changelog)' });
      flowSec.appendChild(el('h3', { class: 'pf-flow-heading', text: 'Flow metrics (from Jira changelogs · ' + data.label + ')' }));
      var flowGrid = el('div', { class: 'pf-flow-grid' });

      // Tile 1: Scope change — last closed sprint
      var sc1 = el('div', { class: 'pf-flow-tile' });
      sc1.appendChild(el('div', { class: 'pf-flow-tile-title', text: 'Scope change (last closed sprint)' }));
      if (lastSp) {
        var sc = lastSp.scopeChange;
        var ptsNote = flow.pointsMostlyMissing ? ' (most tickets unpointed)' : '';
        var ptsStr = flow.pointsMostlyMissing ? '—' : ((sc.startingScope_points || 0) + ' pts');
        sc1.appendChild(el('div', { class: 'pf-flow-kv', text: 'Starting scope: ' + sc.startingScope_tickets + ' tickets · ' + ptsStr + ptsNote }));
        sc1.appendChild(el('div', { class: 'pf-flow-kv', text: 'Added after start: ' + sc.addedAfterStart_total_tickets + ' tickets (new: ' + sc.addedAfterStart_createdNew_tickets + ' · moved in: ' + sc.addedAfterStart_movedIn_tickets + ')' }));
        sc1.appendChild(el('div', { class: 'pf-flow-kv', text: 'Removed not done: ' + sc.removedNotDone_tickets + ' tickets (' + sc.removedRolledToLaterSprint_tickets + ' moved to a later sprint · ' + sc.removedDropped_tickets + ' dropped)' }));
        sc1.appendChild(el('div', { class: 'pf-flow-sprint', text: lastSp.sprintName }));
      } else {
        sc1.appendChild(el('div', { class: 'pf-flow-kv', text: 'No closed sprint data.' }));
      }
      flowGrid.appendChild(sc1);

      // Tile 2: Cycle time — closed sprints
      var ct2 = el('div', { class: 'pf-flow-tile' });
      ct2.appendChild(el('div', { class: 'pf-flow-tile-title', text: 'Cycle time (first In Progress → Done)' }));
      var ctRows = sprintIds.filter(function(s){ return flow.sprints[s].carryoverAge_atClose !== null; });
      if (ctRows.length) {
        ctRows.forEach(function(s) {
          var ct = flow.sprints[s].cycleTime;
          var nStr = ct.doneTicketsWithCycleTime ? ct.doneTicketsWithCycleTime + ' tickets' : '—';
          var lc = ct.lowConfidence ? '~' : '';
          var row = (ct.medianCycleDays !== null ? lc + 'Median ' + ct.medianCycleDays + 'd · p85 ' + ct.p85CycleDays + 'd (' + nStr + ')' : '—');
          ct2.appendChild(el('div', { class: 'pf-flow-kv', text: flow.sprints[s].sprintName + ': ' + row }));
        });
      } else {
        ct2.appendChild(el('div', { class: 'pf-flow-kv', text: 'No data.' }));
      }
      flowGrid.appendChild(ct2);

      // Tile 3: Sprint age distribution (current sprint)
      var co3 = el('div', { class: 'pf-flow-tile' });
      co3.appendChild(el('div', { class: 'pf-flow-tile-title', text: 'Sprint age distribution (all boards, current sprint)' }));
      if (curSp && curSp.carryoverAge_inSprint) {
        var co = curSp.carryoverAge_inSprint;
        co3.appendChild(el('div', { class: 'pf-flow-kv', text: 'In 1st sprint: ' + co.first + ' · 2nd: ' + co.second + ' · 3rd+: ' + co.third_plus }));
        var ag = curSp.currentStatusAging;
        if (ag) {
          var b = ag.ageBuckets;
          co3.appendChild(el('div', { class: 'pf-flow-kv', text: 'Status age: 0–2d ' + b['0-2d'] + ' · 3–6d ' + b['3-6d'] + ' · 7–13d ' + b['7-13d'] + ' · 14+d ' + b['14+d'] + ' (of ' + ag.openTickets + ' open tickets)' }));
        }
        co3.appendChild(el('div', { class: 'pf-flow-sprint', text: curSp.sprintName }));
      } else {
        co3.appendChild(el('div', { class: 'pf-flow-kv', text: 'No data.' }));
      }
      flowGrid.appendChild(co3);

      flowSec.appendChild(flowGrid);
      flowSec.appendChild(el('p', { class: 'pf-flow-note', text: (flow.dataDate || '') + ' · changelog-based · sprint age counts all boards · ' + (flow.completenessNote || '') }));
      app.appendChild(flowSec);
    }
  }

  // ── team list (no ?project=) ─────────────────────────────────────────────
  function renderList(manifest) {
    AF.clear(app);
    app.classList.add('portfolio-view');
    var box = el('div', { class: 'pf-top' });
    box.appendChild(el('h2', { class: 'pf-team-title', text: 'Portfolio' }));
    box.appendChild(el('p', { class: 'pf-select-hint', text: 'Choose a team from the Portfolio ▾ menu above, or open one here:' }));
    var ul = el('ul', { class: 'pf-team-list' });
    manifest.projects.forEach(function (p) {
      ul.appendChild(el('li', null, [el('a', { href: 'portfolio.html?project=' + encodeURIComponent(p.key), text: p.label })]));
    });
    box.appendChild(ul);
    box.appendChild(renderLegend());
    app.appendChild(box);
  }

  // ── main ─────────────────────────────────────────────────────────────────
  AF.loadJson(MANIFEST_FILE).then(function (manifest) {
    if (!manifest || !Array.isArray(manifest.projects)) throw new Error('missing projects array in ' + MANIFEST_FILE);
    var key = AF.urlParam('project');
    if (key) {
      var pmLink = document.getElementById('pm-' + key);
      if (pmLink) pmLink.setAttribute('aria-current', 'true');
    }
    if (!key) { renderList(manifest); return; }
    var entry = manifest.projects.filter(function (p) { return p.key === key; })[0];
    if (!entry) {
      AF.clear(app);
      app.classList.add('portfolio-view');
      AF.emptyMessage(app, 'Unknown project "' + key + '"', 'Choose a project from the Portfolio ▾ menu above.');
      return;
    }
    return AF.loadJson(entry.file).then(function (data) {
      if (!data || !data.team) throw new Error('invalid team file');
      try { renderTeam(data); } catch (err) { AF.showRenderError(app, err); }
    }, function (err) { AF.showError(app, entry.file, err); });
  }, function (err) { AF.showError(app, MANIFEST_FILE, err); });

})();
