/*
 * dashboard.js — shared engine for the three pages: index.html (Current sprint),
 * backlog.html (Backlog) and quality-intake.html (Quality Intake).
 * Plain JavaScript, no dependencies, no network except relative local JSON files
 * (sprints.json plus one sprint snapshot, backlog.json, quality-intake.json).
 * Rules: DATA_CONTRACT.md. The filter store and the aggregation functions are
 * pure (no DOM) so numbers can be checked in the console, e.g. AF.statusTotals(rows),
 * and in Node, where loading this file returns the same AF object (scripts/unit.test.js).
 */
(function () {
  'use strict';

  var root = typeof window !== 'undefined' ? window : globalThis;
  var hasDom = typeof document !== 'undefined';

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
  // Natural order for labels such as fix versions: '4.9' before '4.10', 'APP-9' before 'APP-10'.
  function naturalCompare(a, b) {
    return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
  }

  // ---- Settings (SPEC §6.2 / D38, D72) -------------------------------------
  var config = {
    timeInStatusThresholdDays: 7, // In Progress / In Review tickets in the same status this many days or more appear under "Long-running work · 7+ days"
    midSprintThresholdDays: 1 // tickets added later than start + this many days count as "added mid-sprint" (D72)
  };

  // ---- Colours shared with dashboard.css (SPEC §10) -------------------------
  // SVG drawing and the heat ramp need literal colours. Each value mirrors the CSS
  // custom property named in COLOR_TOKENS; the acceptance harness checks they agree.
  var COLORS = {
    ink: '#17263b', muted: '#566478', grid: '#e8ecf1', navy: '#1f3a5f', teal: '#2a9d8f', surface: '#ffffff',
    scope: '#b9c3d0', ideal: '#8795a8',
    added: '#e3a72f', addedStroke: '#8a6414', removed: '#d64545', removedStroke: '#8f1f1f'
  };
  var COLOR_TOKENS = {
    ink: '--ink', muted: '--muted', grid: '--line-soft', navy: '--navy', teal: '--teal', surface: '--surface',
    scope: '--chart-scope', ideal: '--chart-ideal',
    added: '--marker-added', addedStroke: '--marker-added-stroke', removed: '--marker-removed', removedStroke: '--marker-removed-stroke'
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

  // Cross-tab of two keys. opts: rowOrder / colOrder (arrays), lastCol (name pushed last) or
  // lastCols (names pushed last, in the given order).
  function crossTab(tickets, rowKey, colKey, opts) {
    opts = opts || {};
    var lastCols = opts.lastCols || (opts.lastCol ? [opts.lastCol] : []);
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
        var ra = last.indexOf(a), rb = last.indexOf(b);
        if (ra !== rb) return ra === -1 ? -1 : rb === -1 ? 1 : ra - rb;
        return totals[b] - totals[a] || a.localeCompare(b);
      });
      return keys;
    }
    var rows = order(rt, opts.rowOrder, []), cols = order(ct, opts.colOrder, lastCols);
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

  // ---- Free-text search (pure; R001-19, DATA_CONTRACT §7) -----------------
  // fold(): lower case, accents removed, spaces collapsed. Words split on spaces and punctuation but keep
  // `.`, `-` and `/` inside a word, so `4.46.1.0`, `well-formed`, `n/a` and `APP-2970` stay whole.
  var SEARCH_SPLIT = /[\s,;:()\[\]{}|"'“”‘’!?*]+/;
  var SEARCH_KEY = /\b[a-z][a-z0-9]+-[0-9]+\b/g;
  function fold(v) {
    return String(v === null || v === undefined ? '' : v).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase().replace(/\s+/g, ' ').trim();
  }
  function searchWords(v) {
    return fold(v).split(SEARCH_SPLIT).map(function (w) { return w.replace(/^[.\-\/]+|[.\-\/]+$/g, ''); }).filter(Boolean);
  }
  // One word against one field. kind 'key': anywhere in the value (partial key, `2970`, `app-29`);
  // 'text': the start of a word of the value; 'linked' (parent, epic): inside a Jira key of the value, or 'text'.
  function fieldMatches(kind, value, word) {
    if (isBlank(value)) return false;
    if (kind === 'key') return fold(value).indexOf(word) !== -1;
    var startsAWord = searchWords(value).some(function (w) { return w.indexOf(word) === 0; });
    if (kind === 'text' || startsAWord) return startsAWord;
    return (fold(value).match(SEARCH_KEY) || []).some(function (k) { return k.indexOf(word) !== -1; });
  }
  // spec: { fields: [{ kind, get(t) }], phrases: [{ text, test(t) }] }. Known phrases are matched first as whole
  // phrases against their own field; every other word must match at least one field (AND across words).
  // Returns null for a blank query, else { q, pred(t), tag, isExact(t) } (isExact: the query names this key).
  function compileSearch(q, spec) {
    var rest = ' ' + searchWords(q).join(' ') + ' ', tests = [];
    (spec.phrases || []).slice().sort(function (a, b) { return b.text.length - a.text.length; }).forEach(function (ph) {
      var needle = ' ' + ph.text + ' ';
      while (rest.indexOf(needle) !== -1) { tests.push(ph.test); rest = rest.replace(needle, ' '); }
    });
    var words = rest.trim() ? rest.trim().split(' ') : [];
    if (!tests.length && !words.length) return null;
    words.forEach(function (word) {
      tests.push(function (t) { return spec.fields.some(function (f) { return fieldMatches(f.kind, f.get(t), word); }); });
    });
    var keyWords = words.filter(function (w) { return /^[a-z][a-z0-9]+-[0-9]+$/.test(w) || /^[0-9]+$/.test(w); });
    return {
      q: String(q).trim(),
      tag: 'Search: “' + String(q).trim() + '”',
      pred: function (t) { return tests.every(function (test) { return test(t); }); },
      isExact: function (t) {
        var k = fold(t.ticket);
        return keyWords.some(function (w) { return k === w || k.slice(k.lastIndexOf('-') + 1) === w; });
      }
    };
  }
  // Rows whose key the query names exactly come first; the rest keep their order.
  function exactFirst(rows, search) {
    if (!search) return rows;
    return rows.filter(search.isExact).concat(rows.filter(function (t) { return !search.isExact(t); }));
  }

  // ---- Filter store (pure; DATA_CONTRACT §6) -------------------------------
  // dims: { name: { label, get(ticket) -> string } } or { label, matches(ticket, selectedSet) }.
  // Besides the dimensions and the search, the store has one optional "extra" filter slot:
  // { id, label, value, pred(ticket) }. It is not applied by apply() unless asked
  // ({ withExtra: true }), so a page can scope it to some tiles (the sprint KPI filters,
  // which filter only the lower section). It shows as a tag, counts as an active filter,
  // and is cleared by Reset all or by removing its tag. Subscribers receive a reason:
  // 'extra' when only the extra filter changed, otherwise undefined.
  var EXTRA_DIM = '__extra';
  function createStore(dims) {
    var sel = {};
    Object.keys(dims).forEach(function (k) { sel[k] = new Set(); });
    var search = { q: '', pred: null, tag: '' };
    var extra = null;
    var subs = [];
    function emit(reason) { subs.forEach(function (f) { f(reason); }); }
    function exceptMap(except) {
      var o = {};
      (Array.isArray(except) ? except : except ? [except] : []).forEach(function (k) { o[k] = true; });
      return o;
    }
    var store = {
      dims: dims, sel: sel, search: search, EXTRA_DIM: EXTRA_DIM,
      subscribe: function (f) { subs.push(f); },
      // true when any dimension, the search or (unless opts.extra === false) the extra filter is set
      isActive: function (opts) {
        var withExtra = !(opts && opts.extra === false);
        return Object.keys(sel).some(function (k) { return sel[k].size > 0; }) || !!search.pred || (withExtra && !!extra);
      },
      // tickets that match every active filter except the dimensions in `except`;
      // opts.withExtra also applies the extra filter
      apply: function (tickets, except, opts) {
        var ex = exceptMap(except);
        var active = Object.keys(sel).filter(function (k) { return !ex[k] && sel[k].size > 0; });
        var extraPred = opts && opts.withExtra && extra ? extra.pred : null;
        return tickets.filter(function (t) {
          for (var i = 0; i < active.length; i++) {
            var dim = dims[active[i]];
            if (typeof dim.matches === 'function' ? !dim.matches(t, sel[active[i]]) : !sel[active[i]].has(dim.get(t))) return false;
          }
          if (search.pred && !search.pred(t)) return false;
          return !(extraPred && !extraPred(t));
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
      remove: function (dim, value) {
        if (dim === EXTRA_DIM) { store.setExtra(null); return; }
        sel[dim].delete(value); emit();
      },
      setSearch: function (q, pred, tag) { search.q = q; search.pred = pred || null; search.tag = tag || ''; emit(); },
      extra: function () { return extra; },
      setExtra: function (x) { extra = x || null; emit('extra'); },
      reset: function () {
        Object.keys(sel).forEach(function (k) { sel[k].clear(); });
        search.q = ''; search.pred = null; search.tag = '';
        extra = null;
        emit();
      },
      tags: function () {
        var out = [];
        Object.keys(dims).forEach(function (k) {
          sel[k].forEach(function (v) { out.push({ dim: k, label: dims[k].label, value: v }); });
        });
        if (extra) out.push({ dim: EXTRA_DIM, label: extra.label, value: extra.value });
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
  // Dates are compared as day numbers; a value that is not a YYYY-MM-DD date never counts (C13).
  function midSprintAdded(tickets, sprint, thresholdDays) {
    var start = dayNum(sprint && sprint.startDate);
    if (isNaN(start)) return null;
    var limit = start + thresholdDays;
    var out = { thresholdDate: isoOf(limit), count: 0, points: 0, tickets: [] };
    tickets.forEach(function (t) {
      var a = dayNum(t.addedDate);
      if (!isNaN(a) && a > limit) { out.count += 1; out.points += pts(t.points); out.tickets.push(t); }
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
    var mid = midSprintAdded(tickets, sprint, thresholdDays), byDate = {}, midBy = {}, limitDay = s + thresholdDays;
    tickets.forEach(function (t) {
      var a = dayNum(t.addedDate);
      if (isNaN(a) || a <= s) return; // the starting scope (and an unreadable date) has no marker
      var k = isoOf(Math.min(a, e)); // a date after the end is shown on the last day
      var item = { ticket: t.ticket, points: pts(t.points), summary: t.summary, status: t.status, owner: t.owner };
      (byDate[k] = byDate[k] || []).push(item);
      if (a > limitDay) (midBy[k] = midBy[k] || []).push(item);
    });
    return { days: days, total: total, startScope: start, n: n, todayIndex: todayIndex, todayInside: todayInside, unplacedDone: unplaced, unplacedPoints: unplacedPoints,
             afterEndDone: afterEnd, mid: mid, removedByDate: removedByDate, addedByDate: byDate, midByDate: midBy, thresholdDate: isoOf(limitDay) };
  }

  // Nice upper bound and tick step for the y axis.
  function niceScale(max) {
    if (!(max > 0)) return { top: 1, step: 1 };
    var steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000], step = steps[steps.length - 1];
    for (var i = 0; i < steps.length; i++) { if (max / steps[i] <= 6) { step = steps[i]; break; } }
    return { top: Math.ceil(max / step) * step, step: step };
  }

  // Teal heat ramp for matrix cells, as a CSS colour (SPEC §10). Cell text is ink, never white: the ramp
  // stops at HEAT_MAX_ALPHA so ink keeps at least 4.5:1 (about 6:1 on the darkest cell). A dimmed cell
  // (outside the current selection) gets a lighter tint and muted text (about 4.8:1) instead of opacity (C17, C18).
  var HEAT_MIN_ALPHA = 0.12, HEAT_MAX_ALPHA = 0.8, HEAT_DIM_FACTOR = 0.25;
  function heatColor(n, max, dimmed) {
    if (!n || !max) return '';
    var a = HEAT_MIN_ALPHA + (HEAT_MAX_ALPHA - HEAT_MIN_ALPHA) * (n / max);
    if (dimmed) a *= HEAT_DIM_FACTOR;
    var rgb = [1, 3, 5].map(function (i) { return parseInt(COLORS.teal.slice(i, i + 2), 16); });
    return 'rgba(' + rgb.join(', ') + ', ' + a.toFixed(2) + ')';
  }

  // ---- DOM helpers (text nodes only, so data can never inject markup) ------
  // attrs: class, text, style (an object of CSSOM properties, never a string: CSP style-src 'self'),
  // on<event> (functions only), anything else becomes an attribute.
  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'class') n.className = v;
        else if (k === 'text') n.textContent = v;
        else if (k === 'style') {
          if (typeof v !== 'object') throw new Error('AF.el: pass "style" as an object of CSS properties');
          Object.keys(v).forEach(function (p) { n.style[p] = v[p]; });
        } else if (k.slice(0, 2) === 'on') {
          if (typeof v !== 'function') throw new Error('AF.el: "' + k + '" must be a function');
          n.addEventListener(k.slice(2), v);
        } else n.setAttribute(k, v === true ? '' : v);
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

  // A scroll box becomes a keyboard-focusable, labelled region only while it actually scrolls (C19),
  // so tiles that fit add no extra tab stops. Boxes carry their label in data-scroll-label.
  function markScrollable(node) {
    if (!node || !node.isConnected) return;
    var cs = getComputedStyle(node);
    var canScroll = /auto|scroll/.test(cs.overflowY + ' ' + cs.overflowX);
    var scrolls = canScroll && (node.scrollHeight > node.clientHeight + 1 || node.scrollWidth > node.clientWidth + 1);
    if (scrolls) {
      node.setAttribute('tabindex', '0'); node.setAttribute('role', 'region');
      node.setAttribute('aria-label', node.getAttribute('data-scroll-label') || 'Scrollable content');
    } else { node.removeAttribute('tabindex'); node.removeAttribute('role'); node.removeAttribute('aria-label'); }
  }
  function markAllScrollables() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-scroll-label]'), markScrollable);
  }

  // Tile: card with head (title, subtitle), scrolling body, optional pinned foot.
  function tile(opts) {
    var head = el('div', { class: 'tile-head' }, [
      el('h2', { text: opts.title }),
      opts.sub !== undefined ? el('p', { class: 'sub', text: opts.sub }) : null
    ]);
    var colhead = el('div', { class: 'colhead' });
    var body = el('div', { class: 'tile-body', 'data-scroll-label': opts.title });
    var foot = el('div', { class: 'tile-foot' });
    var rootEl = el('section', { class: 'tile ' + (opts.cls || '') }, [head, colhead, body, foot]);
    return { root: rootEl, head: head, colhead: colhead, body: body, foot: foot };
  }

  // KPI tile: label, big value, hint. kind: 'items' | 'points' | 'plain'.
  function kpi(kind, label) {
    var value = el('div', { class: 'value' }), hint = el('div', { class: 'hint' });
    return { root: el('section', { class: 'tile kpi ' + kind }, [el('div', { class: 'label', text: label }), value, hint]), value: value, hint: hint };
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
    markScrollable(tileObj.body);
    if (focusKey) { // keep keyboard focus on the same row or cell after the tile is redrawn
      var again = Array.prototype.filter.call(tileObj.root.querySelectorAll('[data-key]'), function (n) { return n.getAttribute('data-key') === focusKey; })[0];
      if (again) again.focus({ preventScroll: true });
    }
  }

  // Selection state uses one class pair everywhere: .is-selected and .is-dimmed (SPEC §10).
  function stateClass(selected, dimmed) { return (selected ? ' is-selected' : '') + (dimmed ? ' is-dimmed' : ''); }

  function rowButton(opts, children) {
    var cls = 'rowbtn' + (opts.cls ? ' ' + opts.cls : '') + stateClass(opts.selected, opts.dimmed);
    return el('button', {
      type: 'button', class: cls, title: opts.title || null, 'data-key': opts.key || null, 'aria-pressed': opts.selected ? 'true' : 'false',
      'aria-label': opts.ariaLabel || null,
      onclick: function (e) { opts.onclick(isMulti(e)); }
    }, children);
  }

  function statusDot(b) { return el('span', { class: 'dot ' + BUCKET_CLASS[b], 'aria-hidden': 'true' }); }

  // `N W.I | P SP` (SPEC §6.2).
  function pair(items, points) {
    return el('span', { class: 'pair' }, [String(items) + ' W.I', el('span', { class: 'sep', text: ' | ' }), fmtNum(points) + ' SP']);
  }

  // One-colour bar, width as a percentage of the track.
  function simpleBar(pct, cls, title) {
    return el('div', { class: 'bar-track' }, [
      el('div', { class: 'fill ' + (cls || ''), style: { width: Math.max(0, Math.min(100, pct)).toFixed(2) + '%' }, title: title || null })
    ]);
  }

  // cols: [{label, cls, render(row, index) -> Node|string}]
  function buildTable(cols, rows, opts) {
    opts = opts || {};
    var head = el('tr', null, cols.map(function (c) {
      return el('th', { scope: 'col', class: c.cls || null, text: c.label, title: c.title || null });
    }));
    var body = el('tbody', null, rows.map(function (r, i) {
      return el('tr', null, cols.map(function (c) {
        var v = c.render(r, i);
        return el('td', { class: c.cls || null }, [v === null || v === undefined ? '—' : v]);
      }));
    }));
    return el('table', { class: opts.cls || null }, [el('thead', null, [head]), body]);
  }

  // ---- Inline SVG ------------------------------------------------------------
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

  // ---- Priority and Type icons (inline SVG look-alikes of Jira's; SPEC §10b) ------
  // The icon colours are Jira's own artwork colours, not part of the dashboard palette.
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

  // ---- Burndown chart (inline SVG; SPEC §6.3) --------------------------------
  // Geometry in px. Margins around the plot; the y-axis labels sit in the left margin.
  var CHART = {
    minWidth: 280, minHeight: 120,
    left: 42, right: 16,
    top: 42, topSmall: 34, topTwoRowLegend: 51,   // the second legend row needs 51px above the plot
    bottom: 50, bottomSmall: 36, removedExtra: 18, // removal triangles hang below the axis; date labels move down by removedExtra
    smallHeight: 260,                              // below this height use the small margins
    narrowWidth: 700, narrowWidthWithRemoved: 760, // below this width there is no y-axis title and the legend starts at the left
    labelSpacing: 36,                              // minimum distance between x-axis date labels
    markerHalfWidth: 14                            // half width of a marker's click target
  };
  // Legend item x offsets from the legend start. One row: lines then markers; the narrow two-row
  // layout puts the three markers on a second row. width = the space reserved at the right edge.
  var LEGEND = {
    row1: { y: 10, textY: 14, triTop: 5, triBottom: 16 },
    row2: { textY: 34, triTop: 25, triBottom: 36 },
    swatch: 18, textGap: 5, triangle: 12,
    oneRow: { remaining: 0, ideal: 90, scope: 160, added: 230, earlier: 410, removed: 480 },
    twoRows: { added: 0, earlier: 140, removed: 210 },
    width: { withRemoved: 550, withoutRemoved: 470 }
  };

  // Draws the chart for model m (from burndown()) into container, sized to the container.
  // opts: { thresholdDays, label, selectedKey ('added:YYYY-MM-DD' | 'removed:YYYY-MM-DD'), onMarker(kind, date, list) }.
  function drawBurndown(container, m, opts) {
    clear(container);
    var C = COLORS;
    var W = Math.max(CHART.minWidth, container.clientWidth), H = Math.max(CHART.minHeight, container.clientHeight); // fits the tile exactly
    var small = H < CHART.smallHeight; // short tiles (small laptop screens) get tighter margins
    var hasRem = Object.keys(m.removedByDate).length > 0, extra = hasRem ? CHART.removedExtra : 0;
    var narrow = W < (hasRem ? CHART.narrowWidthWithRemoved : CHART.narrowWidth); // not enough room for the axis title and the legend on one line
    var legendTwoRows = narrow && hasRem;
    var L = CHART.left, R = CHART.right;
    var T = Math.max(small ? CHART.topSmall : CHART.top, legendTwoRows ? CHART.topTwoRowLegend : 0);
    var B = (small ? CHART.bottomSmall : CHART.bottom) + extra, pw = W - L - R, ph = H - T - B;
    var sc = niceScale(m.total);
    var x = function (i) { return L + (m.n > 1 ? pw * i / (m.n - 1) : pw / 2); };
    var y = function (v) { return T + ph - ph * v / sc.top; };
    var step = m.n > 1 ? pw / (m.n - 1) : pw;
    var g = [];
    function plural(n) { return n + ' ticket' + (n === 1 ? '' : 's'); }
    function listTip(date, list, verb, px) {
      return shortDate(date) + ': ' + plural(list.length) + ' ' + verb + ', ' + fmtNum(px) + ' points: '
        + list.slice(0, 8).map(function (t) { return t.ticket + ' (' + fmtNum(t.points) + ')'; }).join(', ') + (list.length > 8 ? ', and ' + (list.length - 8) + ' more' : '');
    }
    // y grid and labels
    for (var v = 0; v <= sc.top + 1e-9; v += sc.step) {
      g.push(svg('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), stroke: C.grid, 'stroke-width': 1 }));
      g.push(svg('text', { x: L - 6, y: y(v) + 4, 'text-anchor': 'end', 'font-size': 11, fill: C.muted, text: fmtNum(v) }));
    }
    if (!narrow) g.push(svg('text', { x: L, y: LEGEND.row1.textY, 'font-size': 11, 'font-weight': 700, fill: C.muted, text: 'Story points remaining' }));
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
    var every = Math.max(1, Math.ceil(CHART.labelSpacing / Math.max(1, step))), shown = [], i0;
    for (i0 = 0; i0 < m.n; i0 += every) shown.push(i0);
    if (shown[shown.length - 1] !== m.n - 1) { // always label the last day; drop a neighbour that would collide with it
      if ((m.n - 1 - shown[shown.length - 1]) * step < CHART.labelSpacing && shown.length > 1) shown.pop();
      shown.push(m.n - 1);
    }
    shown.forEach(function (i) {
      g.push(svg('line', { x1: x(i), x2: x(i), y1: T + ph, y2: T + ph + 4, stroke: C.muted }));
      g.push(svg('text', { x: x(i), y: T + ph + 17 + extra, 'text-anchor': 'middle', 'font-size': 11, fill: C.muted, text: shortDate(m.days[i].date) }));
    });
    g.push(svg('line', { x1: L, x2: W - R, y1: T + ph, y2: T + ph, stroke: C.muted, 'stroke-width': 1 }));
    // scope: thin step line up to today (rises on the days tickets were added)
    var upTo = m.days.filter(function (d) { return d.remaining !== null; });
    if (upTo.length) {
      var sp = [];
      upTo.forEach(function (d, i) {
        if (i > 0) sp.push(x(i).toFixed(1) + ',' + y(upTo[i - 1].scope).toFixed(1));
        sp.push(x(i).toFixed(1) + ',' + y(d.scope).toFixed(1));
      });
      g.push(svg('polyline', { points: sp.join(' '), fill: 'none', stroke: C.scope, 'stroke-width': 1.5, class: 'bd-scope' }));
    }
    // ideal line
    g.push(svg('polyline', {
      points: m.days.map(function (d, i) { return x(i).toFixed(1) + ',' + y(d.ideal).toFixed(1); }).join(' '),
      fill: 'none', stroke: C.ideal, 'stroke-width': 2, 'stroke-dasharray': '6 5', class: 'bd-ideal'
    }));
    // today marker
    if (m.todayInside) {
      g.push(svg('line', { x1: x(m.todayIndex), x2: x(m.todayIndex), y1: T, y2: T + ph, stroke: C.teal, 'stroke-width': 1.5, 'stroke-dasharray': '2 3' }));
      g.push(svg('text', { x: x(m.todayIndex), y: T - 4, 'text-anchor': 'middle', 'font-size': 11, 'font-weight': 700, fill: C.teal, text: 'Today' }));
    }
    // remaining line (up to today)
    if (upTo.length) {
      g.push(svg('polyline', {
        points: upTo.map(function (d, i) { return x(i).toFixed(1) + ',' + y(d.remaining).toFixed(1); }).join(' '),
        fill: 'none', stroke: C.navy, 'stroke-width': 2.5, 'stroke-linejoin': 'round', class: 'bd-actual'
      }));
      upTo.forEach(function (d, i) {
        g.push(svg('circle', { cx: x(i), cy: y(d.remaining), r: i === upTo.length - 1 ? 4.5 : 2.5, fill: C.navy }));
      });
    }
    // a marker: a focusable SVG button with a transparent hit area, a triangle, a count and a tooltip
    function marker(kind, date, list, early) {
      var idx = m.days.findIndex(function (d) { return d.date === date; });
      if (idx < 0) return;
      var px = list.reduce(function (a, t) { return a + t.points; }, 0), cx = x(idx), key = kind + ':' + date, selected = opts.selectedKey === key;
      var added = kind === 'added', axis = T + ph, hw = CHART.markerHalfWidth;
      var cls = 'bd-' + kind + (early ? ' bd-early' : '') + (selected ? ' is-selected' : '');
      var shape = added
        ? { hit: { x: cx - hw, y: axis - 1 - 30, width: hw * 2, height: 32 }, d: 'M' + (cx - 6) + ',' + (axis - 1) + ' L' + (cx + 6) + ',' + (axis - 1) + ' L' + cx + ',' + (axis - 12) + ' Z',
            fill: early ? C.surface : C.added, stroke: C.addedStroke, sw: early ? 1.5 : 1, labelY: axis - 15, label: '+' + list.length }
        : { hit: { x: cx - hw, y: axis + 1, width: hw * 2, height: 30 }, d: 'M' + (cx - 6) + ',' + (axis + 3) + ' L' + (cx + 6) + ',' + (axis + 3) + ' L' + cx + ',' + (axis + 14) + ' Z',
            fill: C.removed, stroke: C.removedStroke, sw: 1, labelY: axis + 25, label: '−' + list.length };
      var attrs = { class: cls, 'data-date': date, 'data-count': String(list.length), 'data-points': String(px),
        tabindex: 0, role: 'button', 'aria-pressed': selected ? 'true' : 'false',
        'aria-label': shortDate(date) + ': ' + plural(list.length) + (added ? ' added' : ' removed from the sprint') + '. Show list.' };
      if (added) { attrs['data-early'] = early ? '1' : '0'; }
      var mk = svg('g', attrs, [
        svg('rect', { class: 'bd-hit', x: shape.hit.x, y: shape.hit.y, width: shape.hit.width, height: shape.hit.height, rx: 3, fill: 'transparent' }),
        svg('path', { d: shape.d, fill: shape.fill, stroke: shape.stroke, 'stroke-width': shape.sw }),
        svg('text', { x: cx, y: shape.labelY, 'text-anchor': 'middle', 'font-size': 10, 'font-weight': 700, fill: C.ink, text: shape.label }),
        svg('title', { text: listTip(date, list, added ? 'added' : 'removed', px) })
      ]);
      if (typeof opts.onMarker === 'function') {
        mk.addEventListener('click', function () { opts.onMarker(kind, date, list); });
        mk.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); opts.onMarker(kind, date, list); }
        });
      }
      g.push(mk);
    }
    // mid-sprint addition markers on the x axis; removal markers: red downward triangles below it (D52)
    Object.keys(m.addedByDate).sort().forEach(function (date) { marker('added', date, m.addedByDate[date], date <= m.thresholdDate); });
    Object.keys(m.removedByDate).sort().forEach(function (date) { marker('removed', date, m.removedByDate[date], false); });
    // legend
    var lx = narrow ? L : W - R - (hasRem ? LEGEND.width.withRemoved : LEGEND.width.withoutRemoved);
    function legendLine(dx, stroke, width, dash, text) {
      g.push(svg('line', { x1: lx + dx, x2: lx + dx + LEGEND.swatch, y1: LEGEND.row1.y, y2: LEGEND.row1.y, stroke: stroke, 'stroke-width': width, 'stroke-dasharray': dash || null }));
      g.push(svg('text', { x: lx + dx + LEGEND.swatch + LEGEND.textGap, y: LEGEND.row1.textY, 'font-size': 11, fill: C.muted, text: text }));
    }
    function legendTriangle(dx, row, pointsDown, fill, stroke, width, text) {
      var a = lx + dx, b = a + LEGEND.triangle, mid = a + LEGEND.triangle / 2;
      var d = pointsDown
        ? 'M' + a + ',' + row.triTop + ' L' + b + ',' + row.triTop + ' L' + mid + ',' + row.triBottom + ' Z'
        : 'M' + a + ',' + row.triBottom + ' L' + b + ',' + row.triBottom + ' L' + mid + ',' + row.triTop + ' Z';
      g.push(svg('path', { d: d, fill: fill, stroke: stroke, 'stroke-width': width }));
      g.push(svg('text', { x: b + LEGEND.textGap, y: row.textY, 'font-size': 11, fill: C.muted, text: text }));
    }
    legendLine(LEGEND.oneRow.remaining, C.navy, 2.5, null, 'Remaining');
    legendLine(LEGEND.oneRow.ideal, C.ideal, 2, '6 5', 'Ideal');
    legendLine(LEGEND.oneRow.scope, C.scope, 1.5, null, 'Scope');
    var pos = legendTwoRows ? LEGEND.twoRows : LEGEND.oneRow, row = legendTwoRows ? LEGEND.row2 : LEGEND.row1;
    legendTriangle(pos.added, row, false, C.added, C.addedStroke, 1, 'Added after day ' + opts.thresholdDays);
    legendTriangle(pos.earlier, row, false, C.surface, C.addedStroke, 1.5, 'Earlier');
    if (hasRem) legendTriangle(pos.removed, row, true, C.removed, C.removedStroke, 1, 'Removed');
    container.appendChild(svg('svg', {
      width: W, height: H, viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': opts.label, class: 'burndown'
    }, [svg('title', { text: opts.label })].concat(g)));
    container.appendChild(burndownTable(m)); // the per-day figures for screen readers (C19)
  }

  // Visually hidden table with the burndown's per-day values (the chart's tooltips are mouse-only), in a clipping wrapper.
  function burndownTable(m) {
    var rows = m.days.map(function (d) {
      return el('tr', null, [
        el('th', { scope: 'row', text: longDate(d.date) }),
        el('td', { text: fmtNum(d.scope) }),
        el('td', { text: d.remaining === null ? '—' : fmtNum(d.remaining) }),
        el('td', { text: oneDecimal(d.ideal) }),
        el('td', { text: d.remaining === null ? '—' : fmtNum(d.doneToday) })
      ]);
    });
    return el('div', { class: 'visually-hidden bd-data' }, [el('table', null, [ // the wrapper clips it (tables ignore a 1px size)
      el('caption', { text: 'Burndown by day, story points' }),
      el('thead', null, [el('tr', null, ['Date', 'Scope', 'Remaining', 'Ideal', 'Done that day'].map(function (h) { return el('th', { scope: 'col', text: h }); }))]),
      el('tbody', null, rows)
    ])]);
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
        el('button', { type: 'button', class: 'tag-x', 'aria-label': label, text: '×', onclick: onRemove })
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

  // Search box with a clear button (R001-19). o: { placeholder, value, onChange(q) }. Returns { root, input, sync(q) }.
  // The query is kept in the page URL as `q` (other parameters such as `sprint` are kept).
  function setUrlParam(name, value) {
    var url = new URL(root.location.href);
    if (isBlank(value)) url.searchParams.delete(name); else url.searchParams.set(name, String(value));
    root.history.replaceState(null, '', url.pathname + url.search + url.hash);
  }
  function urlParam(name) { return new URLSearchParams(root.location.search).get(name) || ''; }
  function searchBox(o) {
    var input = el('input', {
      id: 'q', type: 'search', placeholder: o.placeholder, autocomplete: 'off', 'aria-label': 'Search',
      oninput: function () { changed(); }
    });
    var clearBtn = el('button', { type: 'button', class: 'search-clear', 'aria-label': 'Clear search', title: 'Clear search', text: '×',
      onclick: function () { input.value = ''; changed(); input.focus(); } });
    function sync(q) { if (input.value !== q) input.value = q; clearBtn.hidden = !input.value; }
    function changed() { clearBtn.hidden = !input.value; o.onChange(input.value); }
    sync(o.value || '');
    return { root: el('div', { class: 'ctl searchctl' }, [el('label', { for: 'q', text: 'Search' }), el('span', { class: 'searchwrap' }, [input, clearBtn])]), input: input, sync: sync };
  }

  // Heat grid inside a tile body. ct from crossTab; o: {corner, rowSel, colSel, unit, onCell(r, c, multi),
  // colTitles (optional: tooltip per column name, default the name)}.
  function heatGrid(t, ct, o) {
    var anySel = o.rowSel.size > 0 || o.colSel.size > 0, colTitles = o.colTitles || {};
    var head = el('tr', null, [el('th', { class: 'corner', scope: 'col', text: o.corner })]
      .concat(ct.cols.map(function (c) { return el('th', { scope: 'col', text: c, title: colTitles[c] || c }); }))
      .concat([el('th', { scope: 'col', text: 'Total' })]));
    var rows = ct.rows.map(function (r) {
      var tds = ct.cols.map(function (c) {
        var n = (ct.cells[r] || {})[c] || 0;
        if (!n) return el('td', { class: 'zero' });
        var selCell = anySel && (o.rowSel.size === 0 || o.rowSel.has(r)) && (o.colSel.size === 0 || o.colSel.has(c));
        var dimmed = anySel && !selCell;
        return el('td', { class: dimmed ? 'is-dimmed' : null, style: { backgroundColor: heatColor(n, ct.max, dimmed) } }, [
          el('button', {
            type: 'button', class: 'cell' + stateClass(selCell, false), 'data-key': r + '|' + c, 'aria-pressed': selCell ? 'true' : 'false',
            title: r + ' / ' + c + ': ' + n + ' ' + o.unit, 'aria-label': r + ' / ' + c + ': ' + n + ' ' + o.unit,
            onclick: function (e) { o.onCell(r, c, isMulti(e)); }
          }, [String(n)])
        ]);
      });
      return el('tr', null, [el('th', { class: 'rowh', scope: 'row', text: r, title: r })]
        .concat(tds).concat([el('td', { class: 'tot', text: String(ct.rowTotals[r]) })]));
    });
    t.body.appendChild(el('table', { class: 'heat' }, [el('thead', null, [head]), el('tbody', null, rows)]));
  }

  // ---- Jira links (SPEC §9a, DATA_CONTRACT §7a) ----------------------------
  var JIRA_BASE = 'https://mysnaplogic.atlassian.net'; // the only place the Jira address lives
  var JIRA_DASHBOARD_URL = JIRA_BASE + '/jira/dashboards/18635';
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
  function linkCell(v) { return isBlank(v) ? '—' : el('span', null, linkify(v)); }

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

  // A load error. err.userMessage, when set, replaces the generic "missing or not valid JSON" sentence (C8).
  function showError(container, file, err) {
    clear(container);
    var onFile = root.location && root.location.protocol === 'file:';
    var detail = err && err.message ? err.message : 'unknown error';
    container.appendChild(el('section', { class: 'message', role: 'alert' }, [
      el('h2', { text: 'Can’t load ' + file }),
      el('p', { text: onFile
        ? 'This page was opened as a file. Browsers block local data files that way. Start the local server instead.'
        : err && err.userMessage ? err.userMessage : 'The file is missing or not valid JSON (' + detail + ').' }),
      el('p', null, ['Run ', el('code', { text: 'python3 05_Automation/export_dashboard_snapshots.py' }),
        ' from the project root, then reload.']),
      el('p', null, ['To serve the page: ', el('code', { text: 'cd AF_Dashboard && python3 -m http.server 8000' }),
        ', then open http://localhost:8000/.'])
    ]));
  }

  // A bug while drawing the page: not a data-file problem, so it gets its own message (C6, C7).
  function showRenderError(container, err) {
    if (typeof console !== 'undefined') console.error('AF dashboard render error:', err);
    clear(container);
    container.appendChild(el('section', { class: 'message', role: 'alert' }, [
      el('h2', { text: 'Can’t draw this page' }),
      el('p', { text: 'The data loaded, but drawing the page failed (' + (err && err.message ? err.message : 'unknown error') + '). This is a dashboard bug, not a data problem; the browser console has the details.' })
    ]));
  }

  // Neutral message used when a snapshot has nothing to show (SPEC §4).
  function emptyMessage(container, title, text) {
    container.appendChild(el('section', { class: 'message neutral' }, [el('h2', { text: title }), el('p', { text: text })]));
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

  var AF = {
    BUCKETS: BUCKETS, BUCKET_CLASS: BUCKET_CLASS, OTHER: OTHER, NONE: NONE, COLORS: COLORS, COLOR_TOKENS: COLOR_TOKENS,
    bucketOf: bucketOf, isBlank: isBlank, pts: pts, fmtNum: fmtNum, show: show, showPoints: showPoints, naturalCompare: naturalCompare,
    personName: personName, sum: sum, statusTotals: statusTotals, aggregateBy: aggregateBy,
    countBy: countBy, crossTab: crossTab, median: median, createStore: createStore,
    fold: fold, searchWords: searchWords, fieldMatches: fieldMatches, compileSearch: compileSearch, exactFirst: exactFirst,
    config: config, dayNum: dayNum, isoOf: isoOf, avgCycleTime: avgCycleTime, oneDecimal: oneDecimal, midSprintAdded: midSprintAdded,
    burndown: burndown, niceScale: niceScale, drawBurndown: drawBurndown, shortDate: shortDate, longDate: longDate, icon: icon,
    el: el, clear: clear, isMulti: isMulti, tile: tile, kpi: kpi, rebuild: rebuild, rowButton: rowButton, stateClass: stateClass,
    markScrollable: markScrollable, statusDot: statusDot, pair: pair, simpleBar: simpleBar, heatColor: heatColor,
    buildTable: buildTable, filterBar: filterBar, heatGrid: heatGrid, searchBox: searchBox, setUrlParam: setUrlParam, urlParam: urlParam,
    jira: { base: JIRA_BASE, url: jiraUrl, link: jiraLink, linkify: linkify }, jiraDashboardUrl: JIRA_DASHBOARD_URL, ticketCell: ticketCell, linkCell: linkCell,
    loadJson: loadJson, loadSnapshot: loadSnapshot, showError: showError, showRenderError: showRenderError,
    emptyMessage: emptyMessage, emptyState: emptyState, setUpdated: setUpdated
  };
  root.AF = AF;
  if (typeof module === 'object' && module && module.exports) module.exports = AF; // Node unit tests (C9)

  if (hasDom) { // page wiring; skipped when the file is loaded outside a browser
    var liveDashboardLink = document.querySelector('.live-dashboard-link');
    if (liveDashboardLink) liveDashboardLink.href = JIRA_DASHBOARD_URL;
    var resizeQueued = false;
    root.addEventListener('resize', function () {
      if (resizeQueued) return;
      resizeQueued = true;
      root.requestAnimationFrame(function () { resizeQueued = false; markAllScrollables(); });
    });
  }
})();
