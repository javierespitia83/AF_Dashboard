/* portfolio.js — multi-team portfolio snapshot page. Version 1 (search only, no changelogs).
 * Reads portfolio/projects.json (manifest), then portfolio/<KEY>.json (team data).
 * ?project=<KEY> selects the team; unknown or missing KEY shows an empty state.
 * No names, e-mails, ticket keys or summaries in any data file.
 */
(function () {
  'use strict';
  var AF = window.AF, el = AF.el, app = document.getElementById('app');
  var MANIFEST_FILE = 'portfolio/projects.json';
  var PROJECTS_ALLOWED_PATTERN = /^[A-Z][A-Z0-9]+$/;

  // ── helpers ──────────────────────────────────────────────────────────────
  function shown(value) {
    return value === null || value === undefined || value === '' ? 'n/a' : String(value);
  }

  function pct(n, total) {
    if (!total) return 'n/a';
    return Math.round(100 * n / total) + '%';
  }

  function kv(label, valueNode, methodText, approx) {
    var cell = el('div', { class: 'pf-kv' });
    cell.appendChild(el('div', { class: 'pf-kv-label', text: label }));
    var val = el('div', { class: 'pf-kv-value' });
    if (typeof valueNode === 'string' || typeof valueNode === 'number') {
      val.textContent = String(valueNode);
    } else if (valueNode) {
      val.appendChild(valueNode);
    }
    if (approx === 'lower') {
      var lb = el('abbr', { class: 'approx-badge approx-lower', title: 'Lower bound — sprint CHANGED JQL is not supported; count uses tickets created after sprint start' });
      lb.textContent = '≥';
      val.appendChild(lb);
    } else if (approx) {
      var b = el('abbr', { class: 'approx-badge', title: methodText || 'Approximate' });
      b.textContent = '≈';
      val.appendChild(b);
    }
    cell.appendChild(val);
    if (methodText) {
      var note = el('div', { class: 'pf-kv-method', text: methodText });
      cell.appendChild(note);
    }
    return cell;
  }

  // ── burndown mini-chart ───────────────────────────────────────────────────
  function burndownChart(bdata) {
    var days = bdata.days;
    if (!days || !days.length) return el('p', { class: 'empty', text: 'n/a' });
    var NS = 'http://www.w3.org/2000/svg';
    var W = 560, H = 236, L = 46, R = 14, T = 24, B = 34;
    var maxR = 0, i;
    for (i = 0; i < days.length; i++) { if (days[i][1] > maxR) maxR = days[i][1]; }
    if (!maxR) maxR = 1;
    var n = days.length;
    function X(idx) { return L + (n > 1 ? idx / (n - 1) : 0) * (W - L - R); }
    function Y(v) { return T + (H - T - B) * (1 - v / maxR); }
    function node(name, attrs, text) {
      var e = document.createElementNS(NS, name);
      for (var k in attrs) { if (Object.prototype.hasOwnProperty.call(attrs, k)) e.setAttribute(k, attrs[k]); }
      if (text != null) e.textContent = text;
      return e;
    }
    function shortDate(s) { return s.slice(5).replace('-', '/'); }
    var svg = node('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'class': 'pf-burn',
      'aria-label': 'Burndown: story points remaining per day, from ' + days[0][0] + ' to ' + days[n - 1][0] });
    var ticks = [0, Math.round(maxR / 2), maxR];
    for (i = 0; i < ticks.length; i++) {
      svg.appendChild(node('line', { x1: L, x2: W - R, y1: Y(ticks[i]), y2: Y(ticks[i]), stroke: '#dde2ea', 'stroke-width': 1 }));
      svg.appendChild(node('text', { x: L - 6, y: Y(ticks[i]) + 4, 'text-anchor': 'end', 'font-size': 11, fill: '#5b6676' }, String(ticks[i])));
    }
    svg.appendChild(node('text', { x: 4, y: 12, 'font-size': 11, fill: '#5b6676' }, 'points remaining'));
    var xs = [0, Math.floor((n - 1) / 2), n - 1];
    for (i = 0; i < xs.length; i++) {
      if (i > 0 && xs[i] === xs[i - 1]) continue;
      svg.appendChild(node('text', { x: X(xs[i]), y: H - 12, 'text-anchor': i === 0 ? 'start' : (i === 2 ? 'end' : 'middle'), 'font-size': 11, fill: '#5b6676' }, shortDate(days[xs[i]][0])));
    }
    svg.appendChild(node('line', { x1: X(0), y1: Y(days[0][1]), x2: X(n - 1), y2: Y(0), stroke: '#8a94a6', 'stroke-width': 1.5, 'stroke-dasharray': '5 4' }));
    var pts = [];
    for (i = 0; i < n; i++) { pts.push(X(i).toFixed(1) + ',' + Y(days[i][1]).toFixed(1)); }
    svg.appendChild(node('polyline', { points: pts.join(' '), fill: 'none', stroke: '#1f6f64', 'stroke-width': 2.5 }));
    for (i = 0; i < n; i++) {
      var c = node('circle', { cx: X(i).toFixed(1), cy: Y(days[i][1]).toFixed(1), r: 3.5, fill: '#1f6f64' });
      c.appendChild(node('title', {}, days[i][0] + ': ' + days[i][1] + ' points remaining'));
      svg.appendChild(c);
    }
    var wrap = el('div', { class: 'pf-burn-wrap' });
    wrap.appendChild(svg);
    var legend = el('p', { class: 'pf-burn-cap' });
    legend.appendChild(el('span', { class: 'pf-lg pf-lg-real', text: '━ Points remaining (≈)' }));
    legend.appendChild(el('span', { class: 'pf-lg pf-lg-ideal', text: '┄ Ideal line' }));
    legend.appendChild(el('span', { text: bdata.sprintName + ' · ' + shortDate(days[0][0]) + ' to ' + shortDate(days[n - 1][0]) }));
    wrap.appendChild(legend);
    return wrap;
  }

  // ── legend ──────────────────────────────────────────────────────────────
  function renderLegend() {
    var det = el('details', { class: 'pf-legend' });
    var sum = el('summary', { text: 'Legend: symbols and units' });
    det.appendChild(sum);
    var body = el('div', { class: 'pf-legend-body' });
    body.appendChild(el('div', { text: '≈ = approximate value (method shown in tooltip)' }));
    body.appendChild(el('div', { text: '≥ = lower bound (actual value is equal or higher)' }));
    body.appendChild(el('div', { text: 'tickets = work items (Jira issues in the sprint or backlog)' }));
    body.appendChild(el('div', { text: 'points = Story Points as recorded in Jira — meaning not confirmed per team' }));
    det.appendChild(body);
    return det;
  }

  // ── render team ──────────────────────────────────────────────────────────
  function renderTeam(data) {
    AF.clear(app);
    app.classList.add('portfolio-view');
    AF.setUpdated(data.refreshedAt, data.exportedAt);

    var sprint = data.currentSprint;
    var dayN = null, dayTotal = null;
    if (sprint.startDate && sprint.endDate) {
      var s = new Date(sprint.startDate + 'T00:00:00'), e = new Date(sprint.endDate + 'T00:00:00'), t = new Date();
      dayTotal = Math.round((e - s) / 864e5) + 1;
      dayN = Math.min(dayTotal, Math.max(1, Math.round((t - s) / 864e5) + 1));
    }

    // title bar + legend
    var titleBar = el('div', { class: 'pf-title-bar' });
    titleBar.appendChild(el('h2', { class: 'pf-team-title', text: data.label }));
    if (data.pointsNote) {
      titleBar.appendChild(el('p', { class: 'pf-points-note', text: 'ℹ️ ' + data.pointsNote }));
    }
    app.appendChild(titleBar);
    app.appendChild(renderLegend());

    // past-end-date warning
    if (sprint.pastEndDate) {
      var daysOver = '';
      if (sprint.endDate) {
        var eEnd = new Date(sprint.endDate + 'T00:00:00');
        var dOver = Math.round((new Date() - eEnd) / 864e5);
        if (dOver > 0) daysOver = ' (' + dOver + ' days past the planned end date of ' + sprint.endDate + ')';
      }
      var warn = el('div', { class: 'pf-warn', role: 'alert' });
      warn.textContent = '⚠️ Sprint past end date' + daysOver + '. The sprint may still be active in Jira but has not been closed.';
      app.appendChild(warn);
    }

    // ── build tiles (not yet appended) ──

    // current sprint tile
    var spTile = el('section', { class: 'tile pf-tile', 'aria-label': 'Current sprint' });
    spTile.appendChild(el('div', { class: 'tile-head' }, [el('h3', { text: 'Current sprint' })]));
    var spBody = el('div', { class: 'tile-body pf-kv-grid' });
    spBody.appendChild(kv('Sprint', sprint.name));
    spBody.appendChild(kv('Dates', sprint.startDate + ' – ' + sprint.endDate));
    spBody.appendChild(kv('Day', dayN !== null ? ('Day ' + dayN + ' of ' + dayTotal + ' calendar days') : 'n/a'));
    var donePct = sprint.tickets ? Math.round(100 * sprint.doneTickets / sprint.tickets) : null;
    var doneTxt = sprint.doneTickets + ' / ' + sprint.tickets + ' tickets';
    if (donePct !== null) doneTxt += ' (' + donePct + '% done)';
    spBody.appendChild(kv('Done (tickets)', doneTxt, 'Approximate: statusCategoryChangedDate used as Done date; scope = current list', true));
    spBody.appendChild(kv('Points (story points)', sprint.points + ' scope ∙ ' + sprint.donePoints + ' done', 'Approximate; final points used', true));
    spTile.appendChild(spBody);

    // data quality tile
    var dqTile = el('section', { class: 'tile pf-tile', 'aria-label': 'Data quality' });
    dqTile.appendChild(el('div', { class: 'tile-head' }, [el('h3', { text: 'Data quality (current sprint)' })]));
    var dqBody = el('div', { class: 'tile-body pf-kv-grid' });
    dqBody.appendChild(kv('Points filled', sprint.pointsFillPct + '% of tickets'));
    dqBody.appendChild(kv('Tester filled', sprint.testerFillPct + '% of tickets'));
    dqBody.appendChild(kv('Fix version filled', sprint.fixVersionFillPct + '% of tickets'));
    dqBody.appendChild(kv('Parent filled', sprint.parentFillPct + '% of tickets'));
    dqTile.appendChild(dqBody);

    // velocity tile
    var velTile = el('section', { class: 'tile pf-tile', 'aria-label': 'Velocity' });
    velTile.appendChild(el('div', { class: 'tile-head' }, [el('h3', { text: 'Velocity ≈ (last 3 closed sprints)' })]));
    var velBody = el('div', { class: 'tile-body' });
    if (data.velocity && data.velocity.length) {
      var velWrap = el('div', { class: 'pf-vel-wrap' });
      var tbl = el('table', { class: 'data pf-vel-table' });
      var thead = el('thead', null, [el('tr', null, [
        el('th', { scope: 'col', text: 'Sprint' }),
        el('th', { scope: 'col', text: 'Scope (tickets)' }),
        el('th', { scope: 'col', text: 'Done (tickets, %) ≈' }),
        el('th', { scope: 'col', text: 'Scope (points)' }),
        el('th', { scope: 'col', text: 'Done (points) ≈' }),
        el('th', { scope: 'col', text: 'Carried to next (tickets) ≈' }),
        el('th', { scope: 'col', text: 'Created after start (tickets) ≥' }),
        el('th', { scope: 'col', text: 'Closed late (days)' })
      ])]);
      tbl.appendChild(thead);
      var tbody = el('tbody');
      data.velocity.forEach(function (v) {
        var compPct = v.completionTicketsPct + '%';
        var late = v.closedLateDays > 0 ? ('+' + v.closedLateDays + ' days after planned end') : '—';
        var lateCell = el('td', { text: late });
        if (v.closedLateDays > 0) lateCell.setAttribute('class', 'pf-late');
        var createdAfter = v.createdAfterStart != null ? String(v.createdAfterStart) : 'n/a';
        tbody.appendChild(el('tr', null, [
          el('td', { text: v.name }),
          el('td', { text: String(v.scopeTickets) }),
          el('td', { text: v.doneTickets + ' (' + compPct + ')' }),
          el('td', { text: String(v.scopePoints) }),
          el('td', { text: String(v.donePoints) }),
          el('td', { text: String(v.carriedToNext) }),
          el('td', { text: createdAfter }),
          lateCell
        ]));
      });
      tbl.appendChild(tbody);
      velWrap.appendChild(tbl);
      velBody.appendChild(velWrap);
      velBody.appendChild(el('p', { class: 'pf-note', text: 'Scope = end-of-sprint list (tickets). Completion may differ from Jira\'s own report. Points created after start: not available.' }));
    } else {
      velBody.appendChild(el('p', { class: 'empty', text: 'No velocity data available.' }));
    }
    velTile.appendChild(velBody);

    // burndown tile
    var burnTile = el('section', { class: 'tile pf-tile', 'aria-label': 'Burndown' });
    burnTile.appendChild(el('div', { class: 'tile-head' }, [el('h3', { text: 'Burndown of the last closed sprint (story points remaining) ≈' })]));
    var burnBody = el('div', { class: 'tile-body' });
    if (data.burndownLastClosed && data.burndownLastClosed.days && data.burndownLastClosed.days.length) {
      burnBody.appendChild(burndownChart(data.burndownLastClosed));
      burnBody.appendChild(el('p', { class: 'pf-note', text: '≈ ' + data.burndownLastClosed.method }));
    } else {
      burnBody.appendChild(el('p', { class: 'empty', text: 'n/a' }));
    }
    burnTile.appendChild(burnBody);

    // sprint health tile
    var stuckTile = el('section', { class: 'tile pf-tile', 'aria-label': 'Sprint health' });
    stuckTile.appendChild(el('div', { class: 'tile-head' }, [el('h3', { text: 'Sprint health' })]));
    var stuckBody = el('div', { class: 'tile-body pf-kv-grid' });
    stuckBody.appendChild(kv('Stuck 7+ days (tickets)', sprint.stuckD7, 'In Progress, NOT status CHANGED AFTER -7d'));
    stuckBody.appendChild(kv('Stuck 14+ days (tickets)', sprint.stuckD14, 'In Progress, NOT status CHANGED AFTER -14d'));
    stuckBody.appendChild(kv('Carried in (tickets)', sprint.carriedIn, 'Tickets also in previous sprint; approximate', true));
    stuckBody.appendChild(kv('Created after sprint start (tickets)', sprint.createdAfterStart, 'Lower bound: tickets created after sprint startDate; sprint CHANGED JQL not supported', 'lower'));
    stuckBody.appendChild(kv('Bugs in sprint (tickets)', sprint.bugsInSprint));
    stuckBody.appendChild(kv('Bugs created, last 14 days (tickets)', shown(data.bugsCreated14d)));
    stuckBody.appendChild(kv('All tickets created, last 14 days', shown(data.ticketsCreated14d), data.ticketsCreated14d != null ? 'All issue types in the project, created >= -14d' : null));
    stuckBody.appendChild(kv('Team size (people with tickets)', sprint.teamSize, 'Distinct assignees in current sprint; no names stored'));
    stuckTile.appendChild(stuckBody);

    // backlog tile
    var blTile = el('section', { class: 'tile pf-tile', 'aria-label': 'Backlog health' });
    blTile.appendChild(el('div', { class: 'tile-head' }, [el('h3', { text: 'Backlog health (tickets)' })]));
    var blBody = el('div', { class: 'tile-body pf-kv-grid' });
    var bl = data.backlog;
    blBody.appendChild(kv('Total backlog (tickets)', bl.total));
    blBody.appendChild(kv('> 90 days old (tickets)', bl.created90dPlus + ' (' + pct(bl.created90dPlus, bl.total) + ')', 'Age by created date; re-opened or moved items may appear older'));
    blBody.appendChild(kv('> 180 days old (tickets)', bl.created180dPlus + ' (' + pct(bl.created180dPlus, bl.total) + ')'));
    blBody.appendChild(kv('> 1 year old (tickets)', bl.created365dPlus + ' (' + pct(bl.created365dPlus, bl.total) + ')'));
    if (bl.notUpdated365d !== null && bl.notUpdated365d !== undefined) {
      blBody.appendChild(kv('Not updated in 1 year (tickets)', bl.notUpdated365d + ' (' + pct(bl.notUpdated365d, bl.total) + ')'));
    }
    blBody.appendChild(kv('No points (tickets)', bl.noPoints + ' (' + pct(bl.noPoints, bl.total) + ')'));
    blBody.appendChild(kv('No parent (tickets)', bl.noParent + ' (' + pct(bl.noParent, bl.total) + ')'));
    if (data.backlog.platNote) {
      blBody.appendChild(el('p', { class: 'pf-note', text: '* ' + data.backlog.platNote }));
    }
    blTile.appendChild(blBody);

    // ── assemble into dashboard rows ──
    // Row 1: Current Sprint + Data Quality
    var row1 = el('div', { class: 'pf-row pf-row-top' });
    row1.appendChild(spTile);
    row1.appendChild(dqTile);
    app.appendChild(row1);

    // Row 2: Velocity + Burndown
    var row2 = el('div', { class: 'pf-row pf-row-mid' });
    row2.appendChild(velTile);
    row2.appendChild(burnTile);
    app.appendChild(row2);

    // Row 3: Sprint Health + Backlog Health
    var row3 = el('div', { class: 'pf-row pf-row-bot' });
    row3.appendChild(stuckTile);
    row3.appendChild(blTile);
    app.appendChild(row3);
  }

  // ── render comparison table ───────────────────────────────────────────────
  function renderComparison(allData) {
    var compTile = el('section', { class: 'tile pf-tile', 'aria-label': 'Comparison' });
    compTile.appendChild(el('div', { class: 'tile-head' }, [
      el('h3', { text: 'Comparison ≈ ≥' }),
      el('p', { class: 'sub', text: 'No ranking. Teams use different workflows and estimation practices.' })
    ]));
    var compBody = el('div', { class: 'tile-body' });
    var compWrap = el('div', { class: 'pf-comp-wrap' });
    var tbl = el('table', { class: 'data pf-comp-table' });
    var thead = el('thead', null, [el('tr', null, [
      el('th', { scope: 'col', text: 'Team' }),
      el('th', { scope: 'col', text: 'Sprint state' }),
      el('th', { scope: 'col', text: 'Done, 3 sprints (tickets, %) ≈' }),
      el('th', { scope: 'col', text: 'Carry-over (tickets) ≈' }),
      el('th', { scope: 'col', text: 'Stuck 7+ days (tickets)' }),
      el('th', { scope: 'col', text: 'Backlog (tickets)' }),
      el('th', { scope: 'col', text: '> 1 yr old (tickets)' }),
      el('th', { scope: 'col', text: 'Points filled (%)' })
    ])]);
    tbl.appendChild(thead);
    var tbody = el('tbody');
    allData.forEach(function (d) {
      if (!d) return;
      var sprint = d.currentSprint;
      var dayN = null, dayTotal = null;
      if (sprint.startDate && sprint.endDate) {
        var s = new Date(sprint.startDate + 'T00:00:00'), e = new Date(sprint.endDate + 'T00:00:00'), t = new Date();
        dayTotal = Math.round((e - s) / 864e5) + 1;
        dayN = Math.min(dayTotal, Math.max(1, Math.round((t - s) / 864e5) + 1));
      }
      var state = sprint.pastEndDate ? 'Past end date' : (dayN !== null ? ('Day ' + dayN + '/' + dayTotal) : 'n/a');
      var comps = (d.velocity || []).map(function (v) { return v.completionTicketsPct + '%'; }).join(' · ');
      var carries = (d.velocity || []).map(function (v) { return String(v.carriedToNext); }).join(' · ');
      var noteMarker = d.backlog.platNote ? ' *' : '';
      tbody.appendChild(el('tr', null, [
        el('td', { text: d.label }),
        el('td', { text: state }),
        el('td', { text: comps || 'n/a' }),
        el('td', { text: carries || 'n/a' }),
        el('td', { text: shown(sprint.stuckD7) }),
        el('td', { text: shown(d.backlog.total) + noteMarker }),
        el('td', { text: shown(d.backlog.created365dPlus) + ' (' + pct(d.backlog.created365dPlus, d.backlog.total) + ')' }),
        el('td', { text: sprint.pointsFillPct + '%' })
      ]));
    });
    tbl.appendChild(tbody);
    compWrap.appendChild(tbl);
    compBody.appendChild(compWrap);
    var notes = ['≈ approximate ≥ lower bound'];
    if (allData.some(function (d) { return d && d.backlog && d.backlog.platNote; })) {
      notes.push('* PLAT backlog covers the whole project, not only the Plat Core board.');
    }
    compBody.appendChild(el('p', { class: 'pf-note', text: notes.join(' ') }));
    compTile.appendChild(compBody);
    return compTile;
  }

  // ── main ─────────────────────────────────────────────────────────────────
  AF.loadJson(MANIFEST_FILE).then(function (manifest) {
    if (!manifest || !Array.isArray(manifest.projects)) throw new Error('missing projects array in ' + MANIFEST_FILE);
    var key = AF.urlParam('project');
    if (key) {
      var pmLink = document.getElementById('pm-' + key);
      if (pmLink) pmLink.setAttribute('aria-current', 'true');
    }
    if (!key) {
      var allLoads = manifest.projects.map(function (p) {
        return AF.loadJson(p.file).then(null, function () { return null; });
      });
      return Promise.all(allLoads).then(function (allData) {
        AF.clear(app);
        app.classList.add('portfolio-view');
        app.appendChild(el('p', { class: 'pf-select-hint', text: 'Choose a project from the Portfolio ▾ menu above, or view the comparison below.' }));
        app.appendChild(renderLegend());
        app.appendChild(renderComparison(allData));
      });
    }
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
