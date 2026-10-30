'use strict';
/*
 * model.js — the harness's independent expected-value model, written separately from the app code
 * (never calls dashboard.js) so a bug in the app cannot hide in its own expectations.
 * The duplication of a few rules (status buckets, Unassigned grouping, the self-tested rule) is deliberate (C49).
 */
const { UI, THR_TIME } = require('./ui_text');

// ---------- shared ----------
const BN = ['To Do/Open', 'In Progress', 'In Review', 'Done', 'Other'];
const bucket = s => ({ 'To Do': 0, 'Open': 0, 'In Progress': 1, 'In Review': 2, 'Done': 3 }[s] ?? 4);
const pt = v => typeof v === 'number' ? v : 0;
const grpName = v => (v == null || String(v).trim() === '' || v === 'Unassigned') ? 'Unassigned' : v;
const sumP = rows => rows.reduce((a, t) => a + pt(t.points), 0);
const group = (rows, kf) => { const m = {}; rows.forEach(t => { const k = kf(t); (m[k] = m[k] || { i: 0, p: 0 }); m[k].i++; m[k].p += pt(t.points); }); return m; };
const natural = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
const isDevToTest = t => String(t.classifications || '').split('; ').includes('Dev to Test');
const isQaToTest = t => String(t.classifications || '').split('; ').includes('QA to Test');
const selfTestClass = t => isDevToTest(t) || isQaToTest(t); // R001-18: QA to Test counts like Dev to Test
const noTesterValue = t => t.tester == null || String(t.tester).trim() === '' || String(t.tester).trim() === 'Unassigned';
const noTester = t => noTesterValue(t) && !selfTestClass(t); // KPI "No tester & not self-tested"
// Ticket detail "Self-tested" column (R001-18): Dev to Test, QA to Test, Same person (tester = assignee), else a dash.
const selfTestReason = t => isDevToTest(t) ? 'Dev to Test' : isQaToTest(t) ? 'QA to Test' : (!noTesterValue(t) && grpName(t.tester) === grpName(t.owner)) ? 'Same person' : '—';
const longRunning = t => (t.status === 'In Progress' || t.status === 'In Review') && typeof t.statusAging === 'number' && t.statusAging >= THR_TIME;
// Assignee x tester column (R001-17, R001-18): Self-tested = Dev to Test or QA to Test with no tester, or tester = assignee;
// Unassigned = no tester and not self-tested; otherwise the tester's name.
const testerGroup = t => { const who = grpName(t.tester); if (who === 'Unassigned') return selfTestClass(t) ? UI.sprint.matrix.selfTested : 'Unassigned'; return who === grpName(t.owner) ? UI.sprint.matrix.selfTested : who; };

// ---------- dates ----------
const DAYMS = 86400000;
const dn = s => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '')); return m ? Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / DAYMS) : NaN; };
const isoN = n => new Date(n * DAYMS).toISOString().slice(0, 10);
const md = iso => Number(iso.slice(5, 7)) + '/' + Number(iso.slice(8, 10));
const f1 = x => String(Math.round(x * 10) / 10);
// a ticket counts as added mid-sprint when its addedDate is a real date later than start + thr days
const addedAfter = (t, sprint, thr) => { const a = dn(t.addedDate); return !isNaN(a) && a > dn(sprint.startDate) + thr; };

// ---------- sprint filters ----------
const SKEY = { status: t => BN[bucket(t.status)], type: t => t.type == null || String(t.type).trim() === '' ? '—' : String(t.type), assignee: t => grpName(t.owner), tester: testerGroup };
const newF = () => ({ status: new Set(), type: new Set(), assignee: new Set(), tester: new Set() });
const applyF = (rows, f, keyMap, except = [], pred = null) => rows.filter(t => Object.keys(f).every(d => except.includes(d) || !f[d].size || f[d].has(keyMap[d](t))) && (!pred || pred(t)));

// ---------- free-text search (R001-19), written separately from dashboard.js ----------
const sfold = v => String(v == null ? '' : v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const SSPLIT = /[\s,;:()\[\]{}|"'“”‘’!?*]+/;
const swords = v => sfold(v).split(SSPLIT).map(w => w.replace(/^[.\-\/]+|[.\-\/]+$/g, '')).filter(Boolean);
const blankV = v => v == null || String(v).trim() === '';
const keyHit = (v, w) => !blankV(v) && sfold(v).includes(w);
const textHit = (v, w) => !blankV(v) && swords(v).some(x => x.startsWith(w));
const linkedHit = (v, w) => textHit(v, w) || (!blankV(v) && (sfold(v).match(/\b[a-z][a-z0-9]+-[0-9]+\b/g) || []).some(k => k.includes(w)));
const HIT = { key: keyHit, text: textHit, linked: linkedHit };
const named = v => grpName(v) === 'Unassigned' ? null : v;
const reasonOrNull = t => { const r = selfTestReason(t); return r === '—' ? null : r; };
// allowed fields and whole phrases per page (SPEC §6.4, §7.3)
const SEARCH = {
  sprint: {
    fields: t => [['key', t.ticket], ['text', t.summary], ['text', t.status], ['text', reasonOrNull(t)], ['linked', t.parent], ['text', t.fixVersion], ['text', named(t.owner)], ['text', named(t.tester)]],
    phrases: { 'in review': t => t.status === 'In Review', 'in progress': t => t.status === 'In Progress', 'dev to test': t => reasonOrNull(t) === 'Dev to Test', 'qa to test': t => reasonOrNull(t) === 'QA to Test', 'same person': t => reasonOrNull(t) === 'Same person', 'self-tested': t => reasonOrNull(t) !== null }
  },
  backlog: {
    fields: t => [['key', t.ticket], ['text', t.summary], ['text', t.dor], ['linked', t.epic]],
    phrases: { 'well-formed': t => t.dor === 'Well-Formed' }
  }
};
// { pred, tag, exact } for a query on a page, or null when the query is blank
function searchModel(q, page) {
  const P = SEARCH[page]; let rest = ' ' + swords(q).join(' ') + ' '; const tests = [];
  Object.keys(P.phrases).sort((a, b) => b.length - a.length).forEach(ph => { while (rest.includes(' ' + ph + ' ')) { tests.push(P.phrases[ph]); rest = rest.replace(' ' + ph + ' ', ' '); } });
  const ws = rest.trim() ? rest.trim().split(' ') : [];
  if (!tests.length && !ws.length) return null;
  ws.forEach(w => tests.push(t => P.fields(t).some(([k, v]) => HIT[k](v, w))));
  const keyWs = ws.filter(w => /^[a-z][a-z0-9]+-[0-9]+$/.test(w) || /^[0-9]+$/.test(w));
  const exact = t => { const k = sfold(t.ticket); return keyWs.some(w => k === w || k.slice(k.lastIndexOf('-') + 1) === w); };
  return { pred: t => tests.every(f => f(t)), tag: 'Search: “' + String(q).trim() + '”', exact };
}
const exactFirst = (rows, s) => s ? rows.filter(s.exact).concat(rows.filter(t => !s.exact(t))) : rows;

// Independent burndown expectation.
function expectBurn(all, ctx, thr, rem = []) {
  const sp = ctx.sprint;
  const s = dn(sp.startDate), e = dn(sp.endDate);
  const n = e - s + 1, addOn = Array(n).fill(0), doneOn = Array(n).fill(0), cnt = Array(n).fill(0); let unplaced = 0;
  all.forEach(t => {
    const a = dn(t.addedDate), ai = isNaN(a) ? 0 : Math.min(n - 1, Math.max(0, a - s)); addOn[ai] += pt(t.points);
    if (bucket(t.status) !== 3) return;
    const d = dn(t.doneDate); if (isNaN(d)) { unplaced++; return; }
    let idx = Math.max(0, d - s); if (idx >= n) return; idx = Math.max(idx, ai); doneOn[idx] += pt(t.points); cnt[idx]++;
  });
  const remOn = Array(n).fill(0), rby = {};
  rem.forEach(r => {
    const rd = dn(r.removedDate); if (isNaN(rd)) return;
    const a = dn(r.addedDate), ai = isNaN(a) ? 0 : Math.min(n - 1, Math.max(0, a - s)), ri = Math.max(ai, Math.min(n - 1, Math.max(0, rd - s)));
    addOn[ai] += pt(r.points); remOn[ri] += pt(r.points);
    const k = isoN(s + ri); (rby[k] = rby[k] || { c: 0, p: 0 }); rby[k].c++; rby[k].p += pt(r.points);
  });
  const chartDay = ctx.closed ? sp.endDate : ctx.today;
  const td = dn(chartDay), ti = isNaN(td) ? -1 : Math.max(-1, Math.min(n - 1, td - s)), inside = !ctx.closed && !isNaN(td) && td >= s && td <= e;
  let cum = 0, sc = 0, mx = 0; const days = [];
  for (let i = 0; i < n; i++) {
    cum += doneOn[i]; sc += addOn[i] - remOn[i]; mx = Math.max(mx, sc);
    days.push({ date: isoN(s + i), scope: sc, ideal: n > 1 ? (addOn[0] - remOn[0]) * (1 - i / (n - 1)) : 0, remaining: i <= ti ? sc - cum : null, done: doneOn[i], cnt: cnt[i] });
  }
  const mid = all.filter(t => addedAfter(t, sp, thr)), by = {};
  all.filter(t => !isNaN(dn(t.addedDate)) && dn(t.addedDate) > s).forEach(t => {
    const k = isoN(Math.min(dn(t.addedDate), e)); (by[k] = by[k] || { c: 0, p: 0 }); by[k].c++; by[k].p += pt(t.points);
  });
  return { n, total: mx, ti, inside, days, unplaced, mid: { count: mid.length, points: sumP(mid) }, by, rby, hasRemoved: Array.isArray(sp.removed), name: sp.name, limit: isoN(s + thr) };
}

// Needs attention today (R001-02) for the filtered set `all`; S is the whole snapshot (blocker status lookup).
// Rows: not Done and long-running, carried over, blocked by a ticket not Done in S, or with blocker text.
function expectAttention(all, S, sprint) {
  const A = UI.sprint.attention.reasons, byKey = new Map(S.map(t => [t.ticket, t]));
  const carried = sprint.carriedOver && Array.isArray(sprint.carriedOver.ticketKeys) ? sprint.carriedOver.ticketKeys : [];
  const rows = [];
  all.forEach(t => {
    if (bucket(t.status) === 3) return;
    const reasons = [];
    if (longRunning(t)) reasons.push(A.long);
    if (carried.includes(t.ticket)) reasons.push(A.carried);
    const blockers = []; for (const m of String(t.linkedWorkItems || '').matchAll(/\b([A-Z][A-Z0-9]+-[0-9]+) \(is blocked by\)/g)) { const b = byKey.get(m[1]); if (!(b && bucket(b.status) === 3) && !blockers.includes(m[1])) blockers.push(m[1]); }
    blockers.forEach(k => reasons.push(A.blocked(k)));
    if (t.blocker != null && String(t.blocker).trim() !== '') reasons.push(A.blocker);
    if (reasons.length) rows.push({ key: t.ticket, status: t.status, days: typeof t.statusAging === 'number' ? String(t.statusAging) + (t.statusAgingApprox ? '*' : '') : '—', aging: typeof t.statusAging === 'number' ? t.statusAging : -1, reasons });
  });
  rows.sort((a, b) => b.aging - a.aging || natural(a.key, b.key));
  const missing = UI.sprint.attention.missing(all.filter(noTester).length, all.filter(t => t.fixVersion == null || String(t.fixVersion).trim() === '').length, all.filter(t => typeof t.points !== 'number' || !isFinite(t.points)).length);
  return { rows, missing };
}

// Everything the sprint page should show for tickets S under filters f; ctx = { sprint, today, thr, closed }.
function expectSprint(S, f, ctx) {
  const srch = ctx.q ? searchModel(ctx.q, 'sprint') : null, sp = srch ? srch.pred : null; // R001-19: the search applies to every tile
  const all = applyF(S, f, SKEY, [], sp), P = sumP(all), TP = sumP(S);
  const doneP = sumP(all.filter(t => bucket(t.status) === 3));
  const active = Object.keys(f).some(d => f[d].size) || !!sp;
  const thr = ctx.thr;
  const bd = expectBurn(all, ctx, thr, Array.isArray(ctx.sprint.removed) ? applyF(ctx.sprint.removed, f, SKEY, [], sp) : []);
  const cyc = all.filter(t => bucket(t.status) === 3 && typeof t.cycleTime === 'number'), avg = cyc.length ? cyc.reduce((a, t) => a + t.cycleTime, 0) / cyc.length : null;
  const co = ctx.sprint.carriedOver; let carriedV, carriedH;
  if (!co) { carriedV = '—'; carriedH = UI.sprint.hints.carriedNull; }
  else { const parts = []; if (co.percent != null) parts.push(String(co.percent) + '% of tickets'); if (co.storyPoints != null) parts.push(String(co.storyPoints) + ' points'); carriedV = co.count == null ? '—' : String(co.count); carriedH = parts.length ? parts.join(', ') : UI.sprint.hints.carriedNoFigures; }
  const withAging = all.filter(t => (t.status === 'In Progress' || t.status === 'In Review') && typeof t.statusAging === 'number');
  const kh = {
    time: withAging.length ? UI.sprint.hints.timeWithData : UI.sprint.hints.timeNoData,
    cycle: UI.sprint.hints.cycle(cyc.length),
    mid: UI.sprint.hints.mid(bd.mid.points, thr),
    carried: carriedH
  };
  // order: Work items, Story points, Done, Added mid-sprint, Carried over, No tester, Long-running work, Avg cycle time
  const kp = [String(all.length), String(P), P > 0 ? Math.round(doneP / P * 100) + '%' : '—', String(bd.mid.count), carriedV,
    String(all.filter(noTester).length), withAging.length ? String(all.filter(longRunning).length) : '—', avg === null ? '—' : f1(avg)];
  const stBase = applyF(S, f, SKEY, ['status'], sp); const stG = group(stBase, SKEY.status);
  const typeBase = applyF(S, f, SKEY, ['type'], sp); const typeG = group(typeBase, SKEY.type);
  const attention = expectAttention(all, S, ctx.sprint);
  const mBase = applyF(S, f, SKEY, ['assignee', 'tester'], sp); const mat = {};
  mBase.forEach(t => { const r = SKEY.assignee(t), c = SKEY.tester(t); (mat[r] = mat[r] || {})[c] = (mat[r][c] || 0) + 1; });
  return { kpiValues: kp, active, all, status: stG, stBase, types: typeG, typeBase, attention, matrix: mat, mBase, detailKeys: exactFirst(all, srch).map(t => t.ticket), searchTag: srch ? srch.tag : null, points: P, totalPoints: TP, kpiHints: kh, bd };
}

// ---------- backlog ----------
const AGEB = ['0–30', '31–90', '91–180', '181–365', '366+', 'No value'];
const ageOf = t => typeof t.days !== 'number' ? AGEB[5] : t.days <= 30 ? AGEB[0] : t.days <= 90 ? AGEB[1] : t.days <= 180 ? AGEB[2] : t.days <= 365 ? AGEB[3] : AGEB[4];
const dv = v => (v == null || String(v).trim() === '') ? '—' : String(v);
const BKEY = { dor: t => dv(t.dor), priority: t => dv(t.priority), type: t => dv(t.type), age: ageOf, epic: t => (t.epic === null || t.epic === undefined || String(t.epic).trim() === '') ? UI.backlog.noEpic : String(t.epic) };
const newBF = () => ({ dor: new Set(), priority: new Set(), type: new Set(), age: new Set() });
const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
// value with the most tickets (ties broken by name), optionally excluding some values
function mostCommon(rows, keyFn, exclude = []) {
  const c = {}; rows.forEach(t => { const k = keyFn(t); if (!exclude.includes(k)) c[k] = (c[k] || 0) + 1; });
  return Object.keys(c).sort((a, b) => c[b] - c[a] || a.localeCompare(b));
}

// ---------- Jira links ----------
const KEYRE = /\b[A-Z][A-Z0-9]+-[0-9]+\b/g;
const keysIn = s => (s == null ? [] : String(s).match(KEYRE) || []);
function linkErrors(cells, values, structured) {
  const errs = [];
  cells.forEach((c, i) => {
    const v = values[i], want = structured === 'ticket' ? (/^[A-Z][A-Z0-9]+-[0-9]+$/.test(String(v)) ? [String(v)] : []) : keysIn(v);
    const got = c.links.map(l => l.t);
    if (JSON.stringify(got) !== JSON.stringify(want)) errs.push(['keys', i, got, want]);
    c.links.forEach(l => { if (l.h !== UI.jiraBrowse + encodeURIComponent(l.t) || l.target !== '_blank' || !/noopener/.test(l.rel || '')) errs.push(['link attrs', l]); });
    const wantText = v == null || String(v).trim() === '' ? '—' : String(v);
    if (c.text !== wantText.replace(/\s+/g, ' ').trim()) errs.push(['text changed', i, c.text, wantText]);
    if (c.foreign) errs.push(['foreign element', i]);
  });
  return errs.slice(0, 4);
}

// ---------- WCAG contrast ----------
function contrast(fg, bg) { // fg, bg: [r, g, b] 0-255
  const lin = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const L = rgb => 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
  const a = L(fg), b = L(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

module.exports = {
  BN, bucket, pt, grpName, sumP, group, natural, isDevToTest, isQaToTest, selfTestClass, selfTestReason, noTester, longRunning, testerGroup, expectAttention,
  sfold, swords, searchModel, exactFirst, dn, isoN, md, f1, addedAfter, SKEY, newF, applyF, expectBurn, expectSprint,
  AGEB, ageOf, dv, BKEY, newBF, median, mostCommon, KEYRE, keysIn, linkErrors, contrast
};
