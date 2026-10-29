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
  var SNAPSHOT_FILE = /^snapshots\/sprint-\d+\.json$/; // the only file names a manifest entry may point at (C15, D74)
  var manifest = null, sprintSelect = null, snapshotCache = Object.create(null);
  var activeObserver = null, activeEscapeHandler = null;
  var loadSeq = 0; // increases on every sprint selection; a response for an older selection is ignored (C2)

  function validDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    var date = new Date(value + 'T00:00:00Z');
    return !isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }
  // DATA_CONTRACT "Sprint rotation and manifest". Unknown keys are ignored so that a new exporter
  // field cannot take the page down; the schema (schema/sprints.schema.json) stays strict for producers.
  function validManifest(data) {
    if (!data || typeof data !== 'object' || !Number.isInteger(data.current) || !Array.isArray(data.sprints) || !data.sprints.length) return false;
    var ids = Object.create(null), active = [], current = null;
    for (var i = 0; i < data.sprints.length; i++) {
      var s = data.sprints[i];
      if (!s || typeof s !== 'object' || !Number.isInteger(s.id) || s.id < 1 || ids[s.id] || typeof s.name !== 'string' || !s.name.trim() ||
          !validDate(s.startDate) || !validDate(s.endDate) || s.endDate < s.startDate ||
          (s.state !== 'active' && s.state !== 'closed') || typeof s.file !== 'string' || !SNAPSHOT_FILE.test(s.file) ||
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
  // Stop the previous sprint view's resize observer and Escape handler before its DOM goes away (C2).
  function teardownView() {
    if (activeObserver) { activeObserver.disconnect(); activeObserver = null; }
    if (activeEscapeHandler) { document.removeEventListener('keydown', activeEscapeHandler); activeEscapeHandler = null; }
  }
  function showLoading() {
    teardownView();
    AF.clear(app); AF.clear(barBox);
    app.appendChild(el('p', { class: 'loading', text: 'Loading sprint…' }));
  }
  function showUnknownSprint(id) {
    teardownView();
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
    sprintSelect = el('select', { id: 'sprint-select' }, [el('option', { value: '', text: 'Choose a sprint', disabled: true })]);
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
  function errorWithMessage(message, userMessage) {
    var err = new Error(message);
    err.userMessage = userMessage;
    return err;
  }
  function loadSprint(entry) {
    var seq = ++loadSeq;
    shell.classList.toggle('historical-sprint', entry.state === 'closed');
    AF.clear(banner);
    banner.hidden = true;
    if (!snapshotCache[entry.file]) {
      snapshotCache[entry.file] = AF.loadSnapshot(entry.file).then(function (data) {
        if (!data.sprint || data.sprint.id !== entry.id || data.sprint.startDate !== entry.startDate || data.sprint.endDate !== entry.endDate) {
          throw errorWithMessage('snapshot sprint metadata does not match sprints.json',
            'The snapshot does not match its sprints.json entry: the sprint id or the start or end date differ. Re-run the export so that the manifest and the snapshot agree.');
        }
        return data;
      }).catch(function (err) {
        delete snapshotCache[entry.file];
        throw err;
      });
    }
    if (sprintSelect) sprintSelect.value = String(entry.id);
    showLoading();
    snapshotCache[entry.file].then(function (data) {
      if (seq !== loadSeq) return; // the user picked another sprint while this one was loading
      try { init(data, entry); } catch (err) { AF.showRenderError(app, err); }
    }, function (err) {
      if (seq !== loadSeq) return;
      AF.showError(app, entry.file, err);
    });
  }
  function loadManifest() {
    AF.loadJson('sprints.json').then(function (data) {
      if (!validManifest(data)) {
        throw errorWithMessage('invalid sprint manifest',
          'sprints.json was read but is not a valid sprint manifest (it needs exactly one active sprint equal to "current", unique ids, valid dates and files named snapshots/sprint-<id>.json).');
      }
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
    }, function (err) {
      // The manifest is the only way to find a sprint snapshot: no fallback (DECISIONS 2026-10-26).
      AF.showError(app, 'sprints.json', err);
    }).catch(function (err) { AF.showRenderError(app, err); });
  }
  loadManifest();

  function init(data, entry) {
    teardownView();
    AF.clear(barBox);
    var tickets = data.tickets;
    var sprint = data.sprint; // always present: loadSprint checked it against the manifest entry
    var isClosed = entry.state === 'closed';
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
      AF.emptyMessage(app, 'No tickets in this snapshot', 'Update the tracker, run python3 05_Automation/export_dashboard_snapshots.py, and reload.');
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
    var carriedKeys = sprint.carriedOver && Array.isArray(sprint.carriedOver.ticketKeys) ? sprint.carriedOver.ticketKeys : null;

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
    function addedMidSprint(t) {
      var mid = AF.midSprintAdded([t], sprint, AF.config.midSprintThresholdDays);
      return !!(mid && mid.count);
    }

    // ---- KPI filters: the store's extra filter slot, applied to the lower section only (SPEC §6.2) ----
    var timeLabel = 'Long-running work · ' + AF.config.timeInStatusThresholdDays + '+ days';
    var LOWER_FILTERS = {
      midSprint: { label: 'Added mid-sprint', pred: addedMidSprint },
      carriedOver: { label: 'Carried over', pred: function (t) { return carriedKeys.indexOf(t.ticket) !== -1; } },
      noTester: { label: 'No tester & Not Dev to Test', pred: noTesterAndNotDevToTest },
      timeInStatus: { label: timeLabel, pred: inTimeInStatus }
    };
    function lowerFilter() { var x = store.extra(); return x ? x.id : null; }
    function setLowerFilter(name) {
      store.setExtra(lowerFilter() === name ? null : { id: name, label: 'KPI', value: LOWER_FILTERS[name].label, pred: LOWER_FILTERS[name].pred });
    }

    // ---- shell: KPI strip, main row, detail ----
    var kItems = AF.kpi('items', 'Work items'), kPoints = AF.kpi('points', 'Story points');
    var kDone = AF.kpi('plain', 'Done'), kNoTester = AF.kpi('plain', LOWER_FILTERS.noTester.label);
    var kCycle = AF.kpi('plain', 'Avg cycle time'), kMid = AF.kpi('plain', LOWER_FILTERS.midSprint.label), kCarried = AF.kpi('plain', LOWER_FILTERS.carriedOver.label);
    var kTime = AF.kpi('plain', timeLabel);
    kTime.root.title = 'In Progress or In Review tickets that have stayed in the same status for ' + AF.config.timeInStatusThresholdDays + ' days or more. A neutral follow-up list, not a risk rating. Click to filter the lower section.';
    kCarried.root.title = 'Carried over from the previous sprint. Click to filter the lower section; ticket keys must be present in the sprint snapshot.';
    kMid.root.title = 'Tickets added after the first days of the sprint, based on Added to Sprint dates.';
    var tBurn = AF.tile({ title: 'Burndown', sub: '' });
    tBurn.body.classList.add('chart');
    var tStatus = AF.tile({ title: 'Tickets by status', sub: 'Click a status to filter' });
    var tType = AF.tile({ title: 'Tickets by type', sub: 'Click a type to filter' });
    var tContribution = AF.tile({ title: 'Team Contribution', sub: 'Work Items (W.I) by Jira role' });
    var tMatrix = AF.tile({ title: 'Assignee x tester', sub: 'Work items per pair. Click a cell to filter both.' });
    var tDetail = AF.tile({ title: 'Ticket detail', sub: '' });

    var clickableKpis = [[kMid, 'midSprint'], [kNoTester, 'noTester'], [kTime, 'timeInStatus']].concat(carriedKeys ? [[kCarried, 'carriedOver']] : []);
    clickableKpis.forEach(function (entry) {
      var root = entry[0].root;
      root.classList.add('clickable');
      root.setAttribute('role', 'button');
      root.setAttribute('tabindex', '0');
      root.setAttribute('aria-pressed', 'false');
      root.addEventListener('click', function () { setLowerFilter(entry[1]); });
      root.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setLowerFilter(entry[1]); }
      });
    });
    function syncLowerKpis() {
      var current = lowerFilter();
      clickableKpis.forEach(function (entry) {
        var selected = current === entry[1];
        entry[0].root.classList.toggle('is-selected', selected);
        entry[0].root.setAttribute('aria-pressed', selected ? 'true' : 'false');
      });
    }

    app.appendChild(el('div', { class: 'kpis k8' }, [kItems.root, kPoints.root, kDone.root, kMid.root, kCarried.root, kNoTester.root, kTime.root, kCycle.root]));
    app.appendChild(el('div', { class: 'main sprint' }, [tBurn.root, tStatus.root, tType.root, tContribution.root]));
    app.appendChild(el('div', { class: 'lower' }, [tDetail.root, tMatrix.root]));

    // ---- filter bar controls (Fix version, Parent) ----
    function selectCtl(dim, label, values) {
      var sel = el('select', {
        id: 'f-' + dim,
        onchange: function () {
          if (sel.value === '') store.set(dim, []);
          else if (sel.value !== '__multi') store.set(dim, [sel.value]);
        }
      }, [el('option', { value: '', text: 'All' })]
        .concat(values.map(function (v) { return el('option', { value: v, text: v }); }))
        .concat([el('option', { value: '__multi', text: 'Multiple', disabled: true })]));
      return { sel: sel, root: el('div', { class: 'ctl' }, [el('label', { for: 'f-' + dim, text: label }), sel]) };
    }
    function distinct(fn) { // natural order, so Fix version 4.9 comes before 4.10 (C14); (none) last
      var seen = {}; tickets.forEach(function (t) { seen[fn(t)] = true; });
      var keys = Object.keys(seen).filter(function (k) { return k !== NONE; }).sort(AF.naturalCompare);
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
      var filtered = store.isActive({ extra: false }); // the KPI filters scope only the lower section
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
      kTime.value.textContent = withAging.length ? String(tis.length) : '—';
      kTime.hint.textContent = withAging.length ? 'In Progress / In Review tickets' : 'Days in status not available yet';
      var ct = AF.avgCycleTime(f);
      kCycle.value.textContent = ct.avg === null ? '—' : AF.oneDecimal(ct.avg);
      kCycle.hint.textContent = ct.n ? 'days, over ' + ct.n + ' Done ticket' + (ct.n === 1 ? '' : 's') : 'no Done tickets with a cycle time';
      var days = AF.config.midSprintThresholdDays, mid = AF.midSprintAdded(f, sprint, days);
      kMid.value.textContent = String(mid.count);
      kMid.hint.textContent = fmt(mid.points) + ' points, added after day ' + days;
      if (!sprint.carriedOver) { kCarried.value.textContent = '—'; kCarried.hint.textContent = 'Not calculated yet for this sprint'; }
      else {
        var c = sprint.carriedOver, parts = [];
        if (c.percent !== null && c.percent !== undefined) parts.push(fmt(c.percent) + '% of tickets');
        if (c.storyPoints !== null && c.storyPoints !== undefined) parts.push(fmt(c.storyPoints) + ' points');
        kCarried.value.textContent = c.count === null || c.count === undefined ? '—' : String(c.count);
        kCarried.hint.textContent = parts.length ? parts.join(', ') : 'No figures in the sprint snapshot';
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
    // It is a non-modal region: focus stays on the marker, Escape or × closes it.
    function showPanel(list) {
      if (pop) pop.remove();
      var total = list.reduce(function (a, t) { return a + t.points; }, 0);
      var title = (keyKind() === 'removed' ? 'Removed ' : 'Added ') + AF.longDate(keyDate());
      var rows = list.map(function (t) {
        return el('tr', null, [
          el('td', null, [AF.ticketCell(t.ticket)]),
          el('td', { class: 'sum', text: AF.show(t.summary) }),
          el('td', { class: 'num', text: fmt(t.points) }),
          el('td', { text: AF.show(t.status) }),
          el('td', { text: AF.personName(t.owner) })
        ]);
      });
      pop = el('div', { class: 'bd-pop', role: 'region', 'aria-label': 'Tickets ' + (keyKind() === 'removed' ? 'removed ' : 'added ') + AF.longDate(keyDate()) }, [
        el('div', { class: 'bd-pop-head' }, [
          el('div', null, [
            el('strong', { text: title }),
            el('span', { class: 'bd-pop-sub', text: list.length + ' ticket' + (list.length === 1 ? '' : 's') + ', ' + fmt(total) + ' points' })
          ]),
          el('button', { type: 'button', class: 'bd-pop-x', 'aria-label': 'Close list', text: '×', onclick: function () { closePanel(); drawNow(); } })
        ]),
        el('div', { class: 'bd-pop-body' }, [
          el('table', { class: 'bd-pop-table' }, [
            el('thead', null, [el('tr', null, ['Ticket', 'Summary', 'Pts', 'Status', 'Assignee'].map(function (h) { return el('th', { scope: 'col', text: h }); }))]),
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
      var hasRemoved = Array.isArray(sprint.removed);
      var rf = hasRemoved ? store.apply(sprint.removed) : []; // removed tickets follow the same filters (they carry the filter fields)
      var m = AF.burndown(f, sprint, data.refreshedAt, days, rf, { closed: isClosed });
      lastModel = null; if (pop) { pop.remove(); pop = null; }
      AF.rebuild(tBurn, function () {
        var sub = tBurn.head.querySelector('.sub');
        if (!f.length) { closePanel(); sub.textContent = ''; tBurn.body.appendChild(AF.emptyState(EMPTY)); return; }
        var cur = m.todayIndex >= 0 ? m.days[m.todayIndex] : null;
        var when = isClosed || data.refreshedAt > m.days[m.n - 1].date ? 'at sprint end' : 'today';
        var summary = cur ? fmt(cur.remaining) + ' of ' + fmt(cur.scope) + ' points remaining ' + when + ', ideal ' + AF.oneDecimal(cur.ideal) : null;
        sub.textContent = summary || 'The sprint has not started yet';
        lastOpts = {
          thresholdDays: days, onMarker: onMarker, selectedKey: selectedKey,
          label: 'Burndown chart for ' + (sprint.name || 'the sprint') + ': ' + (summary ? summary + '.' : 'not started.')
        };
        lastModel = m;
        // keep the open panel when its date still has tickets after the filter change
        var byKind = keyKind() === 'removed' ? m.removedByDate : m.addedByDate;
        if (selectedKey && byKind[keyDate()]) showPanel(byKind[keyDate()]); else closePanel();
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
      var observer = new ResizeObserver(function () {
        var w = tBurn.body.clientWidth, h = tBurn.body.clientHeight;
        if ((w !== lw || h !== lh) && lastModel) { lw = w; lh = h; AF.drawBurndown(tBurn.body, lastModel, lastOpts); }
      });
      observer.observe(tBurn.body); // observe() returns undefined, so keep the observer itself (C2)
      activeObserver = observer;
    }

    // Tickets by status / Tickets by type: one clickable bar row per value with `N W.I | P SP` and a pinned Total.
    // rows: [{name, lead (dot or icon node), segCls, items, points}]; o: {dim, header, base, onClick(name, multi)}.
    function barRows(t, rows, o) {
      var selection = store.sel[o.dim], any = selection.size > 0;
      AF.rebuild(t, function () {
        if (!o.base.length) { t.body.appendChild(AF.emptyState(EMPTY)); return; }
        t.colhead.className = 'colhead bar-grid';
        t.colhead.appendChild(el('span', { text: o.header }));
        t.colhead.appendChild(el('span', { class: 'span2', text: 'Work items | Story points' }));
        rows.forEach(function (r) {
          var selected = selection.has(r.name);
          t.body.appendChild(AF.rowButton({
            key: o.dim + ':' + r.name, cls: 'bar-grid tall' + (r.items === 0 ? ' zero' : ''), selected: selected, dimmed: any && !selected,
            title: r.name + ': ' + r.items + ' work items, ' + fmt(r.points) + ' story points',
            onclick: function (multi) { o.onClick(r.name, multi); }
          }, [
            el('span', { class: 'name' }, [r.lead, r.name]),
            el('div', { class: 'bar-track' }, [el('div', { class: 'bar', style: { width: (r.items / o.base.length * 100).toFixed(2) + '%' } }, [
              el('span', { class: 'seg ' + r.segCls, style: { flex: '1 1 0' } })
            ])]),
            AF.pair(r.items, r.points)
          ]));
        });
        t.foot.appendChild(el('div', { class: 'bar-grid totalrow' }, [
          el('span', { text: 'Total' }), el('span'), AF.pair(o.base.length, AF.sum(o.base, 'points'))
        ]));
      });
    }

    function renderStatus() {
      var base = store.apply(tickets, 'status');
      var tot = AF.statusTotals(base);
      barRows(tStatus, visible.map(function (b) {
        return { name: AF.BUCKETS[b], lead: AF.statusDot(b), segCls: AF.BUCKET_CLASS[b], items: tot[b].items, points: tot[b].points };
      }), { dim: 'status', header: 'Status', base: base, onClick: function (name) { store.click('status', name, true); } }); // status rows always toggle (D60)
    }

    function renderTypes() {
      var base = store.apply(tickets, 'type');
      var groups = Object.create(null);
      base.forEach(function (ticket) {
        var name = store.dims.type.get(ticket);
        var group = groups[name] || (groups[name] = { items: 0, points: 0 });
        group.items += 1;
        group.points += AF.pts(ticket.points);
      });
      var keys = Object.keys(groups).sort(function (a, b) {
        return groups[b].items - groups[a].items || a.localeCompare(b);
      });
      barRows(tType, keys.map(function (name) {
        return { name: name, lead: AF.icon.type(name), segCls: 'type-bar', items: groups[name].items, points: groups[name].points };
      }), { dim: 'type', header: 'Type', base: base, onClick: function (name, multi) { store.click('type', name, multi); } });
    }

    // Team Contribution: one pass builds each person's role counts and unique tickets (C16).
    function renderContributions() {
      var base = store.apply(tickets, ['assignee', 'tester', 'contributor']);
      var people = new Map();
      function person(name) {
        var r = people.get(name);
        if (!r) { r = { name: name, assigneeItems: 0, testerItems: 0, tickets: new Map() }; people.set(name, r); }
        return r;
      }
      base.forEach(function (t) {
        var a = person(owner(t)), b = person(tester(t));
        a.assigneeItems += 1; a.tickets.set(t.ticket, t);
        b.testerItems += 1; b.tickets.set(t.ticket, t);
      });
      var rows = Array.from(people.values()).map(function (r) {
        var unique = Array.from(r.tickets.values());
        return { name: r.name, assigneeItems: r.assigneeItems, testerItems: r.testerItems, workItems: unique.length, totalPoints: AF.sum(unique, 'points') };
      }).sort(function (a, b) { return b.workItems - a.workItems || a.name.localeCompare(b.name); });
      var sel = store.sel;
      AF.rebuild(tContribution, function () {
        if (!rows.length) { tContribution.body.appendChild(AF.emptyState(EMPTY)); return; }
        tContribution.colhead.className = 'colhead contribution-grid';
        ['Name', 'Assignee W.I', 'Tester W.I', 'Total W.I | SP'].forEach(function (h) { tContribution.colhead.appendChild(el('span', { text: h })); });
        rows.forEach(function (row) {
          function button(dim, text, ariaLabel, title) {
            var selected = sel[dim].has(row.name), dimmed = sel[dim].size > 0 && !selected;
            return el('button', {
              type: 'button', 'data-key': dim + ':' + row.name, class: (dim === 'contributor' ? 'contribution-name' : 'contribution-value') + AF.stateClass(selected, dimmed),
              'aria-pressed': selected ? 'true' : 'false', 'aria-label': ariaLabel, title: title,
              onclick: function (event) { store.click(dim, row.name, AF.isMulti(event)); }
            }, [text]);
          }
          // the visible cells are bare numbers, so each button says what it counts and what it filters (C19)
          tContribution.body.appendChild(el('div', { class: 'contribution-grid contribution-row' }, [
            button('contributor', row.name, row.name + ': show tickets where ' + row.name + ' is assignee or tester', 'Show tickets where ' + row.name + ' is assignee or tester'),
            button('assignee', fmt(row.assigneeItems), row.name + ', Assignee W.I: ' + row.assigneeItems + '. Filter Assignee', 'Filter Assignee: ' + row.name),
            button('tester', fmt(row.testerItems), row.name + ', Tester W.I: ' + row.testerItems + '. Filter Tester', 'Filter Tester: ' + row.name),
            el('span', { class: 'contribution-total', text: row.workItems + ' W.I | ' + fmt(row.totalPoints) + ' SP' })
          ]));
        });
        tContribution.foot.appendChild(el('div', { class: 'contribution-grid totalrow' }, [
          el('span', { text: 'Total' }), el('span', { text: fmt(base.length) }), el('span', { text: fmt(base.length) }),
          el('span', { class: 'contribution-total', text: base.length + ' W.I | ' + fmt(AF.sum(base, 'points')) + ' SP' })
        ]));
        tContribution.foot.appendChild(el('p', { class: 'footnote', text: 'Assignee and Tester work item counts can overlap. Story points are shared and count once.' }));
      });
    }

    function renderMatrix() {
      var base = store.apply(tickets, ['assignee', 'tester'], { withExtra: true });
      var ct = AF.crossTab(base, owner, tester, { lastCol: 'Unassigned' });
      AF.rebuild(tMatrix, function () {
        if (!ct.rows.length) { tMatrix.body.appendChild(AF.emptyState(EMPTY)); return; }
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
      'Days in status': function (t) { return typeof t.statusAging === 'number' ? t.statusAging : null; },
      'Story points': function (t) { return t.points; },
      Parent: function (t) { return t.parent; },
      'Fix version': function (t) { return t.fixVersion; }
    };
    var NUMERIC_SORT = { 'Story points': true, 'Days in status': true };
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
      var numeric = !!NUMERIC_SORT[detailSort.key];
      return rows.slice().sort(function (a, b) {
        var av = getValue(a), bv = getValue(b);
        var aMissing = numeric ? typeof av !== 'number' || !isFinite(av) : AF.isBlank(av);
        var bMissing = numeric ? typeof bv !== 'number' || !isFinite(bv) : AF.isBlank(bv);
        if (aMissing || bMissing) return aMissing === bMissing ? 0 : (aMissing ? direction : -direction);
        return (numeric ? av - bv : AF.naturalCompare(av, bv)) * direction;
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
      var lf = lowerFilter();
      tDetail.head.querySelector('.sub').textContent = f.length + ' of ' + tickets.length + ' work items' +
        (lf ? ' · ' + LOWER_FILTERS[lf].label + ' (click KPI again to clear)' : '');
      AF.rebuild(tDetail, function () {
        if (!f.length) { tDetail.body.appendChild(AF.emptyState(EMPTY)); return; }
        tDetail.body.appendChild(sortableDetailTable(f));
      });
    }

    function renderLower() {
      renderDetail(store.apply(tickets, null, { withExtra: true }));
      renderMatrix();
    }

    function render() {
      var f = store.apply(tickets);
      renderKpis(f);
      renderBurndown(f);
      renderStatus();
      renderTypes();
      renderContributions();
      syncLowerKpis();
      renderLower();
      updateBar();
      syncCtl(fixCtl, 'fix');
      syncCtl(parentCtl, 'parent');
    }
    store.subscribe(function (reason) {
      if (reason === 'extra') { syncLowerKpis(); renderLower(); updateBar(); } // a KPI filter changes only the lower section
      else render();
    });
    render();
    AF.store = store; AF.tickets = tickets; // exposed for console checks
  }
})();
