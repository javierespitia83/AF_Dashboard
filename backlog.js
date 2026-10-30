/* backlog.js — backlog page (backlog.html). Reads backlog.json only. Cross-filtering: SPEC §5. */
(function () {
  'use strict';
  var AF = window.AF, el = AF.el, fmt = AF.fmtNum;
  var app = document.getElementById('app');
  var barBox = document.getElementById('filterbar');
  var EMPTY = 'No backlog tickets match these filters. Remove a tag or use Reset all.';
  var DASH = '—';
  var DOR_ORDER = ['Well-Formed', 'Ready', 'Weak', 'Missing', 'N/A (Epic)'];
  var DOR_CLASS = { 'Well-Formed': 'ready', Ready: 'ready', Weak: 'weak', Missing: 'missing' }; // anything else is neutral gray
  function dorClass(v) { return Object.prototype.hasOwnProperty.call(DOR_CLASS, v) ? DOR_CLASS[v] : 'other'; }
  var PRIORITY_ORDER = ['Highest', 'High', 'Medium', 'Low', 'Lowest'];
  var AGE = ['0–30', '31–90', '91–180', '181–365', '366+', 'No value'];

  function val(v) { return AF.isBlank(v) ? DASH : String(v); }
  function ageOf(t) {
    var d = t.days;
    if (typeof d !== 'number') return AGE[5];
    return d <= 30 ? AGE[0] : d <= 90 ? AGE[1] : d <= 180 ? AGE[2] : d <= 365 ? AGE[3] : AGE[4];
  }

  // Search (R001-19, SPEC §7.3): key (partial), summary words, DoR status, epic (key or title); nothing else.
  // `well-formed` is a whole phrase on the DoR field. Replaces the DoR prefix search of D22 / D51.
  var SEARCH_SPEC = {
    fields: [
      { kind: 'key', get: function (t) { return t.ticket; } },
      { kind: 'text', get: function (t) { return t.summary; } },
      { kind: 'text', get: function (t) { return t.dor; } },
      { kind: 'linked', get: function (t) { return t.epic; } }
    ],
    phrases: [{ text: 'well-formed', test: function (t) { return t.dor === 'Well-Formed'; } }]
  };
  function searchFor(q) { return AF.compileSearch(q, SEARCH_SPEC); }
  AF.backlog = { searchFor: searchFor, ageOf: ageOf };

  AF.loadSnapshot('backlog.json').then(function (data) {
    try { init(data); } catch (err) { AF.showRenderError(app, err); } // a drawing bug is not reported as a load error (C7)
  }, function (err) { AF.showError(app, 'backlog.json', err); });

  function init(data) {
    var tickets = data.tickets;
    AF.setUpdated(data.refreshedAt, data.exportedAt);
    AF.clear(app);
    app.classList.add('bl');
    if (!tickets.length) {
      AF.emptyMessage(app, 'No backlog tickets in this snapshot', 'Run a backlog refinement pass, then python3 05_Automation/export_dashboard_snapshots.py, and reload.');
      return;
    }

    var store = AF.createStore({
      dor: { label: 'DoR', get: function (t) { return val(t.dor); } },
      priority: { label: 'Priority', get: function (t) { return val(t.priority); } },
      type: { label: 'Type', get: function (t) { return val(t.type); } },
      age: { label: 'Age', get: ageOf }
    });
    var K = { dor: store.dims.dor.get, priority: store.dims.priority.get, type: store.dims.type.get, age: store.dims.age.get };

    // Value lists from the whole data so tile rows stay stable while filtering.
    function ordered(counts, preferred) {
      var keys = Object.keys(counts);
      var first = preferred.filter(function (k) { return counts[k]; });
      var rest = keys.filter(function (k) { return preferred.indexOf(k) === -1 && k !== DASH; })
        .sort(function (a, b) { return counts[b] - counts[a] || a.localeCompare(b); });
      return first.concat(rest).concat(counts[DASH] ? [DASH] : []);
    }
    var allDor = AF.countBy(tickets, K.dor), allPrio = AF.countBy(tickets, K.priority);
    var allType = AF.countBy(tickets, K.type), allAge = AF.countBy(tickets, K.age);
    var dorKeys = ordered(allDor, DOR_ORDER), prioKeys = ordered(allPrio, PRIORITY_ORDER);
    var typeKeys = ordered(allType, []);
    var ageKeys = AGE.filter(function (k) { return k !== AGE[5] || allAge[AGE[5]]; });

    // ---- shell ----
    var kTotal = AF.kpi('items', 'Backlog tickets'), kPoints = AF.kpi('points', 'Estimated story points');
    var kRefine = AF.kpi('plain', 'Needing refinement'), kSplit = AF.kpi('plain', 'Needs splitting'), kMedian = AF.kpi('plain', 'Median days in status');
    var tDor = AF.tile({ title: 'Readiness (DoR)', sub: 'Click to filter' });
    var tPrio = AF.tile({ title: 'Priority', sub: 'Click to filter' });
    var tType = AF.tile({ title: 'Type', sub: 'Click to filter' });
    var tAge = AF.tile({ title: 'Days in status', sub: 'Time since last status change' });
    var tMatrix = AF.tile({ title: 'Readiness x priority', sub: 'Tickets per pair. Click a cell.' });
    var tTable = AF.tile({ title: 'Backlog tickets', sub: '' });

    app.appendChild(el('div', { class: 'kpis k5' }, [kTotal.root, kPoints.root, kRefine.root, kSplit.root, kMedian.root]));
    app.appendChild(el('div', { class: 'main backlog' }, [tDor.root, tPrio.root, tType.root, tAge.root, tMatrix.root]));
    app.appendChild(el('div', { class: 'detail' }, [tTable.root]));

    // ---- filter bar: search ----
    var search = null;
    function setQuery(q) {
      search = searchFor(q);
      store.setSearch(search ? q : '', search && search.pred, search ? search.tag : '');
    }
    var searchBox = AF.searchBox({ placeholder: 'Search by key, title, status, epic...', value: AF.urlParam('q'), onChange: setQuery });
    var searchCtl = searchBox.root;
    var updateBar = AF.filterBar(barBox, store, [searchCtl]); // Epic dropdown removed (R001-19): the search finds an epic by key or title

    // ---- renderers ----
    function renderKpis(f) {
      var filtered = store.isActive();
      var days = f.map(function (t) { return t.days; }).filter(function (v) { return typeof v === 'number'; });
      var m = AF.median(days);
      kTotal.value.textContent = String(f.length);
      kTotal.hint.textContent = filtered ? 'of ' + tickets.length : 'rows in Backlog Prioritized';
      kPoints.value.textContent = fmt(AF.sum(f, 'points'));
      kPoints.hint.textContent = filtered ? 'of ' + fmt(AF.sum(tickets, 'points')) : 'missing estimates count as 0';
      kRefine.value.textContent = String(f.filter(function (t) { return t.dor === 'Weak' || t.dor === 'Missing'; }).length);
      kRefine.hint.textContent = 'readiness Weak or Missing';
      kSplit.value.textContent = String(f.filter(function (t) { return !AF.isBlank(t.needsSplitting); }).length);
      kSplit.hint.textContent = 'too large for one sprint';
      kMedian.value.textContent = m === null ? DASH : fmt(m);
      kMedian.hint.textContent = days.length ? 'maximum ' + fmt(Math.max.apply(null, days)) : 'no value in this set';
    }

    function renderDist(t, dim, keys, fillFn, iconFn) {
      var base = store.apply(tickets, dim);
      var counts = AF.countBy(base, K[dim]);
      var s = store.sel[dim], any = s.size > 0;
      var max = Math.max.apply(null, [1].concat(keys.map(function (k) { return counts[k] || 0; })));
      AF.rebuild(t, function () {
        if (!base.length) { t.body.appendChild(AF.emptyState(EMPTY)); return; }
        keys.forEach(function (k) {
          var n = counts[k] || 0, selected = s.has(k);
          t.body.appendChild(AF.rowButton({
            key: dim + ':' + k, cls: 'dist-grid' + (n === 0 ? ' zero' : ''), selected: selected, dimmed: any && !selected,
            title: k + ': ' + n + ' tickets', onclick: function (m) { store.click(dim, k, m); }
          }, [
            el('span', { class: 'name' }, [iconFn ? iconFn(k) : null, k]),
            AF.simpleBar(n / max * 100, fillFn(k)),
            el('span', { class: 'n', text: String(n) })
          ]));
        });
      });
    }

    function renderMatrix() {
      var base = store.apply(tickets, ['dor', 'priority']);
      var ct = AF.crossTab(base, K.priority, K.dor, { rowOrder: prioKeys, colOrder: dorKeys });
      AF.rebuild(tMatrix, function () {
        if (!ct.rows.length) { tMatrix.body.appendChild(AF.emptyState(EMPTY)); return; }
        AF.heatGrid(tMatrix, ct, {
          corner: 'Priority', unit: 'tickets', rowSel: store.sel.priority, colSel: store.sel.dor,
          onCell: function (r, c, m) { store.clickPair('priority', r, 'dor', c, m); }
        });
      });
    }

    function iconText(v, iconFn) { // icon before the text; values without an icon stay text only
      var ic = AF.isBlank(v) ? null : iconFn(String(v));
      return ic ? el('span', { class: 'withico' }, [ic, String(v)]) : AF.show(v);
    }
    function pill(dor) {
      if (AF.isBlank(dor)) return DASH;
      return el('span', { class: 'pill ' + dorClass(dor), text: dor });
    }
    var cols = [
      { label: 'Ticket', cls: 'nowrap', render: function (t) { return AF.ticketCell(t.ticket); } },
      { label: 'Summary', cls: 'wrap', render: function (t) { return AF.show(t.summary); } },
      { label: 'DoR status', cls: 'center nowrap', render: function (t) { return pill(t.dor); } },
      { label: 'Priority', cls: 'nowrap', render: function (t) { return iconText(t.priority, AF.icon.priority); } },
      { label: 'Type', cls: 'nowrap', render: function (t) { return iconText(t.type, AF.icon.type); } },
      { label: 'Story points', cls: 'num', render: function (t) { return AF.showPoints(t.points); } },
      { label: 'Days in status', cls: 'num', render: function (t) { return AF.showPoints(t.days); } },
      { label: 'Epic', cls: 'wrap', render: function (t) { return AF.linkCell(t.epic); } },
      { label: 'Needs splitting', cls: 'center nowrap', render: function (t) { return AF.isBlank(t.needsSplitting) ? DASH : el('span', { class: 'flag', text: t.needsSplitting }); } },
      { label: 'Risk / open question', cls: 'wrap', render: function (t) { return AF.show(t.risk); } },
      { label: 'Related / cluster', cls: 'wrap', render: function (t) { return AF.linkCell(t.cluster); } }
    ];
    function renderTable(f) {
      tTable.head.querySelector('.sub').textContent = 'Showing ' + f.length + ' of ' + tickets.length + ' tickets';
      AF.rebuild(tTable, function () {
        if (!f.length) { tTable.body.appendChild(AF.emptyState(EMPTY)); return; }
        tTable.body.appendChild(AF.buildTable(cols, AF.exactFirst(f, search), { cls: 'data wider' })); // a searched key comes first
      });
    }

    function render() {
      var f = store.apply(tickets);
      renderKpis(f);
      renderDist(tDor, 'dor', dorKeys, dorClass);
      renderDist(tPrio, 'priority', prioKeys, function () { return ''; }, AF.icon.priority);
      renderDist(tType, 'type', typeKeys, function () { return 'teal'; }, AF.icon.type);
      renderDist(tAge, 'age', ageKeys, function () { return ''; });
      renderMatrix();
      renderTable(f);
      updateBar();
      if (!store.search.pred) search = null; // the tag ×, Reset all and the clear button all end here
      searchBox.sync(store.search.q);
      AF.setUrlParam('q', store.search.pred ? store.search.q.trim() : '');
    }
    store.subscribe(render);
    if (AF.urlParam('q')) setQuery(AF.urlParam('q')); // a link with ?q= restores the search
    render();
    AF.store = store; AF.tickets = tickets; // exposed for console checks
  }
})();
