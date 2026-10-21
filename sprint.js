/* sprint.js — sprint selection, current/closed sprint page (index.html). Cross-filtering: SPEC §5. */
(function () {
  'use strict';
  var AF = window.AF, el = AF.el, fmt = AF.fmtNum;
  var app = document.getElementById('app');
  var shell = document.querySelector('.app') || app; // outer wrapper: .app.historical-sprint in dashboard.css
  var barBox = document.getElementById('filterbar');
  var pickerBox = document.getElementById('sprint-picker');
  var banner = document.getElementById('sprint-banner');
  var EMPTY = 'No work items match these filters. Remove a tag or use Reset all.';
  var manifest = null, sprintSelect = null, snapshotCache = Object.create(null);
  var activeObserver = null, activeEscapeHandler = null;

  function validDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    var date = new Date(value + 'T00:00:00Z');
    return !isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }
  function safeFile(value) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9._/-]+$/.test(value)) return false;
    return value.split('/').every(function (part) { return part && part !== '.' && part !== '..'; });
  }
  function validManifest(data) {
    if (!data || !Number.isInteger(data.current) || !Array.isArray(data.sprints) || !data.sprints.length) return false;
    if (!Object.keys(data).every(function (k) { return k === 'current' || k === 'sprints'; })) return false;
    var ids = Object.create(null), active = [], current = null;
    for (var i = 0; i < data.sprints.length; i++) {
      var s = data.sprints[i];
      if (!s || !Object.keys(s).every(function (k) { return ['id', 'name', 'startDate', 'endDate', 'state', 'file', 'note'].indexOf(k) !== -1; })) return false;
      if (!s || !Number.isInteger(s.id) || s.id < 1 || ids[s.id] || typeof s.name !== 'string' || !s.name.trim() ||
          !validDate(s.startDate) || !validDate(s.endDate) || s.endDate < s.startDate ||
          (s.state !== 'active' && s.state !== 'closed') || !safeFile(s.file) ||
          (s.note !== undefined && typeof s.note !== 'string')) return false;
      ids[s.id] = true;
      if (s.state === 'active') active.push(s);
      if (s.id === data.current) current = s;
    }
    return active.length === 1 && current === active[0];
  }
  function findSprint(id) {
    return manifest && manifest.sprints.find(function (s) { return String(s.id) === String(id); });
  }
  function showLoading() {
    AF.clear(app); AF.clear(barBox);
    app.appendChild(el('p', { class: 'loading', text: 'Loading sprint…' }));
  }
  function showUnknownSprint(id) {
    AF.clear(app); AF.clear(barBox);
    app.appendChild(el('section', { class: 'message', role: 'alert' }, [
      el('h2', { text: 'Sprint not found' }),
      el('p', { text: 'Sprint ' + id + ' is not listed in sprints.json. Choose an available sprint from the Sprint selector.' })
    ]));
  }
  function updateSprintUrl(id) {
    var url = new URL(window.location.href);
    url.searchParams.set('sprint', String(id));
    window.history.replaceState(null, '', url.pathname + url.search + url.hash);
  }
  function buildSelector() {
    AF.clear(pickerBox);
    sprintSelect = el('select', { id: 'sprint-select', 'aria-label': 'Sprint' }, [el('option', { value: '', text: 'Choose a sprint', disabled: true })]);
    manifest.sprints.forEach(function (s) {
      sprintSelect.appendChild(el('option', {
        value: String(s.id),
        text: s.name + ' (' + s.state + ')'
      }));
    });
    sprintSelect.addEventListener('change', function () {
      var selected = findSprint(sprintSelect.value);
      if (!selected) return;
      updateSprintUrl(selected.id);
      loadSprint(selected);
    });
    pickerBox.appendChild(el('label', { for: 'sprint-select', text: 'Sprint' }));
    pickerBox.appendChild(sprintSelect);
  }
  function loadSprint(entry) {
    shell.classList.toggle('historical-sprint', entry.state === 'closed');
    AF.clear(banner);
    banner.hidden = true;
    if (!snapshotCache[entry.file]) {
      snapshotCache[entry.file] = AF.loadSnapshot(entry.file).then(function (data) {
        if (!data.sprint || data.sprint.id !== entry.id || data.sprint.startDate !== entry.startDate || data.sprint.endDate !== entry.endDate) {
          throw new Error('snapshot sprint metadata does not match sprints.json');
        }
        return data;
      }).catch(function (err) {
        delete snapshotCache[entry.file];
        throw err;
      });
    }
    if (sprintSelect) sprintSelect.value = String(entry.id);
    showLoading();
    snapshotCache[entry.file].then(function (data) { init(data, entry); }, function (err) { AF.showError(app, entry.file, err); });
  }
  function loadFallback() {
    AF.clear(pickerBox); sprintSelect = null;
    AF.clear(banner); banner.hidden = true;
    if (!snapshotCache['sprint.json']) snapshotCache['sprint.json'] = AF.loadSnapshot('sprint.json');
    snapshotCache['sprint.json'].then(function (data) { init(data, null); }, function (err) { AF.showError(app, 'sprint.json', err); });
  }
  function loadManifest() {
    AF.loadJson('sprints.json').then(function (data) {
      if (!validManifest(data)) throw new Error('invalid sprint manifest');
      return data;
    }).then(function (data) {
      manifest = data;
      buildSelector();
      var requested = new URLSearchParams(window.location.search).get('sprint');
      var selected = requested === null ? findSprint(manifest.current) : findSprint(requested);
      if (!selected) {
        sprintSelect.value = '';
        showUnknownSprint(requested);
        return;
      }
      loadSprint(selected);
    }, function () {
      // Older deployments may not have the manifest yet. Keep the prior current sprint page quietly.
      loadFallback();
    });
  }
  loadManifest();

  function init(data, entry) {
    if (activeObserver) { activeObserver.disconnect(); activeObserver = null; }
    if (activeEscapeHandler) { document.removeEventListener('keydown', activeEscapeHandler); activeEscapeHandler = null; }
    AF.clear(barBox);
    var tickets = data.tickets;
    var sprint = data.sprint || null; // may be absent in older files (DATA_CONTRACT §2a)
    var isClosed = !!entry && entry.state === 'closed';
    shell.classList.toggle('historical-sprint', isClosed);
    AF.setUpdated(data.refreshedAt, data.exportedAt);
    AF.clear(banner);
    banner.hidden = !isClosed;
    if (isClosed) {
      var asOf = document.getElementById('asof').textContent.replace(/^Data as of /, '');
      banner.appendChild(el('strong', { class: 'sprint-banner-label', text: 'HISTORICAL VIEW · CLOSED SPRINT' }));
      banner.appendChild(el('span', { class: 'sprint-banner-asof', text: 'Snapshot as of ' + asOf }));
      if (entry.note) banner.appendChild(el('span', { class: 'sprint-banner-note', text: entry.note }));
    }
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
      type: { label: 'Type', get: function (t) { return AF.isBlank(t.type) ? '—' : String(t.type); } },
      assignee: { label: 'Assignee', get: function (t) { return AF.personName(t.owner); } },
      tester: { label: 'Tester', get: function (t) { return AF.personName(t.tester); } },
      contributor: { label: 'Team member', matches: function (t, selected) { return selected.has(AF.personName(t.owner)) || selected.has(AF.personName(t.tester)); } },
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
    var kDone = kpi('plain', 'Done'), kNoTester = kpi('plain', 'No tester & Not Dev to Test');
    var kCycle = kpi('plain', 'Avg cycle time'), kMid = kpi('plain', 'Added mid-sprint'), kCarried = kpi('plain', 'Carried over');
    var kTime = kpi('plain', 'Time in status');
    kTime.root.title = 'In Progress or In Review tickets that have stayed in the same status for the configured number of days or more. A follow-up list, not a risk rating. Click to filter the lower section.';
    kCarried.root.title = 'Carried over from the previous sprint. Click to filter the lower section; ticket keys must be present in sprint.json.';
    kMid.root.title = 'Tickets added after the first days of the sprint, based on Added to Sprint dates.';
    var tBurn = AF.tile({ title: 'Burndown', sub: '' });
    tBurn.body.classList.add('chart');
    var tStatus = AF.tile({ title: 'Tickets by status', sub: 'Click a status to filter' });
    var tType = AF.tile({ title: 'Tickets by type', sub: 'Click a type to filter' });
    var tContribution = AF.tile({ title: 'Team Contribution', sub: 'Work Items (W.I) by Jira role' });
    var tMatrix = AF.tile({ title: 'Assignee x tester', sub: 'Work items per pair. Click a cell to filter both.' });
    var tDetail = AF.tile({ title: 'Ticket detail', sub: '' });
    var lowerFilter = null;
    var hasDashboardFilters = store.isActive;
    store.isActive = function () { return !!lowerFilter || hasDashboardFilters(); };
    var carriedKeys = sprint && sprint.carriedOver && Array.isArray(sprint.carriedOver.ticketKeys)
      ? sprint.carriedOver.ticketKeys : null;

    function isDevToTest(t) {
      return String(t.classifications || '').split('; ').indexOf('Dev to Test') !== -1;
    }
    function noTesterAndNotDevToTest(t) {
      var testerMissing = t.tester == null || String(t.tester).trim() === '' || String(t.tester).trim() === 'Unassigned';
      return testerMissing && !isDevToTest(t);
    }
    function inTimeInStatus(t) {
      return (t.status === 'In Progress' || t.status === 'In Review') &&
        typeof t.statusAging === 'number' && isFinite(t.statusAging) &&
        t.statusAging >= AF.config.timeInStatusThresholdDays;
    }
    function matchesLowerFilter(t) {
      if (lowerFilter === 'timeInStatus') return inTimeInStatus(t);
      if (lowerFilter === 'noTester') return noTesterAndNotDevToTest(t);
      if (lowerFilter === 'midSprint') {
        var mid = AF.midSprintAdded([t], sprint, AF.config.midSprintThresholdDays);
        return !!(mid && mid.count);
      }
      if (lowerFilter === 'carriedOver') return !!(carriedKeys && carriedKeys.indexOf(t.ticket) !== -1);
      return true;
    }
    function syncLowerKpis() {
      [kMid, kCarried, kNoTester, kTime].forEach(function (kpi) {
        var selected =
          (kpi === kMid && lowerFilter === 'midSprint') ||
          (kpi === kCarried && lowerFilter === 'carriedOver') ||
          (kpi === kNoTester && lowerFilter === 'noTester') ||
          (kpi === kTime && lowerFilter === 'timeInStatus');
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
        var labels = { midSprint: 'Added mid-sprint', carriedOver: 'Carried over', noTester: 'No tester & Not Dev to Test', timeInStatus: 'Time in status' };
        tags.push({ dim: '__kpi', label: 'KPI', value: labels[lowerFilter] || lowerFilter });
      }
      return tags;
    };
    var baseRemove = store.remove;
    store.remove = function (dim, value) {
      if (dim === '__kpi') { setLowerFilter(lowerFilter); return; }
      baseRemove(dim, value);
    };
    [[kMid, 'midSprint'], [kNoTester, 'noTester'], [kTime, 'timeInStatus']].concat(carriedKeys ? [[kCarried, 'carriedOver']] : []).forEach(function (entry) {
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

    app.appendChild(el('div', { class: 'kpis k8' }, [kItems.root, kPoints.root, kDone.root, kMid.root, kCarried.root, kNoTester.root, kTime.root, kCycle.root]));
    app.appendChild(el('div', { class: 'main sprint' }, [tBurn.root, tStatus.root, tType.root, tContribution.root]));
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
      var tis = f.filter(inTimeInStatus), withAging = f.filter(function (t) {
        return (t.status === 'In Progress' || t.status === 'In Review') && typeof t.statusAging === 'number';
      });
      kTime.value.textContent = withAging.length ? String(tis.length) : '\u2014';
      kTime.hint.textContent = withAging.length
        ? 'In Progress / In Review, ' + AF.config.timeInStatusThresholdDays + ' days or more'
        : 'Days in status not available yet';
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
    activeEscapeHandler = function (e) {
      if (e.key === 'Escape' && selectedKey) { closePanel(); drawNow(); }
    };
    document.addEventListener('keydown', activeEscapeHandler);
    function renderBurndown(f) {
      var days = AF.config.midSprintThresholdDays;
      var hasRemoved = !!sprint && Array.isArray(sprint.removed);
      var rf = hasRemoved ? store.apply(sprint.removed) : []; // removed tickets follow the same filters (they carry the filter fields)
      var m = AF.burndown(f, sprint, data.refreshedAt, days, rf, { closed: isClosed });
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
        var when = isClosed || data.refreshedAt > m.days[m.n - 1].date ? 'at sprint end' : 'today';
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
      activeObserver = new ResizeObserver(function () {
        var w = tBurn.body.clientWidth, h = tBurn.body.clientHeight;
        if ((w !== lw || h !== lh) && lastModel) { lw = w; lh = h; AF.drawBurndown(tBurn.body, lastModel, lastOpts); }
      }).observe(tBurn.body);
    }

    function pair(items, points) {
      return el('span', { class: 'pair' }, [String(items) + ' W.I', el('span', { class: 'sep', text: ' | ' }), fmt(points) + ' SP']);
    }

    function renderStatus() {
      var base = store.apply(tickets, 'status');
      var tot = AF.statusTotals(base);
      var s = store.sel.status, any = s.size > 0;
      AF.rebuild(tStatus, function () {
        if (!base.length) { tStatus.body.appendChild(AF.emptyState(EMPTY)); return; }
        tStatus.colhead.className = 'colhead status-grid';
        tStatus.colhead.appendChild(el('span', { text: 'Status' }));
        tStatus.colhead.appendChild(el('span', { class: 'span2', text: 'Work items | Story points' }));
        visible.forEach(function (b) {
          var name = AF.BUCKETS[b], selected = s.has(name);
          var share = tot[b].items / base.length * 100;
          tStatus.body.appendChild(AF.rowButton({
            key: 'status:' + name, cls: 'status-grid tall' + (tot[b].items === 0 ? ' zero' : ''), selected: selected, dimmed: any && !selected,
            title: name + ': ' + tot[b].items + ' work items, ' + fmt(tot[b].points) + ' story points',
            onclick: function () { store.click('status', name, true); }
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

    function renderTypes() {
      var base = store.apply(tickets, 'type');
      var groups = Object.create(null);
      base.forEach(function (ticket) {
        var name = AF.isBlank(ticket.type) ? '—' : String(ticket.type);
        var group = groups[name] || (groups[name] = { items: 0, points: 0 });
        group.items += 1;
        group.points += typeof ticket.points === 'number' && isFinite(ticket.points) ? ticket.points : 0;
      });
      var keys = Object.keys(groups).sort(function (a, b) {
        return groups[b].items - groups[a].items || a.localeCompare(b);
      });
      var selection = store.sel.type, any = selection.size > 0;
      AF.rebuild(tType, function () {
        if (!base.length) { tType.body.appendChild(AF.emptyState(EMPTY)); return; }
        tType.colhead.className = 'colhead status-grid';
        tType.colhead.appendChild(el('span', { text: 'Type' }));
        tType.colhead.appendChild(el('span', { class: 'span2', text: 'Work items | Story points' }));
        keys.forEach(function (name) {
          var group = groups[name], selected = selection.has(name);
          var share = group.items / base.length * 100;
          tType.body.appendChild(AF.rowButton({
            key: 'type:' + name, cls: 'status-grid tall' + (group.items === 0 ? ' zero' : ''),
            selected: selected, dimmed: any && !selected,
            title: name + ': ' + group.items + ' work items, ' + fmt(group.points) + ' story points',
            onclick: function (multi) { store.click('type', name, multi); }
          }, [
            el('span', { class: 'name' }, [AF.icon.type(name), name]),
            el('div', { class: 'bar-track' }, [el('div', { class: 'bar', style: 'width:' + share.toFixed(2) + '%' }, [
              el('span', { class: 'seg type-bar', style: 'flex:1 1 0' })
            ])]),
            pair(group.items, group.points)
          ]));
        });
        tType.foot.appendChild(el('div', { class: 'status-grid totalrow' }, [
          el('span', { text: 'Total' }), el('span'), pair(base.length, AF.sum(base, 'points'))
        ]));
      });
    }

    function renderContributions() {
      var base = store.apply(tickets, ['assignee', 'tester', 'contributor']);
      var byOwner = AF.aggregateBy(base, owner);
      var byTester = AF.aggregateBy(base, tester);
      var ownerRows = new Map(byOwner.rows.map(function (r) { return [r.name, r]; }));
      var testerRows = new Map(byTester.rows.map(function (r) { return [r.name, r]; }));
      var names = Array.from(new Set(Array.from(ownerRows.keys()).concat(Array.from(testerRows.keys()))));
      var rows = names.map(function (name) {
        var a = ownerRows.get(name), t = testerRows.get(name);
        var ownerTickets = base.filter(function (ticket) { return owner(ticket) === name; });
        var testerTickets = base.filter(function (ticket) { return tester(ticket) === name; });
        var uniqueTickets = new Map();
        ownerTickets.concat(testerTickets).forEach(function (ticket) { uniqueTickets.set(ticket.ticket, ticket); });
        var unique = Array.from(uniqueTickets.values());
        var assigneeItems = ownerTickets.length, testerItems = testerTickets.length;
        return { name: name, assigneeItems: assigneeItems, testerItems: testerItems,
          totalPoints: AF.sum(unique, 'points'), workItems: unique.length };
      }).sort(function (a, b) { return b.workItems - a.workItems || a.name.localeCompare(b.name); });
      var ownerSelected = store.sel.assignee, testerSelected = store.sel.tester;
      AF.rebuild(tContribution, function () {
        if (!rows.length) { tContribution.body.appendChild(AF.emptyState(EMPTY)); return; }
        tContribution.colhead.className = 'colhead contribution-grid';
        [['Name', 'name'], ['Assignee W.I', 'assignee'], ['Tester W.I', 'tester'], ['Total W.I | SP', 'total']].forEach(function (col) {
          tContribution.colhead.appendChild(el('span', { text: col[0] }));
        });
        rows.forEach(function (row) {
          var roleCell = function (dim, value, selected, any) {
            var cell = el('button', { type: 'button', 'data-key': dim + ':' + row.name, class: 'contribution-value' + (selected ? ' selected' : '') + (any && !selected ? ' dimmed' : ''),
              'aria-pressed': selected ? 'true' : 'false', title: 'Filter ' + (dim === 'assignee' ? 'Assignee' : 'Tester') + ': ' + row.name,
              onclick: function (event) { store.click(dim, row.name, event.ctrlKey || event.metaKey || event.shiftKey); } }, [fmt(value)]);
            return cell;
          };
          var ownerSelectedRow = ownerSelected.has(row.name), testerSelectedRow = testerSelected.has(row.name);
          tContribution.body.appendChild(el('div', { class: 'contribution-grid contribution-row' }, [
            el('button', { type: 'button', 'data-key': 'contributor:' + row.name, class: 'contribution-name' + (store.sel.contributor.has(row.name) ? ' selected' : '') + (store.sel.contributor.size && !store.sel.contributor.has(row.name) ? ' dimmed' : ''), 'aria-pressed': store.sel.contributor.has(row.name) ? 'true' : 'false', title: 'Show tickets where ' + row.name + ' is assignee or tester', onclick: function (event) { store.click('contributor', row.name, event.ctrlKey || event.metaKey || event.shiftKey); } }, [row.name]),
            roleCell('assignee', row.assigneeItems, ownerSelectedRow, ownerSelected.size > 0),
            roleCell('tester', row.testerItems, testerSelectedRow, testerSelected.size > 0),
            el('span', { class: 'contribution-total', text: row.workItems + ' W.I | ' + fmt(row.totalPoints) + ' SP' })
          ]));
        });
        tContribution.foot.appendChild(el('div', { class: 'contribution-grid totalrow' }, [
          el('span', { text: 'Total' }), el('span', { text: fmt(byOwner.totals.itemsTotal) }),
          el('span', { text: fmt(byTester.totals.itemsTotal) }),
          el('span', { class: 'contribution-total', text: base.length + ' W.I | ' + fmt(AF.sum(base, 'points')) + ' SP' })
        ]));
        tContribution.foot.appendChild(el('p', { class: 'footnote', text: 'Assignee and Tester work item counts can overlap. Story points are shared and count once.' }));
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

    var detailSort = { key: null, direction: 'asc' };
    var detailSortGetters = {
      Ticket: function (t) { return t.ticket; },
      Owner: owner,
      Tester: tester,
      Status: function (t) { return t.status; },
      'Story points': function (t) { return t.points; },
      Parent: function (t) { return t.parent; },
      'Fix version': function (t) { return t.fixVersion; },
      'Days in status': function (t) { return typeof t.statusAging === 'number' ? t.statusAging : null; }
    };
    var detailCols = [
      { label: 'Ticket', cls: 'nowrap', render: function (t) { return AF.ticketCell(t.ticket); } },
      { label: 'Summary', cls: 'wrap', render: function (t) { return AF.show(t.summary); } },
      { label: 'Owner', cls: 'owner wrap-text', render: owner },
      { label: 'Tester', cls: 'tester wrap-text', render: tester },
      { label: 'Dev to Test', cls: 'nowrap', render: function (t) { return AF.show(isDevToTest(t) ? 'Yes' : null); } },
      { label: 'Status', cls: 'status wrap-text', render: function (t) { return el('span', null, [AF.statusDot(AF.bucketOf(t.status)), AF.show(t.status)]); } },
      { label: 'Days in status', cls: 'num', render: function (t) {
          return AF.show(typeof t.statusAging === 'number' ? t.statusAging + (t.statusAgingApprox ? '*' : '') : null);
        } },
      { label: 'Story points', cls: 'num', render: function (t) { return AF.showPoints(t.points); } },
      { label: 'Parent', cls: 'wrap', render: function (t) { return AF.linkCell(t.parent); } },
      { label: 'Fix version', cls: 'nowrap', render: function (t) { return AF.show(t.fixVersion); } },
      { label: 'Linked work items', cls: 'wrap', render: function (t) { return AF.linkCell(t.linkedWorkItems); } },
      { label: 'Last sync update', cls: 'wrap current-situation', render: function (t) { return AF.show(t.lastSyncUpdate); } }
    ];
    function sortDetailRows(rows) {
      if (!detailSort.key) return rows;
      var getValue = detailSortGetters[detailSort.key], direction = detailSort.direction === 'asc' ? 1 : -1;
      return rows.slice().sort(function (a, b) {
        var av = getValue(a), bv = getValue(b);
        var numeric = detailSort.key === 'Story points' || detailSort.key === 'Days in status';
        var aMissing = numeric ? typeof av !== 'number' || !isFinite(av) : AF.isBlank(av);
        var bMissing = numeric ? typeof bv !== 'number' || !isFinite(bv) : AF.isBlank(bv);
        if (aMissing || bMissing) return aMissing === bMissing ? 0 : (aMissing ? direction : -direction);
        var cmp = numeric ? av - bv : String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: 'base' });
        return cmp * direction;
      });
    }
    function sortableDetailTable(rows) {
      var table = AF.buildTable(detailCols, sortDetailRows(rows), { cls: 'data wider' });
      Array.prototype.forEach.call(table.querySelectorAll('thead th'), function (th, index) {
        var label = detailCols[index].label;
        if (!detailSortGetters[label]) return;
        var active = detailSort.key === label;
        var direction = active ? detailSort.direction : null;
        var actionDirection = active ? (direction === 'asc' ? 'descending' : 'ascending') : 'ascending';
        th.setAttribute('aria-sort', direction === 'asc' ? 'ascending' : direction === 'desc' ? 'descending' : 'none');
        AF.clear(th);
        th.appendChild(el('button', {
          type: 'button', class: 'detail-sort', 'data-sort-key': label,
          'aria-label': 'Sort by ' + label + ', ' + actionDirection,
          title: 'Sort by ' + label + ' (' + actionDirection + ')',
          onclick: function () {
            if (detailSort.key === label) detailSort.direction = detailSort.direction === 'asc' ? 'desc' : 'asc';
            else detailSort = { key: label, direction: 'asc' };
            renderDetail(rows);
            var next = tDetail.body.querySelector('.detail-sort[data-sort-key="' + label + '"]');
            if (next) next.focus({ preventScroll: true });
          }
        }, [label, el('span', { class: 'detail-sort-arrow', 'aria-hidden': 'true', text: active ? (direction === 'asc' ? '↑' : '↓') : '↕' })]));
      });
      return table;
    }
    function renderDetail(f) {
      var filterLabels = { midSprint: 'Added mid-sprint', carriedOver: 'Carried over', noTester: 'No tester & Not Dev to Test', timeInStatus: 'Time in status' };
      tDetail.head.querySelector('.sub').textContent = f.length + ' of ' + tickets.length + ' work items' +
        (lowerFilter ? ' · ' + filterLabels[lowerFilter] + ' (click KPI again to clear)' : '');
      AF.rebuild(tDetail, function () {
        if (!f.length) { tDetail.body.appendChild(AF.emptyState(lowerFilter === 'carriedOver' && !carriedKeys ? 'The snapshot has the carried-over total but no ticket keys, so those tickets cannot be identified here yet.' : EMPTY)); return; }
        tDetail.body.appendChild(sortableDetailTable(f));
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
      renderTypes();
      renderContributions();
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
