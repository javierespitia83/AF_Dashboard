/*
 * dashboard.js — shared engine for index.html and backlog.html.
 * Plain JavaScript, no dependencies, no network except the two local JSON files.
 * Rules: DATA_CONTRACT.md. The filter store and the aggregation functions are
 * pure (no DOM) so numbers can be checked in the console, e.g. AF.statusTotals(rows).
 */
(function () {
  'use strict';

  var root = typeof window !== 'undefined' ? window : globalThis;

  // ---- Status buckets (DATA_CONTRACT §5) ---------------------------------
  var BUCKETS = ['To Do/Open', 'In Progress', 'In Review', 'Done', 'Other'];
  var BUCKET_CLASS = ['b-todo', 'b-prog', 'b-review', 'b-done', 'b-other'];
  var OTHER = 4;
  var NONE = '(none)';

  function bucketOf(status) {
    switch (status) {
      case 'To Do':
      case 'Open': return 0;
      case 'In Progress': return 1;
      case 'In Review': return 2;
      case 'Done': return 3;
      default: return OTHER; // unknown or null: never dropped
    }
  }

  // ---- Values and display (DATA_CONTRACT §4) ------------------------------
  function isBlank(v) {
    return v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
  }
  function pts(v) { return typeof v === 'number' && isFinite(v) ? v : 0; } // missing counts as 0
  function fmtNum(n) {
    return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
  }
  function show(v) { return isBlank(v) ? '—' : String(v); }
  function showPoints(v) { return typeof v === 'number' && isFinite(v) ? fmtNum(v) : '—'; }
  function personName(v) {
    return isBlank(v) || String(v).trim() === 'Unassigned' ? 'Unassigned' : String(v);
  }

  // ---- Settings (SPEC §6.2 / D38) -------------------------------------------
  var config = {
    midSprintThresholdDays: 2 // tickets added later than start + this many days count as "added mid-sprint"
  };

  // ---- Aggregation (pure) --------------------------------------------------
  function sum(tickets, key) {
    return tickets.reduce(function (s, t) { return s + pts(t[key]); }, 0);
  }

  function statusTotals(tickets) {
    var out = BUCKETS.map(function () { return { items: 0, points: 0 }; });
    tickets.forEach(function (t) {
      var b = bucketOf(t.status);
      out[b].items += 1;
      out[b].points += pts(t.points);
    });
    return out;
  }

  // Group tickets by keyFn(ticket); each group keeps work items and points per status bucket.
  function aggregateBy(tickets, keyFn) {
    var map = {};
    tickets.forEach(function (t) {
      var name = keyFn(t);
      var b = bucketOf(t.status);
      var r = map[name] || (map[name] = {
        name: name,
        items: BUCKETS.map(function () { return 0; }),
        points: BUCKETS.map(function () { return 0; }),
        itemsTotal: 0,
        pointsTotal: 0
      });
      r.items[b] += 1;
      r.points[b] += pts(t.points);
      r.itemsTotal += 1;
      r.pointsTotal += pts(t.points);
    });
    var rows = Object.keys(map).map(function (k) { return map[k]; });
    rows.sort(function (a, b) {
      return b.pointsTotal - a.pointsTotal || a.name.localeCompare(b.name);
    });
    var totals = { itemsTotal: 0, pointsTotal: 0 };
    rows.forEach(function (r) { totals.itemsTotal += r.itemsTotal; totals.pointsTotal += r.pointsTotal; });
    return { rows: rows, totals: totals };
  }

  function countBy(tickets, keyFn) {
    var m = {};
    tickets.forEach(function (t) { var k = keyFn(t); m[k] = (m[k] || 0) + 1; });
    return m;
  }

  // Cross-tab of two keys. opts: rowOrder / colOrder (arrays), lastCol (name pushed last).
  function crossTab(tickets, rowKey, colKey, opts) {
    opts = opts || {};
    var cells = {}, rt = {}, ct = {};
    tickets.forEach(function (t) {
      var r = rowKey(t), c = colKey(t);
      (cells[r] = cells[r] || {})[c] = ((cells[r] || {})[c] || 0) + 1;
      rt[r] = (rt[r] || 0) + 1;
      ct[c] = (ct[c] || 0) + 1;
    });
    function order(totals, given, last) {
      var keys = Object.keys(totals);
      if (given) return given.filter(function (k) { return totals[k]; });
      keys.sort(function (a, b) {
        if (last) { if (a === last && b !== last) return 1; if (b === last && a !== last) return -1; }
        return totals[b] - totals[a] || a.localeCompare(b);
      });
      return keys;
    }
    var rows = order(rt, opts.rowOrder, opts.lastRow), cols = order(ct, opts.colOrder, opts.lastCol);
    var max = 0;
    rows.forEach(function (r) { cols.forEach(function (c) { max = Math.max(max, (cells[r] || {})[c] || 0); }); });
    return { rows: rows, cols: cols, cells: cells, rowTotals: rt, colTotals: ct, max: max };
  }

  function median(values) {
    if (!values.length) return null;
    var s = values.slice().sort(function (a, b) { return a - b; });
    var m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  // ---- Filter store (pure; DATA_CONTRACT §6) -------------------------------
  // dims: { name: { label, get(ticket) -> string } }
  function createStore(dims) {
    var sel = {};
    Object.keys(dims).forEach(function (k) { sel[k] = new Set(); });
    var search = { q: '', pred: null, tag: '' };
    var subs = [];
    function emit() { subs.forEach(function (f) { f(); }); }
    function exceptMap(except) {
      var o = {};
      (Array.isArray(except) ? except : except ? [except] : []).forEach(function (k) { o[k] = true; });
      return o;
    }
    var store = {
      dims: dims, sel: sel, search: search,
      subscribe: function (f) { subs.push(f); },
      isActive: function () {
        return Object.keys(sel).some(function (k) { return sel[k].size > 0; }) || !!search.pred;
      },
      // tickets that match every active filter except the dimensions in `except`
      apply: function (tickets, except) {
        var ex = exceptMap(except);
        var active = Object.keys(sel).filter(function (k) { return !ex[k] && sel[k].size > 0; });
        return tickets.filter(function (t) {
          for (var i = 0; i < active.length; i++) {
            if (!sel[active[i]].has(dims[active[i]].get(t))) return false;
          }
          return !(search.pred && !search.pred(t));
        });
      },
      click: function (dim, value, multi) {
        var s = sel[dim];
        if (multi) { if (s.has(value)) s.delete(value); else s.add(value); }
        else if (s.size === 1 && s.has(value)) s.clear();
        else { s.clear(); s.add(value); }
        emit();
      },
      clickPair: function (dimA, a, dimB, b, multi) {
        var sa = sel[dimA], sb = sel[dimB];
        if (multi) {
          if (sa.has(a) && sb.has(b)) { sa.delete(a); sb.delete(b); } else { sa.add(a); sb.add(b); }
        } else if (sa.size === 1 && sa.has(a) && sb.size === 1 && sb.has(b)) { sa.clear(); sb.clear(); }
        else { sa.clear(); sa.add(a); sb.clear(); sb.add(b); }
        emit();
      },
      set: function (dim, values) { sel[dim].clear(); values.forEach(function (v) { sel[dim].add(v); }); emit(); },
      remove: function (dim, value) { sel[dim].delete(value); emit(); },
      setSearch: function (q, pred, tag) { search.q = q; search.pred = pred || null; search.tag = tag || ''; emit(); },
      reset: function () {
        Object.keys(sel).forEach(function (k) { sel[k].clear(); });
        search.q = ''; search.pred = null; search.tag = '';
        emit();
      },
      tags: function () {
        var out = [];
        Object.keys(dims).forEach(function (k) {
          sel[k].forEach(function (v) { out.push({ dim: k, label: dims[k].label, value: v }); });
        });
        return out;
      }
    };
    return store;
  }

  // ---- Sprint dates, burndown and cycle time (pure; DATA_CONTRACT §6) -------
  var DAY_MS = 86400000;
  function dayNum(iso) { // 'YYYY-MM-DD' -> days since epoch (UTC, no time-zone shifts); NaN if not a date
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    return m ? Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / DAY_MS) : NaN;
  }
  function isoOf(n) { return new Date(n * DAY_MS).toISOString().slice(0, 10); }
  function shortDate(iso) { return Number(iso.slice(5, 7)) + '/' + Number(iso.slice(8, 10)); }
  var MONTHS = ['Jan.', 'Feb.', 'Mar.', 'Apr.', 'May', 'Jun.', 'Jul.', 'Aug.', 'Sep.', 'Oct.', 'Nov.', 'Dec.'];
  function longDate(iso) { return MONTHS[Number(iso.slice(5, 7)) - 1] + ' ' + Number(iso.slice(8, 10)) + ', ' + iso.slice(0, 4); } // 'Sep. 28, 2026'

  function avgCycleTime(tickets) {
    var vals = tickets.filter(function (t) { return bucketOf(t.status) === 3 && typeof t.cycleTime === 'number' && isFinite(t.cycleTime); })
      .map(function (t) { return t.cycleTime; });
    if (!vals.length) return { avg: null, n: 0 };
    return { avg: vals.reduce(function (a, b) { return a + b; }, 0) / vals.length, n: vals.length };
  }
  function oneDecimal(x) { return fmtNum(Math.round(x * 10) / 10); }

  // Tickets added after sprint start + thresholdDays, using exported Added to Sprint dates.
  function midSprintAdded(tickets, sprint, thresholdDays) {
    var out = { thresholdDate: null, count: 0, points: 0, tickets: [] };
    if (!sprint || isNaN(dayNum(sprint.startDate))) return null;
    out.thresholdDate = isoOf(dayNum(sprint.startDate) + thresholdDays);
    tickets.forEach(function (t) {
      if (!isBlank(t.addedDate) && String(t.addedDate) > out.thresholdDate) {
        out.count += 1; out.points += pts(t.points); out.tickets.push(t);
      }
    });
    return out;
  }

  // Burndown model for a set of tickets. Returns null when the sprint dates are missing or invalid.
  function burndown(tickets, sprint, today, thresholdDays, removed, opts) {
    if (!sprint) return null;
    opts = opts || {};
    var s = dayNum(sprint.startDate), e = dayNum(sprint.endDate);
    if (isNaN(s) || isNaN(e) || e < s) return null;
    var n = e - s + 1, i;
    // scope steps up on each ticket's added date (D45); a missing or early date means in scope from day one
    var addedOn = [], removedOn = [], doneOn = [], doneTickets = [];
    for (i = 0; i < n; i++) { addedOn.push(0); removedOn.push(0); doneOn.push(0); doneTickets.push(0); }
    var unplaced = 0, unplacedPoints = 0, afterEnd = 0;
    tickets.forEach(function (t) {
      var a = dayNum(t.addedDate), addIdx = isNaN(a) ? 0 : Math.min(n - 1, Math.max(0, a - s));
      addedOn[addIdx] += pts(t.points);
      if (bucketOf(t.status) !== 3) return;
      var d = dayNum(t.doneDate);
      if (isNaN(d)) { unplaced += 1; unplacedPoints += pts(t.points); return; }
      var idx = Math.max(0, d - s);                  // a done date before the start counts on day 1
      if (idx >= n) { afterEnd += 1; return; }       // done after the sprint ended: outside the chart
      idx = Math.max(idx, addIdx);                   // never subtracted before it entered the scope
      doneOn[idx] += pts(t.points); doneTickets[idx] += 1;
    });
    // tickets that left the sprint (sprint.removed, D52): in scope from their entry day until their removal day, never done
    var removedByDate = {};
    (removed || []).forEach(function (r) {
      var rd = dayNum(r.removedDate); if (isNaN(rd)) return;      // no valid removal date: ignored
      var a = dayNum(r.addedDate), addIdx = isNaN(a) ? 0 : Math.min(n - 1, Math.max(0, a - s));
      var remIdx = Math.max(addIdx, Math.min(n - 1, Math.max(0, rd - s)));
      addedOn[addIdx] += pts(r.points); removedOn[remIdx] += pts(r.points);
      var k = isoOf(s + remIdx);
      (removedByDate[k] = removedByDate[k] || []).push({ ticket: r.ticket, points: pts(r.points), summary: r.summary, status: r.status, owner: r.owner });
    });
    var chartDate = opts.closed ? sprint.endDate : today;
    var td = dayNum(chartDate), todayIndex = isNaN(td) ? -1 : Math.max(-1, Math.min(n - 1, td - s));
    var todayInside = !opts.closed && !isNaN(td) && td >= s && td <= e; // closed sprints have no live Today marker
    var days = [], cum = 0, scope = 0, start = addedOn[0] - removedOn[0], maxScope = 0;
    for (i = 0; i < n; i++) {
      scope += addedOn[i] - removedOn[i]; cum += doneOn[i]; maxScope = Math.max(maxScope, scope);
      days.push({
        date: isoOf(s + i), scope: scope, ideal: n > 1 ? start * (1 - i / (n - 1)) : 0,
        remaining: i <= todayIndex ? scope - cum : null, doneToday: doneOn[i], doneTickets: doneTickets[i]
      });
    }
    var total = maxScope; // the y axis tops out at the largest scope
    var mid = midSprintAdded(tickets, sprint, thresholdDays), byDate = {}, midBy = {}, lastDay = days[n - 1].date, limit = isoOf(s + thresholdDays);
    tickets.forEach(function (t) {
      if (isBlank(t.addedDate) || String(t.addedDate) <= sprint.startDate) return; // the starting scope has no marker
      var k = String(t.addedDate) > lastDay ? lastDay : String(t.addedDate);
      var item = { ticket: t.ticket, points: pts(t.points), summary: t.summary, status: t.status, owner: t.owner };
      (byDate[k] = byDate[k] || []).push(item);
      if (String(t.addedDate) > limit) (midBy[k] = midBy[k] || []).push(item);
    });
    return { days: days, total: total, startScope: start, n: n, todayIndex: todayIndex, todayInside: todayInside, unplacedDone: unplaced, unplacedPoints: unplacedPoints,
             afterEndDone: afterEnd, mid: mid, removedByDate: removedByDate, addedByDate: byDate, midByDate: midBy, thresholdDate: limit };
  }

  // Nice upper bound and tick step for the y axis.
  function niceScale(max) {
    if (!(max > 0)) return { top: 1, step: 1 };
    var steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000], step = steps[steps.length - 1];
    for (var i = 0; i < steps.length; i++) { if (max / steps[i] <= 6) { step = steps[i]; break; } }
    return { top: Math.ceil(max / step) * step, step: step };
  }

  // ---- DOM helpers (text nodes only, so data can never inject markup) ------
  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'class') n.className = v;
        else if (k === 'text') n.textContent = v;
        else if (k === 'style') n.setAttribute('style', v);
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') n.addEventListener(k.slice(2), v);
        else n.setAttribute(k, v === true ? '' : v);
      });
    }
    (children || []).forEach(function (c) {
      if (c === null || c === undefined) return;
      n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return n;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function isMulti(e) { return !!(e && (e.ctrlKey || e.metaKey || e.shiftKey)); }

  // Tile: card with head (title, subtitle), scrolling body, optional pinned foot.
  function tile(opts) {
    var head = el('div', { class: 'tile-head' }, [
      el('h2', { text: opts.title }),
      opts.sub !== undefined ? el('p', { class: 'sub', text: opts.sub }) : null
    ]);
    var colhead = el('div', { class: 'colhead' });
    var body = el('div', { class: 'tile-body', tabindex: '0', 'aria-label': opts.title });
    var foot = el('div', { class: 'tile-foot' });
    var rootEl = el('section', { class: 'tile ' + (opts.cls || '') }, [head, colhead, body, foot]);
    return { root: rootEl, head: head, colhead: colhead, body: body, foot: foot };
  }

  // Replace a tile's body/foot contents but keep the scroll position.
  function rebuild(tileObj, fn) {
    var top = tileObj.body.scrollTop, left = tileObj.body.scrollLeft;
    var active = document.activeElement;
    var focusKey = active && active.getAttribute && tileObj.root.contains(active) ? active.getAttribute('data-key') : null;
    clear(tileObj.colhead); clear(tileObj.body); clear(tileObj.foot);
    tileObj.colhead.style.display = ''; tileObj.foot.style.display = '';
    fn();
    if (!tileObj.colhead.firstChild) tileObj.colhead.style.display = 'none';
    if (!tileObj.foot.firstChild) tileObj.foot.style.display = 'none';
    tileObj.body.scrollTop = top; tileObj.body.scrollLeft = left;
    if (focusKey) { // keep keyboard focus on the same row or cell after the tile is redrawn
      var again = Array.prototype.filter.call(tileObj.root.querySelectorAll('[data-key]'), function (n) { return n.getAttribute('data-key') === focusKey; })[0];
      if (again) again.focus({ preventScroll: true });
    }
  }

  function rowButton(opts, children) {
    var cls = 'rowbtn' + (opts.cls ? ' ' + opts.cls : '') + (opts.selected ? ' sel' : '') + (opts.dimmed ? ' dim' : '');
    return el('button', {
      type: 'button', class: cls, title: opts.title || null, 'data-key': opts.key || null, 'aria-pressed': opts.selected ? 'true' : 'false',
      onclick: function (e) { opts.onclick(isMulti(e)); }
    }, children);
  }

  function statusDot(b) { return el('span', { class: 'dot ' + BUCKET_CLASS[b], 'aria-hidden': 'true' }); }

  // Stacked bar. segments: [{bucket, value, title}], scale = value of a full-width bar.
  function stackedBar(segments, total, scale) {
    var width = scale > 0 ? Math.max(total / scale * 100, total > 0 ? 1 : 0) : 0;
    var bar = el('div', { class: 'bar', style: 'width:' + width.toFixed(2) + '%' }, segments
      .filter(function (s) { return s.value > 0; })
      .map(function (s) {
        return el('span', { class: 'seg ' + BUCKET_CLASS[s.bucket], style: 'flex:' + s.value + ' 1 0', title: s.title });
      }));
    return el('div', { class: 'bar-track' }, [bar]);
  }

  // One-colour bar, width as a percentage of the track.
  function simpleBar(pct, cls, title) {
    return el('div', { class: 'bar-track' }, [
      el('div', { class: 'fill ' + (cls || ''), style: 'width:' + Math.max(0, Math.min(100, pct)).toFixed(2) + '%', title: title || null })
    ]);
  }

  // Teal heat ramp for matrix cells.
  function heatStyle(n, max) {
    if (!n || !max) return '';
    var a = 0.12 + 0.78 * (n / max);
    return 'background:rgba(42,157,143,' + a.toFixed(2) + ');color:' + (a > 0.55 ? '#fff' : 'var(--ink)');
  }

  // cols: [{label, cls, render(row, index) -> Node|string}]
  function buildTable(cols, rows, opts) {
    opts = opts || {};
    var head = el('tr', null, cols.map(function (c) {
      return el('th', { scope: 'col', class: c.cls || null, text: c.label });
    }));
    var body = el('tbody', null, rows.map(function (r, i) {
      return el('tr', null, cols.map(function (c) {
        var v = c.render(r, i);
        return el('td', { class: c.cls || null }, [v === null || v === undefined ? '—' : v]);
      }));
    }));
    return el('table', { class: opts.cls || null }, [el('thead', null, [head]), body]);
  }

  // ---- Burndown chart (inline SVG; SPEC §6.3) --------------------------------
  var SVG_NS = 'http://www.w3.org/2000/svg';
  function svg(tag, attrs, children) {
    var n = document.createElementNS(SVG_NS, tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k]; if (v === null || v === undefined) return;
      if (k === 'text') n.textContent = v; else n.setAttribute(k, v);
    });
    (children || []).forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }

  // ---- Priority and Type icons (inline SVG look-alikes of Jira's; SPEC §9b) ------
  function ico(name, children) {
    return svg('svg', { class: 'ico', width: 16, height: 16, viewBox: '0 0 16 16', 'aria-hidden': 'true', focusable: 'false', 'data-icon': name }, children);
  }
  function chev(points, color) { return svg('polyline', { points: points, fill: 'none', stroke: color, 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }); }
  function tbox(color, glyph) { return [svg('rect', { x: 1, y: 1, width: 14, height: 14, rx: 3, fill: color })].concat(glyph); }
  var W = '#ffffff';
  var PRIORITY_ICONS = {
    Highest: function () { return [svg('path', { d: 'M8 1.8 L2.8 8.2 H6.4 V14.2 H9.6 V8.2 H13.2 Z', fill: '#c9372c' })]; },
    High: function () { return [svg('rect', { x: 2.5, y: 4.2, width: 11, height: 2.4, rx: 1.2, fill: '#f08b1f' }), svg('rect', { x: 2.5, y: 9.4, width: 11, height: 2.4, rx: 1.2, fill: '#f08b1f' })]; },
    Medium: function () { return [chev('3.5,10.5 8,5.5 12.5,10.5', '#f2a229')]; },
    Low: function () { return [chev('3.5,5.5 8,10.5 12.5,5.5', '#2f7fe4')]; },
    Lowest: function () { return [chev('3.5,3.5 8,7.5 12.5,3.5', '#2f7fe4'), chev('3.5,8.5 8,12.5 12.5,8.5', '#2f7fe4')]; }
  };
  var TYPE_ICONS = {
    Story: function () { return tbox('#4bad40', [svg('path', { d: 'M5.2 3.4 H10.8 V12.8 L8 10.4 L5.2 12.8 Z', fill: W })]); },
    Bug: function () { return tbox('#e5493a', [svg('circle', { cx: 8, cy: 8.4, r: 3.1, fill: W }), svg('path', { d: 'M4.6 6.2 L6 7 M11.4 6.2 L10 7 M4.4 9 H5.6 M10.4 9 H11.6', stroke: W, 'stroke-width': 1.2, 'stroke-linecap': 'round', fill: 'none' })]); },
    'Sub-Bug': function () { return tbox('#e5493a', [svg('rect', { x: 3.8, y: 3.8, width: 4, height: 4, rx: 0.8, fill: W }), svg('rect', { x: 8.2, y: 8.2, width: 4, height: 4, rx: 0.8, fill: W }), svg('path', { d: 'M5.8 8 V10.2 H8', stroke: W, 'stroke-width': 1.2, fill: 'none' })]); },
    Epic: function () { return tbox('#904ee2', [svg('path', { d: 'M9.2 2.8 L5 8.7 H7.9 L6.9 13.2 L11.2 7.1 H8.2 Z', fill: W })]); },
    Task: function () { return tbox('#4688ec', [chev('4.8,8.3 7,10.5 11.3,5.6', W)]); },
    'Sub-task': function () { return tbox('#4688ec', [svg('rect', { x: 3.8, y: 3.8, width: 4, height: 4, rx: 0.8, fill: W }), svg('rect', { x: 8.2, y: 8.2, width: 4, height: 4, rx: 0.8, fill: W }), svg('path', { d: 'M5.8 8 V10.2 H8', stroke: W, 'stroke-width': 1.2, fill: 'none' })]); },
    Initiative: function () { return tbox('#f79232', [svg('path', { d: 'M8 3.4 L12 8 H9.4 V12.6 H6.6 V8 H4 Z', fill: W })]); },
    'Doc Task': function () { return tbox('#bf63f3', [svg('path', { d: 'M5 5 H11 M5 8 H11 M5 11 H9', stroke: W, 'stroke-width': 1.4, 'stroke-linecap': 'round', fill: 'none' })]); }
  };
  function iconFor(table, kind, name) {
    var f = Object.prototype.hasOwnProperty.call(table, name) ? table[name] : null;
    return f ? ico(kind + ':' + name, f()) : null;
  }
  var icon = {
    priority: function (name) { return iconFor(PRIORITY_ICONS, 'priority', name); },
    type: function (name) { return iconFor(TYPE_ICONS, 'type', name); }
  };

  // Draws the chart for model m (from burndown()) into container, sized to the container.
  function drawBurndown(container, m, opts) {
    clear(container);
    var W = Math.max(280, container.clientWidth), H = Math.max(120, container.clientHeight); // fits the tile exactly
    var small = H < 260; // short tiles (small laptop screens) get tighter margins
    var hasRem = Object.keys(m.removedByDate).length > 0, extra = hasRem ? 18 : 0; // removal triangles hang below the axis, so the date labels move down
    var L = 42, R = 16, T = small ? 34 : 42, B = (small ? 36 : 50) + extra, pw = W - L - R, ph = H - T - B;
    var sc = niceScale(m.total);
    var x = function (i) { return L + (m.n > 1 ? pw * i / (m.n - 1) : pw / 2); };
    var y = function (v) { return T + ph - ph * v / sc.top; };
    var step = m.n > 1 ? pw / (m.n - 1) : pw;
    var g = [];
    var INK = '#17263b', MUTED = '#566478', GRID = '#e8ecf1';
    // y grid and labels
    for (var v = 0; v <= sc.top + 1e-9; v += sc.step) {
      g.push(svg('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), stroke: GRID, 'stroke-width': 1 }));
      g.push(svg('text', { x: L - 6, y: y(v) + 4, 'text-anchor': 'end', 'font-size': 11, fill: MUTED, text: fmtNum(v) }));
    }
    var narrow = W < (hasRem ? 760 : 700); // not enough room for the axis title and the legend on one line
    if (!narrow) g.push(svg('text', { x: L, y: 14, 'font-size': 11, 'font-weight': 700, fill: MUTED, text: 'Story points remaining' }));
    // per-day hover columns (tooltips), drawn first so markers and lines stay on top
    m.days.forEach(function (d, i) {
      var tip = shortDate(d.date) + ': ' + (d.remaining === null ? 'ideal ' + oneDecimal(d.ideal) + ' points (future day)' : fmtNum(d.remaining) + ' points remaining of ' + fmtNum(d.scope) + ' in scope')
        + (d.remaining === null ? '' : ', ' + fmtNum(d.doneToday) + ' points done that day (' + d.doneTickets + ' tickets)');
      g.push(svg('rect', {
        x: x(i) - step / 2, y: T, width: step, height: ph, fill: 'transparent', class: 'bd-day',
        'data-date': d.date, 'data-remaining': d.remaining === null ? '' : String(d.remaining),
        'data-ideal': String(Math.round(d.ideal * 1000) / 1000), 'data-scope': String(d.scope), 'data-done': String(d.doneToday)
      }, [svg('title', { text: tip })]));
    });
    // x labels (thinned to fit) and axis
    var every = Math.max(1, Math.ceil(36 / Math.max(1, step))), shown = [], i0;
    for (i0 = 0; i0 < m.n; i0 += every) shown.push(i0);
    if (shown[shown.length - 1] !== m.n - 1) { // always label the last day; drop a neighbour that would collide with it
      if ((m.n - 1 - shown[shown.length - 1]) * step < 36 && shown.length > 1) shown.pop();
      shown.push(m.n - 1);
    }
    shown.forEach(function (i) {
      g.push(svg('line', { x1: x(i), x2: x(i), y1: T + ph, y2: T + ph + 4, stroke: MUTED }));
      g.push(svg('text', { x: x(i), y: T + ph + 17 + extra, 'text-anchor': 'middle', 'font-size': 11, fill: MUTED, text: shortDate(m.days[i].date) }));
    });
    g.push(svg('line', { x1: L, x2: W - R, y1: T + ph, y2: T + ph, stroke: MUTED, 'stroke-width': 1 }));
    // scope: thin step line up to today (rises on the days tickets were added)
    var upTo = m.days.filter(function (d) { return d.remaining !== null; });
    if (upTo.length) {
      var sp = [];
      upTo.forEach(function (d, i) {
        if (i > 0) sp.push(x(i).toFixed(1) + ',' + y(upTo[i - 1].scope).toFixed(1));
        sp.push(x(i).toFixed(1) + ',' + y(d.scope).toFixed(1));
      });
      g.push(svg('polyline', { points: sp.join(' '), fill: 'none', stroke: '#b9c3d0', 'stroke-width': 1.5, class: 'bd-scope' }));
    }
    // ideal line
    g.push(svg('polyline', {
      points: m.days.map(function (d, i) { return x(i).toFixed(1) + ',' + y(d.ideal).toFixed(1); }).join(' '),
      fill: 'none', stroke: '#8795a8', 'stroke-width': 2, 'stroke-dasharray': '6 5', class: 'bd-ideal'
    }));
    // today marker
    if (m.todayInside) {
      g.push(svg('line', { x1: x(m.todayIndex), x2: x(m.todayIndex), y1: T, y2: T + ph, stroke: '#2a9d8f', 'stroke-width': 1.5, 'stroke-dasharray': '2 3' }));
      g.push(svg('text', { x: x(m.todayIndex), y: T - 4, 'text-anchor': 'middle', 'font-size': 11, 'font-weight': 700, fill: '#2a9d8f', text: 'Today' }));
    }
    // remaining line (up to today)
    var pts_ = m.days.filter(function (d) { return d.remaining !== null; });
    if (pts_.length) {
      g.push(svg('polyline', {
        points: pts_.map(function (d, i) { return x(i).toFixed(1) + ',' + y(d.remaining).toFixed(1); }).join(' '),
        fill: 'none', stroke: '#1f3a5f', 'stroke-width': 2.5, 'stroke-linejoin': 'round', class: 'bd-actual'
      }));
      pts_.forEach(function (d, i) {
        g.push(svg('circle', { cx: x(i), cy: y(d.remaining), r: i === pts_.length - 1 ? 4.5 : 2.5, fill: '#1f3a5f' }));
      });
    }
    // mid-sprint addition markers on the x axis
    Object.keys(m.addedByDate).sort().forEach(function (date) {
      var idx = m.days.findIndex(function (d) { return d.date === date; });
      if (idx < 0) return;
      var list = m.addedByDate[date], early = date <= m.thresholdDate, px = list.reduce(function (a, t) { return a + t.points; }, 0), cx = x(idx), by = T + ph - 1;
      var mk = svg('g', { class: 'bd-added' + (early ? ' bd-early' : ''), 'data-date': date, 'data-early': early ? '1' : '0', 'data-count': String(list.length), 'data-points': String(px),
        tabindex: 0, role: 'button', 'aria-pressed': opts.selectedKey === 'added:' + date ? 'true' : 'false',
        'aria-label': shortDate(date) + ': ' + list.length + ' ticket' + (list.length === 1 ? '' : 's') + ' added. Show list.' }, [
        svg('rect', { x: cx - 14, y: by - 30, width: 28, height: 32, fill: 'transparent' }),
        svg('path', { d: 'M' + (cx - 6) + ',' + by + ' L' + (cx + 6) + ',' + by + ' L' + cx + ',' + (by - 11) + ' Z', fill: early ? '#ffffff' : '#e3a72f', stroke: '#8a6414', 'stroke-width': early ? 1.5 : 1 }),
        svg('text', { x: cx, y: by - 14, 'text-anchor': 'middle', 'font-size': 10, 'font-weight': 700, fill: INK, text: '+' + list.length }),
        svg('title', { text: shortDate(date) + ': ' + list.length + ' ticket' + (list.length === 1 ? '' : 's') + ' added, ' + fmtNum(px) + ' points: '
          + list.slice(0, 8).map(function (t) { return t.ticket + ' (' + fmtNum(t.points) + ')'; }).join(', ') + (list.length > 8 ? ', and ' + (list.length - 8) + ' more' : '') })
      ]);
      if (opts.selectedKey === 'added:' + date) mk.setAttribute('class', 'bd-added' + (early ? ' bd-early' : '') + ' bd-sel');
      if (typeof opts.onMarker === 'function') {
        mk.addEventListener('click', function () { opts.onMarker('added', date, list); });
        mk.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); opts.onMarker('added', date, list); }
        });
      }
      g.push(mk);
    });
    // removal markers: red downward triangles below the x axis (D52)
    Object.keys(m.removedByDate).sort().forEach(function (date) {
      var idx = m.days.findIndex(function (d) { return d.date === date; });
      if (idx < 0) return;
      var list = m.removedByDate[date], px = list.reduce(function (a, t) { return a + t.points; }, 0), cx = x(idx), ay = T + ph;
      var rk = svg('g', { class: 'bd-removed', 'data-date': date, 'data-count': String(list.length), 'data-points': String(px),
        tabindex: 0, role: 'button', 'aria-pressed': opts.selectedKey === 'removed:' + date ? 'true' : 'false',
        'aria-label': shortDate(date) + ': ' + list.length + ' ticket' + (list.length === 1 ? '' : 's') + ' removed from the sprint. Show list.' }, [
        svg('rect', { x: cx - 14, y: ay + 1, width: 28, height: 30, fill: 'transparent' }),
        svg('path', { d: 'M' + (cx - 6) + ',' + (ay + 3) + ' L' + (cx + 6) + ',' + (ay + 3) + ' L' + cx + ',' + (ay + 14) + ' Z', fill: '#d64545', stroke: '#8f1f1f', 'stroke-width': 1 }),
        svg('text', { x: cx, y: ay + 25, 'text-anchor': 'middle', 'font-size': 10, 'font-weight': 700, fill: INK, text: '\u2212' + list.length }),
        svg('title', { text: shortDate(date) + ': ' + list.length + ' ticket' + (list.length === 1 ? '' : 's') + ' removed, ' + fmtNum(px) + ' points: '
          + list.slice(0, 8).map(function (t) { return t.ticket + ' (' + fmtNum(t.points) + ')'; }).join(', ') + (list.length > 8 ? ', and ' + (list.length - 8) + ' more' : '') })
      ]);
      if (opts.selectedKey === 'removed:' + date) rk.setAttribute('class', 'bd-removed bd-sel');
      if (typeof opts.onMarker === 'function') {
        rk.addEventListener('click', function () { opts.onMarker('removed', date, list); });
        rk.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); opts.onMarker('removed', date, list); }
        });
      }
      g.push(rk);
    });
    // legend
    var lx = narrow ? L : W - R - (hasRem ? 550 : 470);
    g.push(svg('line', { x1: lx, x2: lx + 18, y1: 10, y2: 10, stroke: '#1f3a5f', 'stroke-width': 2.5 }));
    g.push(svg('text', { x: lx + 23, y: 14, 'font-size': 11, fill: MUTED, text: 'Remaining' }));
    g.push(svg('line', { x1: lx + 90, x2: lx + 108, y1: 10, y2: 10, stroke: '#8795a8', 'stroke-width': 2, 'stroke-dasharray': '6 5' }));
    g.push(svg('text', { x: lx + 113, y: 14, 'font-size': 11, fill: MUTED, text: 'Ideal' }));
    g.push(svg('line', { x1: lx + 160, x2: lx + 178, y1: 10, y2: 10, stroke: '#b9c3d0', 'stroke-width': 1.5 }));
    g.push(svg('text', { x: lx + 183, y: 14, 'font-size': 11, fill: MUTED, text: 'Scope' }));
    g.push(svg('path', { d: 'M' + (lx + 230) + ',16 L' + (lx + 242) + ',16 L' + (lx + 236) + ',5 Z', fill: '#e3a72f', stroke: '#8a6414', 'stroke-width': 1 }));
    g.push(svg('text', { x: lx + 247, y: 14, 'font-size': 11, fill: MUTED, text: 'Added after day ' + opts.thresholdDays }));
    g.push(svg('path', { d: 'M' + (lx + 410) + ',16 L' + (lx + 422) + ',16 L' + (lx + 416) + ',5 Z', fill: '#ffffff', stroke: '#8a6414', 'stroke-width': 1.5 }));
    g.push(svg('text', { x: lx + 427, y: 14, 'font-size': 11, fill: MUTED, text: 'Earlier' }));
    if (hasRem) {
      g.push(svg('path', { d: 'M' + (lx + 480) + ',5 L' + (lx + 492) + ',5 L' + (lx + 486) + ',16 Z', fill: '#d64545', stroke: '#8f1f1f', 'stroke-width': 1 }));
      g.push(svg('text', { x: lx + 497, y: 14, 'font-size': 11, fill: MUTED, text: 'Removed' }));
    }
    container.appendChild(svg('svg', {
      width: W, height: H, viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': opts.label, class: 'burndown'
    }, [svg('title', { text: opts.label })].concat(g)));
  }

  // Filter bar: tags (with remove buttons), persistent page controls, Reset all.
  // Returns update(), which redraws only the tags and the Reset state, so controls keep focus.
  function filterBar(container, store, controls) {
    clear(container);
    var tagBox = el('div', { class: 'tags', role: 'group', 'aria-label': 'Active filters' });
    var resetBtn = el('button', { type: 'button', class: 'resetall', text: 'Reset all', onclick: function () { store.reset(); } });
    container.appendChild(tagBox);
    (controls || []).forEach(function (c) { container.appendChild(c); });
    container.appendChild(resetBtn);
    function tag(text, label, onRemove) {
      return el('span', { class: 'tag' }, [
        el('span', { text: text }),
        el('button', { type: 'button', class: 'tag-x', 'aria-label': label, text: '\u00d7', onclick: onRemove })
      ]);
    }
    return function update() {
      clear(tagBox);
      var tags = store.tags();
      tags.forEach(function (t) {
        tagBox.appendChild(tag(t.label + ': ' + t.value, 'Remove filter ' + t.label + ' ' + t.value, function () { store.remove(t.dim, t.value); }));
      });
      if (store.search.tag) {
        tagBox.appendChild(tag(store.search.tag, 'Remove search filter', function () { store.setSearch('', null, ''); }));
      }
      if (!store.isActive()) {
        tagBox.appendChild(el('span', { class: 'nofilter', text: 'No filters. Click a bar, a person, or a cell to filter.' }));
      }
      resetBtn.disabled = !store.isActive();
    };
  }

  // Heat grid inside a tile body. ct from crossTab; o: {corner, rowSel, colSel, unit, onCell(r, c, multi)}.
  function heatGrid(t, ct, o) {
    var anySel = o.rowSel.size > 0 || o.colSel.size > 0;
    var head = el('tr', null, [el('th', { class: 'corner', text: o.corner })]
      .concat(ct.cols.map(function (c) { return el('th', { text: c, title: c }); }))
      .concat([el('th', { text: 'Total' })]));
    var rows = ct.rows.map(function (r) {
      var tds = ct.cols.map(function (c) {
        var n = (ct.cells[r] || {})[c] || 0;
        if (!n) return el('td', { class: 'zero' });
        var selCell = anySel && (o.rowSel.size === 0 || o.rowSel.has(r)) && (o.colSel.size === 0 || o.colSel.has(c));
        return el('td', { class: anySel && !selCell ? 'dim' : null, style: heatStyle(n, ct.max) }, [
          el('button', {
            type: 'button', class: 'cell' + (selCell ? ' sel' : ''), 'data-key': r + '|' + c, 'aria-pressed': selCell ? 'true' : 'false',
            title: r + ' / ' + c + ': ' + n + ' ' + o.unit,
            onclick: function (e) { o.onCell(r, c, isMulti(e)); }
          }, [String(n)])
        ]);
      });
      return el('tr', null, [el('th', { class: 'rowh', scope: 'row', text: r, title: r })]
        .concat(tds).concat([el('td', { class: 'tot', text: String(ct.rowTotals[r]) })]));
    });
    t.body.appendChild(el('table', { class: 'heat' }, [el('thead', null, [head]), el('tbody', null, rows)]));
  }

  // ---- Jira links (SPEC §8a, DATA_CONTRACT §7a) ----------------------------
  var JIRA_BASE = 'https://mysnaplogic.atlassian.net'; // the only place the Jira address lives
  var KEY_PATTERN = '[A-Z][A-Z0-9]+-[0-9]+';
  var KEY_EXACT = new RegExp('^' + KEY_PATTERN + '$');

  function jiraUrl(key) { return JIRA_BASE + '/browse/' + encodeURIComponent(key); }
  function jiraLink(key) {
    return el('a', {
      class: 'jira', href: jiraUrl(key), target: '_blank', rel: 'noopener noreferrer',
      title: 'Open ' + key + ' in Jira', text: key
    });
  }
  // Split text into plain text and one link per Jira key. Only regex matches become links.
  function linkify(text) {
    var s = String(text), re = new RegExp('\\b' + KEY_PATTERN + '\\b', 'g'), out = [], last = 0, m;
    while ((m = re.exec(s))) {
      if (m.index > last) out.push(s.slice(last, m.index));
      out.push(jiraLink(m[0]));
      last = m.index + m[0].length;
    }
    if (last < s.length) out.push(s.slice(last));
    return out;
  }
  // A ticket cell: the whole value is a link when it is a key, else plain text.
  function ticketCell(key) { return KEY_EXACT.test(String(key)) ? jiraLink(String(key)) : String(key); }
  // A cell that may contain several keys among other text; empty shows a dash.
  function linkCell(v) { return isBlank(v) ? '\u2014' : el('span', null, linkify(v)); }

  // ---- Loading and errors (SPEC §4) ----------------------------------------
  function loadJson(file) {
    return fetch(file, { cache: 'no-store' }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    });
  }

  function loadSnapshot(file) {
    return loadJson(file).then(function (data) {
      if (!data || !Array.isArray(data.tickets)) throw new Error('missing "tickets" array');
      return data;
    });
  }

  function showError(container, file, err) {
    clear(container);
    var onFile = root.location && root.location.protocol === 'file:';
    container.appendChild(el('section', { class: 'message', role: 'alert' }, [
      el('h2', { text: 'Can’t load ' + file }),
      el('p', { text: onFile
        ? 'This page was opened as a file. Browsers block local data files that way. Start the local server instead.'
        : 'The file is missing or not valid JSON (' + (err && err.message ? err.message : 'unknown error') + ').' }),
      el('p', null, ['Run ', el('code', { text: 'python3 05_Automation/export_dashboard_snapshots.py' }),
        ' from the project root, then reload.']),
      el('p', null, ['To serve the page: ', el('code', { text: 'cd AF_Dashboard && python3 -m http.server 8000' }),
        ', then open http://localhost:8000/.'])
    ]));
  }

  function emptyState(text) { return el('p', { class: 'empty', text: text }); }

  function setUpdated(refreshedAt, exportedAt) {
    var n = document.getElementById('asof');
    if (!n) return;
    var hasOffset = /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(String(exportedAt || ''));
    var date = hasOffset ? new Date(exportedAt) : null;
    if (!date || isNaN(date.getTime())) { n.textContent = 'Data as of ' + (refreshedAt || '—'); return; }
    function pad(value) { return value < 10 ? '0' + value : String(value); }
    var offsetMinutes = -date.getTimezoneOffset();
    var sign = offsetMinutes >= 0 ? '+' : '-', absoluteOffset = Math.abs(offsetMinutes);
    var localDate = date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
    var localTime = pad(date.getHours()) + ':' + pad(date.getMinutes());
    var zone = 'UTC' + sign + pad(Math.floor(absoluteOffset / 60)) + ':' + pad(absoluteOffset % 60);
    n.textContent = 'Data as of ' + localDate + ' · ' + localTime + ' ' + zone;
  }

  root.AF = {
    BUCKETS: BUCKETS, BUCKET_CLASS: BUCKET_CLASS, OTHER: OTHER, NONE: NONE,
    bucketOf: bucketOf, isBlank: isBlank, pts: pts, fmtNum: fmtNum, show: show, showPoints: showPoints,
    personName: personName, sum: sum, statusTotals: statusTotals, aggregateBy: aggregateBy,
    countBy: countBy, crossTab: crossTab, median: median, createStore: createStore,
    config: config, dayNum: dayNum, avgCycleTime: avgCycleTime, oneDecimal: oneDecimal, midSprintAdded: midSprintAdded,
    burndown: burndown, drawBurndown: drawBurndown, shortDate: shortDate, longDate: longDate, icon: icon,
    el: el, clear: clear, isMulti: isMulti, tile: tile, rebuild: rebuild, rowButton: rowButton,
    statusDot: statusDot, stackedBar: stackedBar, simpleBar: simpleBar, heatStyle: heatStyle,
    buildTable: buildTable, filterBar: filterBar, heatGrid: heatGrid,
    jira: { base: JIRA_BASE, url: jiraUrl, link: jiraLink, linkify: linkify }, ticketCell: ticketCell, linkCell: linkCell,
    loadJson: loadJson, loadSnapshot: loadSnapshot, showError: showError, emptyState: emptyState, setUpdated: setUpdated
  };
})();
