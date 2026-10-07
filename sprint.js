/* sprint.js — current-sprint page (index.html). Reads sprint.json only. Cross-filtering: SPEC §5. */
(function () {
  'use strict';
  var AF = window.AF, el = AF.el, fmt = AF.fmtNum;
  var app = document.getElementById('app');
  var barBox = document.getElementById('filterbar');
  var EMPTY = 'No work items match these filters. Remove a tag or use Reset all.';

  AF.loadSnapshot('sprint.json').then(init, function (err) { AF.showError(app, 'sprint.json', err); });

  function init(data) {
    var tickets = data.tickets;
    var sprint = data.sprint || null; // may be absent in older files (DATA_CONTRACT §2a)
    AF.setUpdated(data.refreshedAt);
    AF.clear(app);
    if (!tickets.length) {
      app.appendChild(el('section', { class: 'message neutral' }, [
        el('h2', { text: 'No tickets in this snapshot' }),
        el('p', { text: 'Update the tracker, run python3 05_Automation/export_dashboard_snapshots.py, and reload.' })
      ]));
      return;
    }

    var NONE = AF.NONE;
    var store = AF.createStore({
      status: { label: 'Status', get: function (t) { return AF.BUCKETS[AF.bucketOf(t.status)]; } },
      assignee: { label: 'Assignee', get: function (t) { return AF.personName(t.owner); } },
      tester: { label: 'Tester', get: function (t) { return AF.personName(t.tester); } },
      fix: { label: 'Fix version', get: function (t) { return AF.isBlank(t.fixVersion) ? NONE : String(t.fixVersion); } },
      parent: { label: 'Parent', get: function (t) { return AF.isBlank(t.parent) ? NONE : String(t.parent); } }
    });
    var owner = function (t) { return AF.personName(t.owner); };
    var tester = function (t) { return AF.personName(t.tester); };
    var hasOther = tickets.some(function (t) { return AF.bucketOf(t.status) === AF.OTHER; });
    var visible = [0, 1, 2, 3].concat(hasOther ? [AF.OTHER] : []);

    // ---- shell: KPI strip, main row, detail ----
    function kpi(kind, label) {
      var value = el('div', { class: 'value' }), hint = el('div', { class: 'hint' });
      return { root: el('section', { class: 'tile kpi ' + kind }, [el('div', { class: 'label', text: label }), value, hint]), value: value, hint: hint };
    }
    var kItems = kpi('items', 'Work items'), kPoints = kpi('points', 'Story points');
    var kDone = kpi('plain', 'Done'), kNoTester = kpi('plain', 'No tester');
    var kCycle = kpi('plain', 'Avg cycle time'), kMid = kpi('plain', 'Added mid-sprint'), kCarried = kpi('plain', 'Carried over');
    kCarried.root.title = 'Carried over from the previous sprint. Click to filter the lower section; ticket keys must be present in sprint.json.';
    kMid.root.title = 'Tickets added after the first days of the sprint, based on Added to Sprint dates.';
    var tBurn = AF.tile({ title: 'Burndown', sub: '' });
    tBurn.body.classList.add('chart');
    var tStatus = AF.tile({ title: 'Tickets by status', sub: 'Click a status to filter' });
    var tAssignee = AF.tile({ title: 'Work by assignee', sub: 'Story points on owned tickets' });
    var tTester = AF.tile({ title: 'Work by tester', sub: 'Points on tickets they test' });
    tTester.head.appendChild(el('p', { class: 'sub', text: 'Assignee and tester views overlap by design. The sprint total counts each ticket once.' }));
    var tMatrix = AF.tile({ title: 'Assignee x tester', sub: 'Work items per pair. Click a cell to filter both.' });
    var tDetail = AF.tile({ title: 'Ticket detail', sub: '' });
    var lowerFilter = null;
    var hasDashboardFilters = store.isActive;
    store.isActive = function () { return !!lowerFilter || hasDashboardFilters(); };
    var carriedKeys = sprint && sprint.carriedOver && Array.isArray(sprint.carriedOver.ticketKeys)
      ? sprint.carriedOver.ticketKeys : null;

    function noTesterAndNotDevToTest(t) {
      var isDevToTest = String(t.classifications || '').split('; ').indexOf('Dev to Test') !== -1;
      var testerMissing = t.tester == null || String(t.tester).trim() === '' || String(t.tester).trim() === 'Unassigned';
      return testerMissing && !isDevToTest;
    }
    function matchesLowerFilter(t) {
      if (lowerFilter === 'noTester') return noTesterAndNotDevToTest(t);
      if (lowerFilter === 'midSprint') {
        var mid = AF.midSprintAdded([t], sprint, AF.config.midSprintThresholdDays);
        return !!(mid && mid.count);
      }
      if (lowerFilter === 'carriedOver') return !!(carriedKeys && carriedKeys.indexOf(t.ticket) !== -1);
      return true;
    }
    function syncLowerKpis() {
      [kMid, kCarried, kNoTester].forEach(function (kpi) {
        var selected =
          (kpi === kMid && lowerFilter === 'midSprint') ||
          (kpi === kCarried && lowerFilter === 'carriedOver') ||
          (kpi === kNoTester && lowerFilter === 'noTester');
        kpi.root.classList.toggle('selected', selected);
        kpi.root.setAttribute('aria-pressed', selected ? 'true' : 'false');
      });
    }
    function setLowerFilter(name) {
      if (name === 'carriedOver' && !carriedKeys) lowerFilter = name;
      else lowerFilter = lowerFilter === name ? null : name;
      syncLowerKpis();
      renderLower();
      updateBar();
    }
    var baseTags = store.tags;
    store.tags = function () {
      var tags = baseTags();
      if (lowerFilter) {
        var labels = { midSprint: 'Added mid-sprint', carriedOver: 'Carried over', noTester: 'No tester' };
        tags.push({ dim: '__kpi', label: 'KPI', value: labels[lowerFilter] || lowerFilter });
      }
      return tags;
    };
    var baseRemove = store.remove;
    store.remove = function (dim, value) {
      if (dim === '__kpi') { setLowerFilter(lowerFilter); return; }
      baseRemove(dim, value);
    };
    [[kMid, 'midSprint'], [kNoTester, 'noTester']].concat(carriedKeys ? [[kCarried, 'carriedOver']] : []).forEach(function (entry) {
      entry[0].root.classList.add('clickable');
      entry[0].root.setAttribute('role', 'button');
      entry[0].root.setAttribute('tabindex', '0');
      entry[0].root.setAttribute('aria-pressed', 'false');
      entry[0].root.addEventListener('click', function () { setLowerFilter(entry[1]); });
      entry[0].root.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault(); setLowerFilter(entry[1]);
        }
      });
    });
    var resetFilters = store.reset;
    store.reset = function () {
      lowerFilter = null;
      syncLowerKpis();
      resetFilters();
    };

    app.appendChild(el('div', { class: 'kpis k7' }, [kItems.root, kPoints.root, kDone.root, kMid.root, kCarried.root, kNoTester.root, kCycle.root]));
    app.appendChild(el('div', { class: 'main sprint' }, [tBurn.root, tStatus.root, tAssignee.root, tTester.root]));
    app.appendChild(el('div', { class: 'lower' }, [tDetail.root, tMatrix.root]));

    // ---- filter bar controls (Fix version, Parent) ----
    function selectCtl(dim, label, values) {
      var sel = el('select', {
        id: 'f-' + dim, 'aria-label': label,
        onchange: function () {
          if (sel.value === '') store.set(dim, []);
          else if (sel.value !== '__multi') store.set(dim, [sel.value]);
        }
      }, [el('option', { value: '', text: 'All' })]
        .concat(values.map(function (v) { return el('option', { value: v, text: v }); }))
        .concat([el('option', { value: '__multi', text: 'Multiple', disabled: true })]));
      return { sel: sel, root: el('div', { class: 'ctl' }, [el('label', { for: 'f-' + dim, text: label }), sel]) };
    }
    function distinct(fn) {
      var seen = {}; tickets.forEach(function (t) { seen[fn(t)] = true; });
      var keys = Object.keys(seen).filter(function (k) { return k !== NONE; }).sort();
      return seen[NONE] ? keys.concat([NONE]) : keys;
    }
    var fixCtl = selectCtl('fix', 'Fix version', distinct(store.dims.fix.get));
    var parentCtl = selectCtl('parent', 'Parent', distinct(store.dims.parent.get));
    var updateBar = AF.filterBar(barBox, store, [fixCtl.root, parentCtl.root]);
    function syncCtl(ctl, dim) {
      var s = store.sel[dim];
      ctl.sel.value = s.size === 0 ? '' : s.size === 1 ? Array.from(s)[0] : '__multi';
    }

    // ---- renderers ----
    function renderKpis(f) {
      var filtered = hasDashboardFilters();
      var P = AF.sum(f, 'points'), TP = AF.sum(tickets, 'points');
      var doneP = AF.sum(f.filter(function (t) { return AF.bucketOf(t.status) === 3; }), 'points');
      kItems.value.textContent = String(f.length);
      kItems.hint.textContent = filtered ? 'of ' + tickets.length : 'tickets in the sprint';
      kPoints.value.textContent = fmt(P);
      kPoints.hint.textContent = filtered ? 'of ' + fmt(TP) : 'missing counts as 0';
      kDone.value.textContent = P > 0 ? Math.round(doneP / P * 100) + '%' : '—';
      kDone.hint.textContent = fmt(doneP) + ' of ' + fmt(P) + ' points done';
      kNoTester.value.textContent = String(f.filter(noTesterAndNotDevToTest).length);
      kNoTester.hint.textContent = 'no tester, excluding Dev to Test · of ' + f.length + ' work items';
      var ct = AF.avgCycleTime(f);
      kCycle.value.textContent = ct.avg === null ? '\u2014' : AF.oneDecimal(ct.avg);
      kCycle.hint.textContent = ct.n ? 'days, over ' + ct.n + ' Done ticket' + (ct.n === 1 ? '' : 's') : 'no Done tickets with a cycle time';
      var days = AF.config.midSprintThresholdDays, mid = AF.midSprintAdded(f, sprint, days);
      kMid.value.textContent = mid ? String(mid.count) : '\u2014';
      kMid.hint.textContent = mid ? fmt(mid.points) + ' points, added after day ' + days : 'No sprint start date in sprint.json';
      if (!sprint) { kCarried.value.textContent = '\u2014'; kCarried.hint.textContent = 'No sprint data in sprint.json'; }
      else if (!sprint.carriedOver) { kCarried.value.textContent = '\u2014'; kCarried.hint.textContent = 'Not calculated yet for this sprint'; }
      else {
        var c = sprint.carriedOver, parts = [];
        if (c.percent !== null && c.percent !== undefined) parts.push(fmt(c.percent) + '% of tickets');
        if (c.storyPoints !== null && c.storyPoints !== undefined) parts.push(fmt(c.storyPoints) + ' points');
        kCarried.value.textContent = c.count === null || c.count === undefined ? '\u2014' : String(c.count);
        kCarried.hint.textContent = parts.length ? parts.join(', ') : 'No figures in sprint.json';
      }
    }

    // ---- burndown (SPEC §6.3) ----
    var lastModel = null, lastOpts = null, selectedKey = null, pop = null; // selectedKey: 'added:YYYY-MM-DD' or 'removed:YYYY-MM-DD'
    function keyKind() { return selectedKey ? selectedKey.split(':')[0] : null; }
    function keyDate() { return selectedKey ? selectedKey.split(':')[1] : null; }
    function closePanel() {
      selectedKey = null;
      if (pop) { pop.remove(); pop = null; }
    }
    // Information panel for one marker: the tickets added (or removed) that day (SPEC §6.3). Changes no filter.
    function showPanel(list) {
      if (pop) pop.remove();
      var pts = list.reduce(function (a, t) { return a + t.points; }, 0);
      var rows = list.map(function (t) {
        return el('tr', null, [
          el('td', null, [AF.ticketCell(t.ticket)]),
          el('td', { class: 'sum', text: AF.isBlank(t.summary) ? '\u2014' : String(t.summary) }),
          el('td', { class: 'num', text: fmt(t.points) }),
          el('td', { text: AF.isBlank(t.status) ? '\u2014' : String(t.status) }),
          el('td', { text: AF.personName(t.owner) })
        ]);
      });
      pop = el('div', { class: 'bd-pop', role: 'dialog', 'aria-label': 'Tickets ' + keyKind() + ' ' + AF.longDate(keyDate()) }, [
        el('div', { class: 'bd-pop-head' }, [
          el('div', null, [
            el('strong', { text: (keyKind() === 'removed' ? 'Removed ' : 'Added ') + AF.longDate(keyDate()) }),
            el('span', { class: 'bd-pop-sub', text: list.length + ' ticket' + (list.length === 1 ? '' : 's') + ', ' + fmt(pts) + ' points' })
          ]),
          el('button', { type: 'button', class: 'bd-pop-x', 'aria-label': 'Close list', text: '\u00d7', onclick: function () { closePanel(); drawNow(); } })
        ]),
        el('div', { class: 'bd-pop-body' }, [
          el('table', { class: 'bd-pop-table' }, [
            el('thead', null, [el('tr', null, ['Ticket', 'Summary', 'Pts', 'Status', 'Assignee'].map(function (h) { return el('th', { text: h }); }))]),
            el('tbody', null, rows)
          ])
        ])
      ]);
      tBurn.root.appendChild(pop);
    }
    function drawNow() { if (lastModel) { lastOpts.selectedKey = selectedKey; AF.drawBurndown(tBurn.body, lastModel, lastOpts); } }
    function onMarker(kind, date, list) {
      var key = kind + ':' + date;
      if (selectedKey === key) closePanel(); else { selectedKey = key; showPanel(list); }
      drawNow();
      var mk = tBurn.body.querySelector('g.bd-' + kind + '[data-date="' + date + '"]');
      if (mk) mk.focus();
    }
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && selectedKey) { closePanel(); drawNow(); }
    });
    function renderBurndown(f) {
      var days = AF.config.midSprintThresholdDays;
      var hasRemoved = !!sprint && Array.isArray(sprint.removed);
      var rf = hasRemoved ? store.apply(sprint.removed) : []; // removed tickets follow the same filters (they carry the filter fields)
      var m = AF.burndown(f, sprint, data.refreshedAt, days, rf);
      lastModel = null; if (pop) { pop.remove(); pop = null; }
      AF.rebuild(tBurn, function () {
        var sub = tBurn.head.querySelector('.sub');
        if (!m) {
          closePanel(); sub.textContent = '';
          tBurn.body.appendChild(AF.emptyState('Sprint dates are not in sprint.json. Run the Jira sync and the export.'));
          return;
        }
        if (!f.length) { closePanel(); sub.textContent = ''; tBurn.body.appendChild(AF.emptyState(EMPTY)); return; }
        var cur = m.todayIndex >= 0 ? m.days[m.todayIndex] : null;
        var when = data.refreshedAt <= m.days[m.n - 1].date ? 'today' : 'at sprint end';
        sub.textContent = cur ? fmt(cur.remaining) + ' of ' + fmt(cur.scope) + ' points remaining ' + when + ', ideal ' + AF.oneDecimal(cur.ideal) : 'The sprint has not started yet';
        lastOpts = {
          thresholdDays: days, onMarker: onMarker, selectedKey: selectedKey,
          label: 'Burndown chart for ' + (sprint.name || 'the sprint') + ': ' + (cur ? fmt(cur.remaining) + ' of ' + fmt(cur.scope) + ' points remaining ' + when + ', ideal ' + AF.oneDecimal(cur.ideal) + '.' : 'not started.')
        };
        lastModel = m;
        { var byKind = keyKind() === 'removed' ? m.removedByDate : m.addedByDate; if (selectedKey && byKind[keyDate()]) showPanel(byKind[keyDate()]); else closePanel(); }
        lastOpts.selectedKey = selectedKey;
        AF.drawBurndown(tBurn.body, m, lastOpts);
        var note = hasRemoved
          ? 'Scope grows on each ticket\'s added date and shrinks on the date a ticket left the sprint. Re-estimates are not reflected.'
          : 'Scope grows on each ticket\'s added date. Tickets removed from the sprint and re-estimates are not reflected.';
        note += ' Older snapshots may not identify legacy estimated dates.';
        if (m.unplacedDone) note += ' ' + m.unplacedDone + ' Done ticket' + (m.unplacedDone === 1 ? ' has' : 's have') + ' no done date and ' + (m.unplacedDone === 1 ? 'is' : 'are') + ' not on the line.';
        tBurn.foot.appendChild(el('p', { class: 'footnote', text: note }));
      });
    }
    if (typeof ResizeObserver !== 'undefined') {
      var lw = 0, lh = 0;
      new ResizeObserver(function () {
        var w = tBurn.body.clientWidth, h = tBurn.body.clientHeight;
        if ((w !== lw || h !== lh) && lastModel) { lw = w; lh = h; AF.drawBurndown(tBurn.body, lastModel, lastOpts); }
      }).observe(tBurn.body);
    }

    function pair(items, points) {
      return el('span', { class: 'pair' }, [String(items), el('span', { class: 'sep', text: ' / ' }), fmt(points)]);
    }

    function renderStatus() {
      var base = store.apply(tickets, 'status');
      var tot = AF.statusTotals(base);
      var s = store.sel.status, any = s.size > 0;
      AF.rebuild(tStatus, function () {
        if (!base.length) { tStatus.body.appendChild(AF.emptyState(EMPTY)); return; }
        tStatus.colhead.className = 'colhead status-grid';
        tStatus.colhead.appendChild(el('span', { text: 'Status' }));
        tStatus.colhead.appendChild(el('span', { class: 'span2', text: 'Work items / Story points' }));
        visible.forEach(function (b) {
          var name = AF.BUCKETS[b], selected = s.has(name);
          var share = tot[b].items / base.length * 100;
          tStatus.body.appendChild(AF.rowButton({
            key: 'status:' + name, cls: 'status-grid tall' + (tot[b].items === 0 ? ' zero' : ''), selected: selected, dimmed: any && !selected,
            title: name + ': ' + tot[b].items + ' work items, ' + fmt(tot[b].points) + ' story points',
            onclick: function (m) { store.click('status', name, m); }
          }, [
            el('span', { class: 'name' }, [AF.statusDot(b), name]),
            el('div', { class: 'bar-track' }, [el('div', { class: 'bar', style: 'width:' + share.toFixed(2) + '%' }, [
              el('span', { class: 'seg ' + AF.BUCKET_CLASS[b], style: 'flex:1 1 0' })
            ])]),
            pair(tot[b].items, tot[b].points)
          ]));
        });
        tStatus.foot.appendChild(el('div', { class: 'status-grid totalrow' }, [
          el('span', { text: 'Total' }), el('span'), pair(base.length, AF.sum(base, 'points'))
        ]));
      });
    }

    function renderPeople(t, dim, keyFn, personLabel) {
      var base = store.apply(tickets, dim);
      var agg = AF.aggregateBy(base, keyFn);
      var s = store.sel[dim], any = s.size > 0;
      AF.rebuild(t, function () {
        if (!agg.rows.length) { t.body.appendChild(AF.emptyState(EMPTY)); return; }
        t.colhead.className = 'colhead people-grid';
        [personLabel, 'Work items', 'Story points'].forEach(function (h) { t.colhead.appendChild(el('span', { text: h })); });
        var maxI = Math.max.apply(null, agg.rows.map(function (r) { return r.itemsTotal; }));
        var maxP = Math.max.apply(null, agg.rows.map(function (r) { return r.pointsTotal; }));
        function metric(r, key, scale, totalKey, unit) {
          var segs = AF.BUCKETS.map(function (name, b) {
            return { bucket: b, value: r[key][b], title: name + ': ' + fmt(r[key][b]) + ' ' + unit };
          });
          return el('div', { class: 'bar-cell' }, [AF.stackedBar(segs, r[totalKey], scale), el('span', { class: 'n', text: fmt(r[totalKey]) })]);
        }
        agg.rows.forEach(function (r) {
          var selected = s.has(r.name);
          t.body.appendChild(AF.rowButton({
            key: dim + ':' + r.name, cls: 'people-grid', selected: selected, dimmed: any && !selected,
            title: r.name + ': ' + r.itemsTotal + ' work items, ' + fmt(r.pointsTotal) + ' story points',
            onclick: function (m) { store.click(dim, r.name, m); }
          }, [
            el('span', { class: 'person', text: r.name }),
            metric(r, 'items', maxI, 'itemsTotal', 'work items'),
            metric(r, 'points', maxP, 'pointsTotal', 'story points')
          ]));
        });
        function total(n) {
          return el('div', { class: 'bar-cell' }, [el('div', { class: 'bar-track', style: 'visibility:hidden' }), el('span', { class: 'n', text: fmt(n) })]);
        }
        t.foot.appendChild(el('div', { class: 'people-grid totalrow' }, [
          el('span', { text: 'Total' }), total(agg.totals.itemsTotal), total(agg.totals.pointsTotal)
        ]));
      });
    }

    function renderMatrix() {
      var base = store.apply(tickets, ['assignee', 'tester']).filter(matchesLowerFilter);
      var ct = AF.crossTab(base, owner, tester, { lastCol: 'Unassigned' });
      AF.rebuild(tMatrix, function () {
        if (!ct.rows.length) { tMatrix.body.appendChild(AF.emptyState(lowerFilter === 'carriedOver' && !carriedKeys ? 'The snapshot has the carried-over total but no ticket keys, so those tickets cannot be identified here yet.' : EMPTY)); return; }
        AF.heatGrid(tMatrix, ct, {
          corner: 'Assignee', unit: 'work items', rowSel: store.sel.assignee, colSel: store.sel.tester,
          onCell: function (r, c, m) { store.clickPair('assignee', r, 'tester', c, m); }
        });
      });
    }

    var detailCols = [
      { label: 'Ticket', cls: 'nowrap', render: function (t) { return AF.ticketCell(t.ticket); } },
      { label: 'Summary', cls: 'wrap', render: function (t) { return AF.show(t.summary); } },
      { label: 'Owner', cls: 'nowrap owner', render: owner },
      { label: 'Tester', cls: 'nowrap', render: tester },
      { label: 'Status', cls: 'nowrap', render: function (t) { return el('span', null, [AF.statusDot(AF.bucketOf(t.status)), AF.show(t.status)]); } },
      { label: 'Story points', cls: 'num', render: function (t) { return AF.showPoints(t.points); } },
      { label: 'Parent', cls: 'wrap', render: function (t) { return AF.linkCell(t.parent); } },
      { label: 'Fix version', cls: 'nowrap', render: function (t) { return AF.show(t.fixVersion); } },
      { label: 'Linked work items', cls: 'wrap', render: function (t) { return AF.linkCell(t.linkedWorkItems); } },
      { label: 'Current situation', cls: 'wrap current-situation', render: function (t) { return AF.show(t.currentSituation); } }
    ];
    function renderDetail(f) {
      var filterLabels = { midSprint: 'Added mid-sprint', carriedOver: 'Carried over', noTester: 'No tester and not Dev to Test' };
      tDetail.head.querySelector('.sub').textContent = f.length + ' of ' + tickets.length + ' work items' +
        (lowerFilter ? ' · ' + filterLabels[lowerFilter] + ' (click KPI again to clear)' : '');
      AF.rebuild(tDetail, function () {
        if (!f.length) { tDetail.body.appendChild(AF.emptyState(lowerFilter === 'carriedOver' && !carriedKeys ? 'The snapshot has the carried-over total but no ticket keys, so those tickets cannot be identified here yet.' : EMPTY)); return; }
        tDetail.body.appendChild(AF.buildTable(detailCols, f, { cls: 'data wider' }));
      });
    }

    function renderLower() {
      var f = store.apply(tickets).filter(matchesLowerFilter);
      renderDetail(f);
      renderMatrix();
    }

    function render() {
      var f = store.apply(tickets);
      renderKpis(f);
      renderBurndown(f);
      renderStatus();
      renderPeople(tAssignee, 'assignee', owner, 'Assignee');
      renderPeople(tTester, 'tester', tester, 'Tester');
      renderLower();
      updateBar();
      syncCtl(fixCtl, 'fix');
      syncCtl(parentCtl, 'parent');
    }
    store.subscribe(render);
    render();
    AF.store = store; AF.tickets = tickets; // exposed for console checks
  }
})();
