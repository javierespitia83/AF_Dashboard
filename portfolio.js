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

  function approxBadge(label) {
    var span = el('span', { class: 'approx-badge', title: 'Approximate value — method shown in the method tooltip' });
    span.textContent = '≈'; // ≈
    var full = el('span', { class: 'approx-label' });
    full.textContent = label ? label : '≈';
    return full;
  }

  function lowerBoundBadge() {
    var span = el('span', { class: 'approx-badge approx-lower', title: 'Lower bound — sprint CHANGED JQL is not supported; count uses tickets created after sprint start' });
    span.textContent = '≥'; // ≥
    return span;
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
    if (approx === 'lower') val.appendChild(lowerBoundBadge());
    else if (approx) {
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
    // bdata.days: [[date, remaining points], ...]
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
    // horizontal grid and y labels (points remaining)
    var ticks = [0, Math.round(maxR / 2), maxR];
    for (i = 0; i < ticks.length; i++) {
      svg.appendChild(node('line', { x1: L, x2: W - R, y1: Y(ticks[i]), y2: Y(ticks[i]), stroke: '#dde2ea', 'stroke-width': 1 }));
      svg.appendChild(node('text', { x: L - 6, y: Y(ticks[i]) + 4, 'text-anchor': 'end', 'font-size': 11, fill: '#5b6676' }, String(ticks[i])));
    }
    svg.appendChild(node('text', { x: 4, y: 12, 'font-size': 11, fill: '#5b6676' }, 'points remaining'));
    // x labels (dates): first, middle, last
    var xs = [0, Math.floor((n - 1) / 2), n - 1];
    for (i = 0; i < xs.length; i++) {
      if (i > 0 && xs[i] === xs[i - 1]) continue;
      svg.appendChild(node('text', { x: X(xs[i]), y: H - 12, 'text-anchor': i === 0 ? 'start' : (i === 2 ? 'end' : 'middle'), 'font-size': 11, fill: '#5b6676' }, shortDate(days[xs[i]][0])));
    }
    // ideal line: from the first value to 0 at the last day
    svg.appendChild(node('line', { x1: X(0), y1: Y(days[0][1]), x2: X(n - 1), y2: Y(0), stroke: '#8a94a6', 'stroke-width': 1.5, 'stroke-dasharray': '5 4' }));
    // remaining line and points with tooltips
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

  // ── render team ──────────────────────────────────────────────────────────
  function renderTeam(data) {
    AF.clear(app);
    AF.setUpdated(data.refreshedAt, data.exportedAt);

    var sprint = data.currentSprint;
    var dayN = null, dayTotal = null;
    if (sprint.startDate && sprint.endDate) {
      var s = new Date(sprint.startDate + 'T00:00:00'), e = new Date(sprint.endDate + 'T00:00:00'), t = new Date();
      dayTotal = Math.round((e - s) / 864e5) + 1;
      dayN = Math.min(dayTotal, Math.max(1, Math.round((t - s) / 864e5) + 1));
    }

    // title bar
    var titleBar = el('div', { class: 'pf-title-bar' });
    titleBar.appendChild(el('h2', { class: 'pf-team-title', text: data.label }));
    if (data.pointsNote) {
      titleBar.appendChild(el('p', { class: 'pf-points-note', text: 'ℹ️ ' + data.pointsNote }));
    }
    app.appendChild(titleBar);

    // past-end-date warning
    if (sprint.pastEndDate) {
      var warn = el('div', { class: 'pf-warn', role: 'alert' });
      warn.textContent = '⚠️ Sprint past end date. Sprint may still be active in Jira.';
      app.appendChild(warn);
    }

    // current sprint tile
    var spTile = el('section', { class: 'tile pf-tile', 'aria-label': 'Current sprint' });
    spTile.appendChild(el('div', { class: 'tile-head' }, [el('h3', { text: 'Current sprint' })]));
    var spBody = el('div', { class: 'tile-body pf-kv-grid' });
    spBody.appendChild(kv('Sprint', sprint.name));
    spBody.appendChild(kv('Dates', sprint.startDate + ' – ' + sprint.endDate));
    spBody.appendChild(kv('Day', dayN !== null ? (dayN + ' of ' + dayTotal) : 'n/a'));
    var donePct = sprint.tickets ? Math.round(100 * sprint.doneTickets / sprint.tickets) : null;
    var doneTxt = sprint.doneTickets + ' / ' + sprint.tickets + ' tickets';
    if (donePct !== null) doneTxt += ' (' + donePct + '%)';
    spBody.appendChild(kv('Done', doneTxt, 'Approximate: statusCategoryChangedDate used as Done date; scope = current list', true));
    spBody.appendChild(kv('Points', sprint.points + ' scope ∙ ' + sprint.donePoints + ' done', 'Approximate; final points used'));
    spTile.appendChild(spBody);
    app.appendChild(spTile);

    // velocity tile
    var velTile = el('section', { class: 'tile pf-tile', 'aria-label': 'Velocity' });
    velTile.appendChild(el('div', { class: 'tile-head' }, [el('h3', { text: 'Velocity ≈' })]));
    var velBody = el('div', { class: 'tile-body' });
    if (data.velocity && data.velocity.length) {
      var tbl = el('table', { class: 'data pf-vel-table' });
      var thead = el('thead', null, [el('tr', null, [
        el('th', { scope: 'col', text: 'Sprint' }),
        el('th', { scope: 'col', text: 'Scope' }),
        el('th', { scope: 'col', text: 'Done ≈', title: 'Approximate' }),
        el('th', { scope: 'col', text: 'Points ≈', title: 'Approximate' }),
        el('th', { scope: 'col', text: 'Carry ≈', title: 'Approximate: tickets in next sprint that were not Done at close' }),
        el('th', { scope: 'col', text: 'Late?' })
      ])]);
      tbl.appendChild(thead);
      var tbody = el('tbody');
      data.velocity.forEach(function (v) {
        var compPct = v.completionTicketsPct + '%';
        var late = v.closedLateDays > 0 ? ('+' + v.closedLateDays + ' d') : '—';
        var lateCell = el('td', { text: late });
        if (v.closedLateDays > 0) lateCell.setAttribute('class', 'pf-late');
        tbody.appendChild(el('tr', null, [
          el('td', { text: v.name }),
          el('td', { text: v.scopeTickets }),
          el('td', { text: v.doneTickets + ' (' + compPct + ')' }),
          el('td', { text: v.donePoints + ' / ' + v.scopePoints }),
          el('td', { text: v.carriedToNext }),
          lateCell
        ]));
      });
      tbl.appendChild(tbody);
      velBody.appendChild(tbl);
      velBody.appendChild(el('p', { class: 'pf-note', text: 'Scope = end-of-sprint list. Completion may differ from Jira’s own report.' }));
    } else {
      velBody.appendChild(el('p', { class: 'empty', text: 'No velocity data available.' }));
    }
    velTile.appendChild(velBody);
    app.appendChild(velTile);

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
    app.appendChild(burnTile);

    // data quality tile
    var dqTile = el('section', { class: 'tile pf-tile', 'aria-label': 'Data quality' });
    dqTile.appendChild(el('div', { class: 'tile-head' }, [el('h3', { text: 'Data quality (current sprint)' })]));
    var dqBody = el('div', { class: 'tile-body pf-kv-grid' });
    dqBody.appendChild(kv('Points filled', sprint.pointsFillPct + '%'));
    dqBody.appendChild(kv('Tester filled', sprint.testerFillPct + '%'));
    dqBody.appendChild(kv('Fix version filled', sprint.fixVersionFillPct + '%'));
    dqBody.appendChild(kv('Parent filled', sprint.parentFillPct + '%'));
    dqTile.appendChild(dqBody);
    app.appendChild(dqTile);

    // stuck + carry-over + bugs tile
    var stuckTile = el('section', { class: 'tile pf-tile', 'aria-label': 'Sprint health' });
    stuckTile.appendChild(el('div', { class: 'tile-head' }, [el('h3', { text: 'Sprint health' })]));
    var stuckBody = el('div', { class: 'tile-body pf-kv-grid' });
    stuckBody.appendChild(kv('Stuck 7+ days', sprint.stuckD7, 'In Progress, NOT status CHANGED AFTER -7d'));
    stuckBody.appendChild(kv('Stuck 14+ days', sprint.stuckD14, 'In Progress, NOT status CHANGED AFTER -14d'));
    stuckBody.appendChild(kv('Carried in ≈', sprint.carriedIn, 'Tickets also in previous sprint; approximate', true));
    stuckBody.appendChild(kv('Created after start ≥', sprint.createdAfterStart, 'Lower bound: tickets created after sprint startDate; sprint CHANGED JQL not supported', 'lower'));
    stuckBody.appendChild(kv('Bugs in sprint', sprint.bugsInSprint));
    stuckBody.appendChild(kv('Bugs created (14 d)', shown(data.bugsCreated14d)));
    stuckBody.appendChild(kv('Team size', sprint.teamSize, 'Distinct assignees in current sprint; no names stored'));
    stuckTile.appendChild(stuckBody);
    app.appendChild(stuckTile);

    // backlog tile
    var blTile = el('section', { class: 'tile pf-tile', 'aria-label': 'Backlog health' });
    blTile.appendChild(el('div', { class: 'tile-head' }, [el('h3', { text: 'Backlog health' })]));
    var blBody = el('div', { class: 'tile-body pf-kv-grid' });
    var bl = data.backlog;
    blBody.appendChild(kv('Total backlog', bl.total));
    blBody.appendChild(kv('> 90 days old', bl.created90dPlus + ' (' + pct(bl.created90dPlus, bl.total) + ')', 'Age by created date; re-opened or moved items may appear older'));
    blBody.appendChild(kv('> 180 days old', bl.created180dPlus + ' (' + pct(bl.created180dPlus, bl.total) + ')'));
    blBody.appendChild(kv('> 1 year old', bl.created365dPlus + ' (' + pct(bl.created365dPlus, bl.total) + ')'));
    if (bl.notUpdated365d !== null && bl.notUpdated365d !== undefined) {
      blBody.appendChild(kv('Not updated in 1 year', bl.notUpdated365d + ' (' + pct(bl.notUpdated365d, bl.total) + ')'));
    }
    blBody.appendChild(kv('No points', bl.noPoints + ' (' + pct(bl.noPoints, bl.total) + ')'));
    blBody.appendChild(kv('No parent', bl.noParent + ' (' + pct(bl.noParent, bl.total) + ')'));
    blTile.appendChild(blBody);
    app.appendChild(blTile);
  }

  // ── render comparison table ───────────────────────────────────────────────
  function renderComparison(allData) {
    var compTile = el('section', { class: 'tile pf-tile', 'aria-label': 'Comparison' });
    compTile.appendChild(el('div', { class: 'tile-head' }, [
      el('h3', { text: 'Comparison ≈ ≥' }),
      el('p', { class: 'sub', text: 'No ranking. Teams use different workflows and estimation practices.' })
    ]));
    var compBody = el('div', { class: 'tile-body' });
    var tbl = el('table', { class: 'data pf-comp-table' });
    var thead = el('thead', null, [el('tr', null, [
      el('th', { scope: 'col', text: 'Team' }),
      el('th', { scope: 'col', text: 'Sprint state' }),
      el('th', { scope: 'col', text: 'Done (3 sprints) ≈', title: 'Approximate' }),
      el('th', { scope: 'col', text: 'Carry-over ≈', title: 'Approximate' }),
      el('th', { scope: 'col', text: 'Stuck 7+ d' }),
      el('th', { scope: 'col', text: 'Backlog' }),
      el('th', { scope: 'col', text: '> 1 yr old' }),
      el('th', { scope: 'col', text: 'Points filled' })
    ])]);
    tbl.appendChild(thead);
    var tbody = el('tbody');
    allData.forEach(function (d) {
      if (!d) return;
      var sprint = d.currentSprint;
      var state = sprint.pastEndDate ? 'Past end date' : ('Day ' + (sprint.doneTickets !== null ? sprint.doneTickets : '?') + '/' + sprint.tickets);
      var dayN = null, dayTotal = null;
      if (sprint.startDate && sprint.endDate) {
        var s = new Date(sprint.startDate + 'T00:00:00'), e = new Date(sprint.endDate + 'T00:00:00'), t = new Date();
        dayTotal = Math.round((e - s) / 864e5) + 1;
        dayN = Math.min(dayTotal, Math.max(1, Math.round((t - s) / 864e5) + 1));
        state = sprint.pastEndDate ? 'Past end date' : ('Day ' + dayN + '/' + dayTotal);
      }
      var comps = (d.velocity || []).map(function (v) { return v.completionTicketsPct + '%'; }).join(' · ');
      var carries = (d.velocity || []).map(function (v) { return v.carriedToNext; }).join(' · ');
      var oldest = d.velocity && d.velocity.length ? d.velocity[d.velocity.length - 1].carriedToNext : 'n/a';
      tbody.appendChild(el('tr', null, [
        el('td', { text: d.label }),
        el('td', { text: state }),
        el('td', { text: comps || 'n/a' }),
        el('td', { text: carries || 'n/a' }),
        el('td', { text: shown(sprint.stuckD7) }),
        el('td', { text: shown(d.backlog.total) }),
        el('td', { text: shown(d.backlog.created365dPlus) + ' (' + pct(d.backlog.created365dPlus, d.backlog.total) + ')' }),
        el('td', { text: sprint.pointsFillPct + '%' })
      ]));
    });
    tbl.appendChild(tbody);
    compBody.appendChild(tbl);
    compBody.appendChild(el('p', { class: 'pf-note', text: '≈ approximate ≥ lower bound' }));
    compTile.appendChild(compBody);
    return compTile;
  }

  // ── main ─────────────────────────────────────────────────────────────────
  AF.loadJson(MANIFEST_FILE).then(function (manifest) {
    if (!manifest || !Array.isArray(manifest.projects)) throw new Error('missing projects array in ' + MANIFEST_FILE);
    var key = AF.urlParam('project');
    // mark current project in dropdown
    if (key) {
      var pmLink = document.getElementById('pm-' + key);
      if (pmLink) pmLink.setAttribute('aria-current', 'true');
    }
    // no ?project= → load all and show comparison only
    if (!key) {
      var allLoads = manifest.projects.map(function (p) {
        return AF.loadJson(p.file).then(null, function () { return null; });
      });
      return Promise.all(allLoads).then(function (allData) {
        AF.clear(app);
        app.appendChild(el('p', { class: 'pf-select-hint', text: 'Choose a project from the Portfolio ▾ menu above, or view the comparison below.' }));
        app.appendChild(renderComparison(allData));
      });
    }
    // validate key against manifest
    var entry = manifest.projects.filter(function (p) { return p.key === key; })[0];
    if (!entry) {
      AF.clear(app);
      AF.emptyMessage(app, 'Unknown project “' + key + '”', 'Choose a project from the Portfolio ▾ menu above.');
      return;
    }
    // load team file
    return AF.loadJson(entry.file).then(function (data) {
      if (!data || !data.team) throw new Error('invalid team file');
      try { renderTeam(data); } catch (err) { AF.showRenderError(app, err); }
    }, function (err) { AF.showError(app, entry.file, err); });
  }, function (err) { AF.showError(app, MANIFEST_FILE, err); });

})();
