/* backlog.js — backlog page (backlog.html). Reads backlog.json only. Cross-filtering: SPEC §5. */
(function () {
  'use strict';
  var AF = window.AF, el = AF.el, fmt = AF.fmtNum;
  var app = document.getElementById('app');
  var barBox = document.getElementById('filterbar');
  var EMPTY = 'No backlog tickets match these filters. Remove a tag or use Reset all.';
  var DASH = '—';
  var DOR_WORDS = ['missing', 'weak', 'well-formed', 'n/a (epic)', 'ready']; // D51; 'ready' is the older name of Well-Formed
  var DOR_LABEL = { missing: 'Missing', weak: 'Weak', 'well-formed': 'Well-Formed', 'n/a (epic)': 'N/A (Epic)', ready: 'Ready' };
  var DOR_ORDER = ['Well-Formed', 'Ready', 'Weak', 'Missing', 'N/A (Epic)'];
  var DOR_CLASS = { 'Well-Formed': 'ready', Ready: 'ready', Weak: 'weak', Missing: 'missing' }; // anything else is neutral gray
  function dorClass(v) { return Object.prototype.hasOwnProperty.call(DOR_CLASS, v) ? DOR_CLASS[v] : 'other'; }
  var PRIORITY_ORDER = ['Highest', 'High', 'Medium', 'Low', 'Lowest'];
  var AGE = ['0–30', '31–90', '91–180', '181–365', '366+', 'No value'];
  var MIN_PREFIX = 3; // DECISIONS D22
  var NOEPIC = '(no epic)';

  function val(v) { return AF.isBlank(v) ? DASH : String(v); }
  function ageOf(t) {
    var d = t.days;
    if (typeof d !== 'number') return AGE[5];
    return d <= 30 ? AGE[0] : d <= 90 ? AGE[1] : d <= 180 ? AGE[2] : d <= 365 ? AGE[3] : AGE[4];
  }

  // DoR prefix search (DATA_CONTRACT §7): returns 'Missing' | 'Weak' | 'Ready' | null
  function dorFromQuery(q) {
    var s = String(q || '').trim().toLowerCase();
    if (s.length < MIN_PREFIX) return null;
    for (var i = 0; i < DOR_WORDS.length; i++) {
      if (DOR_WORDS[i].indexOf(s) === 0) return DOR_LABEL[DOR_WORDS[i]];
    }
    return null;
  }
  function haystack(t) {
    return [t.ticket, t.summary, t.epic, t.cluster, t.risk]
      .filter(function (v) { return !AF.isBlank(v); }).join('\n').toLowerCase();
  }
  // Returns { pred, tag } for a raw query, or null for an empty query.
  function searchFor(q) {
    var s = String(q || '').trim();
    if (!s) return null;
    var dq = dorFromQuery(s);
    if (dq) return { pred: function (t) { return t.dor === dq; }, tag: 'Search: DoR = ' + dq, dor: dq };
    var low = s.toLowerCase();
    return { pred: function (t) { return haystack(t).indexOf(low) !== -1; }, tag: 'Search: “' + s + '”', dor: null };
  }
  AF.backlog = { dorFromQuery: dorFromQuery, searchFor: searchFor, ageOf: ageOf };

  AF.loadSnapshot('backlog.json').then(init, function (err) { AF.showError(app, 'backlog.json', err); });

  function init(data) {
    var tickets = data.tickets;
    AF.setUpdated(data.refreshedAt, data.exportedAt);
    AF.clear(app);
    app.classList.add('bl');
    if (!tickets.length) {
      app.appendChild(el('section', { class: 'message neutral' }, [
        el('h2', { text: 'No backlog tickets in this snapshot' }),
        el('p', { text: 'Run a backlog refinement pass, then python3 05_Automation/export_dashboard_snapshots.py, and reload.' })
      ]));
      return;
    }

    var store = AF.createStore({
      dor: { label: 'DoR', get: function (t) { return val(t.dor); } },
      priority: { label: 'Priority', get: function (t) { return val(t.priority); } },
      type: { label: 'Type', get: function (t) { return val(t.type); } },
      age: { label: 'Age', get: ageOf },
      epic: { label: 'Epic', get: function (t) { return AF.isBlank(t.epic) ? NOEPIC : String(t.epic); } }
    });
    var K = { dor: store.dims.dor.get, priority: store.dims.priority.get, type: store.dims.type.get, age: store.dims.age.get, epic: store.dims.epic.get };

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
    function kpi(kind, label) {
      var value = el('div', { class: 'value' }), hint = el('div', { class: 'hint' });
      return { root: el('section', { class: 'tile kpi ' + kind }, [el('div', { class: 'label', text: label }), value, hint]), value: value, hint: hint };
    }
    var kTotal = kpi('items', 'Backlog tickets'), kPoints = kpi('points', 'Estimated story points');
    var kRefine = kpi('plain', 'Needing refinement'), kSplit = kpi('plain', 'Needs splitting'), kMedian = kpi('plain', 'Median days in status');
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
    var hint = el('p', { class: 'dorhint', 'aria-live': 'polite' });
    var input = el('input', {
      id: 'q', type: 'search', placeholder: 'Search, or type well-formed, weak, missing', autocomplete: 'off',
      oninput: function () { var s = searchFor(input.value); store.setSearch(input.value, s && s.pred, s ? s.tag : ''); }
    });
    var searchCtl = el('div', { class: 'ctl' }, [el('label', { for: 'q', text: 'Search' }), input]);
    // ---- filter bar: Epic multi-select with checkboxes (SPEC 7.4, D48) ----
    var allEpic = AF.countBy(tickets, K.epic);
    var epicKeys = Object.keys(allEpic).filter(function (k) { return k !== NOEPIC; })
      .sort(function (a, b) { return allEpic[b] - allEpic[a] || a.localeCompare(b); }).concat(allEpic[NOEPIC] ? [NOEPIC] : []);
    var epicBtn = el('button', { type: 'button', class: 'epicbtn', id: 'epic-btn', 'aria-haspopup': 'true', 'aria-expanded': 'false', onclick: function () { setEpicOpen(epicPop.hidden); } });
    var epicOpts = {};
    var epicPop = el('div', { class: 'epicpop', role: 'group', 'aria-label': 'Epics', hidden: true }, [
      el('div', { class: 'epichead' }, [
        el('span', { text: 'Tick one or more epics' }),
        el('button', { type: 'button', class: 'epicclear', text: 'Clear', onclick: function () { store.set('epic', []); } })
      ]),
      el('div', { class: 'epiclist' }, epicKeys.map(function (k) {
        var box = el('input', { type: 'checkbox', value: k, onchange: function () { store.click('epic', k, true); } });
        var n = el('span', { class: 'n' });
        epicOpts[k] = { box: box, n: n };
        return el('label', { class: 'epicopt', title: k }, [box, el('span', { class: 'name', text: k }), n]);
      }))
    ]);
    var epicCtl = el('div', { class: 'ctl epicwrap' }, [epicBtn, epicPop]);
    function setEpicOpen(open) { epicPop.hidden = !open; epicBtn.setAttribute('aria-expanded', open ? 'true' : 'false'); }
    document.addEventListener('click', function (e) { if (!epicPop.hidden && !epicCtl.contains(e.target)) setEpicOpen(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !epicPop.hidden) { setEpicOpen(false); epicBtn.focus(); } });
    function syncEpic() { // updates state only, never rebuilds the panel, so focus and the open state survive a filter change
      var counts = AF.countBy(store.apply(tickets, 'epic'), K.epic), sel = store.sel.epic;
      epicKeys.forEach(function (k) { epicOpts[k].box.checked = sel.has(k); epicOpts[k].n.textContent = String(counts[k] || 0); });
      epicBtn.textContent = 'Epic' + (sel.size ? ' (' + sel.size + ')' : '') + ' \u25be';
    }
    var updateBar = AF.filterBar(barBox, store, [epicCtl, searchCtl]);
    barBox.appendChild(hint);

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
        tTable.body.appendChild(AF.buildTable(cols, f, { cls: 'data wider' }));
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
      syncEpic();
      if (input.value !== store.search.q) input.value = store.search.q;
      var s = searchFor(store.search.q);
      hint.textContent = s && s.dor ? 'Searching by readiness: DoR = ' + s.dor + '.' : '';
    }
    store.subscribe(render);
    render();
    AF.store = store; AF.tickets = tickets; // exposed for console checks
  }
})();
