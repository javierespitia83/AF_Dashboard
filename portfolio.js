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
  function burndownChart(bdata, h) {
    // bdata.days: [[date, remaining], ...]
    var days = bdata.days;
    if (!days || !days.length) return el('p', { class: 'empty', text: 'n/a' });
    var W = 280, H = h || 120, PAD = 8;
    var maxR = 0;
    for (var i = 0; i < days.length; i++) { if (days[i][1] > maxR) maxR = days[i][1]; }
    if (!maxR) maxR = 1;
    var n = days.length;
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', 'pf-burn');
    // ideal line (from maxR to 0)
    var ix1 = PAD, iy1 = PAD + (H - 2 * PAD) * (1 - maxR / maxR);
    var ix2 = W - PAD, iy2 = H - PAD;
    var ideal = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    ideal.setAttribute('x1', ix1); ideal.setAttribute('y1', iy1);
    ideal.setAttribute('x2', ix2); ideal.setAttribute('y2', iy2);
    ideal.setAttribute('stroke', '#aab'); ideal.setAttribute('stroke-width', '1');
    ideal.setAttribute('stroke-dasharray', '4 3');
    svg.appendChild(ideal);
    // remaining line
    var pts = days.map(function (d, idx) {
      var x = PAD + (idx / (n - 1)) * (W - 2 * PAD);
      var y = PAD + (H - 2 * PAD) * (1 - d[1] / maxR);
      return x.toFixed(1) + ',' + y.toFixed(1);
    });
    var poly = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    poly.setAttribute('points', pts.join(' '));
    poly.setAttribute('fill', 'none');
    poly.setAttribute('stroke', '#1f6f64');
    poly.setAttribute('stroke-width', '2');
    svg.appendChild(poly);
    var wrap = el('div', { class: 'pf-burn-wrap' });
    wrap.appendChild(svg);
    var cap = el('p', { class: 'pf-burn-cap', text: bdata.sprintName + ' ≈' });
    wrap.appendChild(cap);
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
    burnTile.appendChild(el('div', { class: 'tile-head' }, [el('h3', { text: 'Burndown (last closed sprint) ≈' })]));
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
