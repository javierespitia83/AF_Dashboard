#!/usr/bin/env node
/*
 * run_acceptance.js — automated acceptance run for the AF_Dashboard web app (ACCEPTANCE.md).
 *
 * Drives a real headless Chrome over the DevTools protocol, clicks through all three pages and compares
 * every tile, KPI, tag and table with an independent calculation (scripts/lib/model.js) from the sprint
 * manifest, the sprint snapshots, backlog.json and quality-intake.json. Every test target (people, epics,
 * matrix cells, closed sprint) is derived from the loaded JSON; the only fixed values are layout
 * expectations and the hand-made data below.
 *
 * Read-only: it serves a staged copy of the app and data files (never the repository itself, so .env and
 * .git/ are not exposed), runs edge cases on throwaway copies in a scratch folder, and at the end proves
 * by content hash that no file under the repository changed (plus the tracker workbook, when found).
 *
 * Needs: Node 22+ (global fetch and WebSocket), python3 (local servers), Google Chrome.
 * Run from this app folder:  node scripts/run_acceptance.js [dashboard_dir] [scratch_dir]
 * Environment:  CHROME_PATH (Chrome binary), CHROME_ARGS (extra flags, e.g. --no-sandbox),
 *               ACCEPT_DEBUG_PORT (fixed DevTools port), ACCEPT_CDP_TIMEOUT_MS (default 30000),
 *               AF_TRACKER_PATH (tracker workbook for the read-only check; see lib/files.js findTracker).
 * Exit code:    0 every check passed, 1 at least one check failed, 2 the harness itself failed.
 *               Results are kept in the scratch folder whenever the run is not a clean pass.
 * Modules:      lib/cdp.js (Chrome), lib/files.js (staging, servers, read-only proof), lib/schema.js (the
 *               JSON Schema validator), lib/model.js (expected values), lib/page.js (in-page snippets),
 *               lib/ui_text.js (every UI string the checks expect). Unit tests: scripts/unit.test.js.
 * Keep it in sync: if SPEC.md, DATA_CONTRACT.md or ACCEPTANCE.md change, update the expectations here
 *               in the same pass.
 */
'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs'); const path = require('path'); const os = require('os');
const { launchChrome, openPage, sleep } = require('./lib/cdp');
const files = require('./lib/files');
const { validate, unsupportedKeywords } = require('./lib/schema');
const M = require('./lib/model');
const { UI } = require('./lib/ui_text');
const { run, READ_BD, READ_SPRINT, READ_BACKLOG, READ_SEARCH, LAYOUT, SCROLL_REGIONS } = require('./lib/page');

const ROOT = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const OWN_SCRATCH = !process.argv[3];
const SP = path.resolve(process.argv[3] || fs.mkdtempSync(path.join(os.tmpdir(), 'af_dashboard_accept_')));
const CH = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ST = UI.sprint.tiles, BT = UI.backlog.tiles, q = JSON.stringify;

const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (!ok && detail !== undefined ? '  -> ' + JSON.stringify(detail).slice(0, 700) : '')); };
const skips = [];
const skip = (name, why) => { skips.push({ name, why }); console.log('SKIP ' + name + ' (' + why + ')'); };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const eqObj = (a, b) => eq(Object.entries(a || {}).sort(), Object.entries(b || {}).sort()); // same keys and values, any order
const J = f => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
const asOfLabel = snapshot => {
  const d = new Date(snapshot.exportedAt || '');
  if (!snapshot.exportedAt || isNaN(d.getTime())) return 'Data as of ' + snapshot.refreshedAt;
  const pad = n => String(n).padStart(2, '0');
  const offset = -d.getTimezoneOffset(), sign = offset >= 0 ? '+' : '-', abs = Math.abs(offset);
  return `Data as of ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} · ${pad(d.getHours())}:${pad(d.getMinutes())} UTC${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
};

// ---------- hand-made data (answers worked out by hand; see the burndown checks) ----------
const SP_OK = { id: 1, name: 'Hand sprint', startDate: '2026-09-22', endDate: '2026-09-28' };
const emptyJson = JSON.stringify({ refreshedAt: '2026-10-01', source: 'x', tickets: [] });
const linksSprint = JSON.stringify({ refreshedAt: '2026-10-01', source: 'x', tickets: [
  { ticket: 'APP-1', owner: 'A', status: 'Done', tester: null, points: 1, parent: 'APP-5/DOC-6 and lower-1 and APP- and xAPP-2 and APP-3y', linkedWorkItems: 'APP-7, <img src=x onerror=alert(1)> DOC-22, javascript:alert(1) PLATENG-9', fixVersion: '1', summary: 'UTF-8 and SHA-256 text, see APP-99', lastSyncUpdate: 'blocked by APP-98', blocker: 'Legacy blocker APP-97', demoOrSpike: null, discussed: null },
  { ticket: 'not a key', owner: 'B', status: 'Done', tester: null, points: null, parent: null, linkedWorkItems: null, fixVersion: null, summary: null, lastSyncUpdate: null, blocker: null, demoOrSpike: null, discussed: null }] });
const TK = o => Object.assign({ owner: 'Ann', status: 'Done', tester: 'Tim', points: 1, parent: null, linkedWorkItems: null, fixVersion: '4.46', doneDate: null, addedDate: '2026-09-22', cycleTime: null, summary: 's', lastSyncUpdate: null, blocker: null, demoOrSpike: null, discussed: null }, o);
const BURN_T = [
  TK({ ticket: 'APP-901', points: 5, doneDate: '2026-09-23', cycleTime: 2 }),
  TK({ ticket: 'APP-902', points: 3, doneDate: '2026-09-24', cycleTime: 3 }),
  TK({ ticket: 'APP-903', owner: 'Bob', tester: null, status: 'In Progress', points: 2, addedDate: '2026-09-26' }),
  TK({ ticket: 'APP-904', owner: 'Bob', points: 4, doneDate: '2026-09-20', cycleTime: 5 }),
  TK({ ticket: 'APP-905', owner: 'Bob', points: 1 }),
  TK({ ticket: 'APP-906', status: 'In Review', tester: null, points: null, addedDate: '2026-09-25' })];
const mkSprint = (sprint, today = '2026-09-25', tickets = BURN_T) => JSON.stringify({ refreshedAt: today, source: 'x', sprint, tickets });
const REMOVED = [
  { ticket: 'APP-950', points: 3, addedDate: '2026-09-22', removedDate: '2026-09-24', status: 'In Progress', owner: 'Ann', tester: 'Tim', fixVersion: '4.46', parent: null, summary: 'gone one' },
  { ticket: 'APP-951', points: 2, addedDate: '2026-09-23', removedDate: '2026-09-24', status: 'To Do', owner: 'Bob', tester: null, fixVersion: '4.46', parent: null, summary: 'gone two' }];
const CARRIED = { count: 3, percent: 20, storyPoints: 8 };
// Needs attention today and Self-tested (R001-02, R001-17, R001-18); the expected rows and cells are worked out by hand below.
const ATT_T = [
  TK({ ticket: 'APP-801', status: 'In Review', statusAging: 9, tester: 'Ann' }),
  TK({ ticket: 'APP-802', status: 'In Progress', statusAging: 2, linkedWorkItems: 'APP-803 (is blocked by), APP-804 (is blocked by), APP-809 (relates to)' }),
  TK({ ticket: 'APP-803', statusAging: 0 }),
  TK({ ticket: 'APP-804', status: 'In Progress', statusAging: 1, tester: null, classifications: 'Dev to Test', blocker: 'Waiting on Zed Person for a review' }),
  TK({ ticket: 'APP-805', status: 'Open', statusAging: 12, statusAgingApprox: true }),
  TK({ ticket: 'APP-806', blocker: 'Old blocker text on a Done ticket' }),
  TK({ ticket: 'APP-807', status: 'In Progress', statusAging: 0, linkedWorkItems: 'APP-999 (is blocked by)' }),
  TK({ ticket: 'APP-808', status: 'To Do', tester: null, points: null, fixVersion: null }),
  TK({ ticket: 'APP-810', status: 'In Progress', statusAging: 3, linkedWorkItems: 'APP-803 (is blocked by)' }),
  TK({ ticket: 'APP-811', owner: 'Bob', tester: 'Ann', classifications: 'Dev to Test' }),
  TK({ ticket: 'APP-812', tester: null, classifications: 'Customer Escalation; QA to Test' }),
  TK({ ticket: 'APP-813', owner: 'Bob', tester: 'Tim', classifications: 'QA to Test' })];
const ATT_CARRIED = { count: 2, percent: 20, storyPoints: 2, ticketKeys: ['APP-805', 'APP-806'] };
const manifestFor = (sp, extraTop = {}, extraEntry = {}) => JSON.stringify(Object.assign({ current: sp.id, sprints: [Object.assign({ id: sp.id, name: sp.name, startDate: sp.startDate, endDate: sp.endDate, state: 'active', file: 'snapshots/sprint-' + sp.id + '.json' }, extraEntry)] }, extraTop));

// A throwaway copy of the app. files: { snapshot, manifest, 'backlog.json', 'quality-intake.json', ... } as text.
// `snapshot` is written to snapshots/sprint-<id>.json; without an explicit `manifest` a one-entry manifest is generated.
function variant(name, spec) {
  const d = path.join(SP, 'var_' + name); fs.rmSync(d, { recursive: true, force: true }); fs.mkdirSync(d, { recursive: true });
  files.APP_FILES.concat(['quality-intake.json']).forEach(f => fs.copyFileSync(path.join(ROOT, f), path.join(d, f)));
  Object.entries(spec).forEach(([k, v]) => {
    if (k === 'snapshot') {
      let data = null; try { data = JSON.parse(v); } catch (e) { /* keep the raw text: a deliberately invalid snapshot */ }
      if (data && typeof data === 'object' && !data.sprint) { data.sprint = Object.assign({}, SP_OK, { name: 'Test sprint' }); v = JSON.stringify(data); }
      const sp = (data && data.sprint) || Object.assign({}, SP_OK, { name: 'Test sprint' });
      fs.mkdirSync(path.join(d, 'snapshots'), { recursive: true });
      fs.writeFileSync(path.join(d, 'snapshots', 'sprint-' + sp.id + '.json'), v);
      if (!('manifest' in spec)) fs.writeFileSync(path.join(d, 'sprints.json'), manifestFor(sp));
    } else if (k === 'manifest') fs.writeFileSync(path.join(d, 'sprints.json'), v);
    else fs.writeFileSync(path.join(d, k), v);
  });
  return d;
}

async function main() {
  // ---------- read-only baseline, then data (all inside main so a failure here still cleans up) ----------
  const fingerprintBefore = files.treeFingerprint(ROOT, [SP]);
  const tracker = files.findTracker();
  const trackerBefore = tracker.file ? files.statSignature(tracker.file) : null;

  const MANIFEST = J('sprints.json');
  const ACTIVE = MANIFEST.sprints.find(x => x.id === MANIFEST.current);
  if (!ACTIVE) throw new Error('sprints.json has no entry for current = ' + MANIFEST.current);
  const ACTIVE_FILE = ACTIVE.file;
  const SPRJ = J(ACTIVE_FILE); const S = SPRJ.tickets;
  const BJ = J('backlog.json'), B = BJ.tickets;
  const Q = J('quality-intake.json');
  const CTX = { sprint: SPRJ.sprint, today: SPRJ.refreshedAt, thr: 1 };
  // The closed sprint used by the closed-view checks: the oldest closed entry in the manifest (frozen data).
  const closedEntries = MANIFEST.sprints.filter(x => x.state === 'closed');
  const CLOSED_ENTRY = closedEntries[closedEntries.length - 1] || null;
  const CLOSED = CLOSED_ENTRY ? J(CLOSED_ENTRY.file) : null;
  const fixtureTxt = fs.readFileSync(path.join(ROOT, 'fixtures/sample_snapshot.json'), 'utf8');

  // ---------- staged copies and servers ----------
  const servers = [];
  let chrome = null;
  try {
    const dirs = {
      real: files.stageRealApp(ROOT, path.join(SP, 'real')),
      missing: variant('missing', {}),
      invalid: variant('invalid', { snapshot: '{not json', 'backlog.json': '{not json' }),
      empty: variant('empty', { snapshot: emptyJson, 'backlog.json': emptyJson }),
      fixture: variant('fixture', { snapshot: fixtureTxt, 'backlog.json': emptyJson }),
      links: variant('links', { snapshot: linksSprint, 'backlog.json': emptyJson }),
      burn: variant('burn', { snapshot: mkSprint(Object.assign({ carriedOver: CARRIED }, SP_OK)), 'backlog.json': emptyJson }),
      cnull: variant('cnull', { snapshot: mkSprint(Object.assign({ carriedOver: null }, SP_OK)), 'backlog.json': emptyJson }),
      czero: variant('czero', { snapshot: mkSprint(Object.assign({ carriedOver: { count: 0, percent: 0, storyPoints: 0 } }, SP_OK)), 'backlog.json': emptyJson }),
      cpart: variant('cpart', { snapshot: mkSprint(Object.assign({ carriedOver: { count: 5, percent: null, storyPoints: 12 } }, SP_OK)), 'backlog.json': emptyJson }),
      attn: variant('attn', { snapshot: mkSprint(Object.assign({ carriedOver: ATT_CARRIED }, SP_OK), '2026-09-25', ATT_T), 'backlog.json': emptyJson }),
      rem: variant('rem', { snapshot: mkSprint(Object.assign({ carriedOver: CARRIED, removed: REMOVED }, SP_OK)), 'backlog.json': emptyJson }),
      noManifest: variant('no_manifest', {}),
      badManifest: variant('bad_manifest', { 'sprints.json': '{not json' }),
      // unknown keys in the manifest are tolerated (D74)
      manifestExtra: variant('manifest_extra', { snapshot: mkSprint(Object.assign({ carriedOver: CARRIED }, SP_OK)), manifest: manifestFor(SP_OK, { generatedBy: 'future exporter' }, { color: 'blue' }), 'backlog.json': emptyJson }),
      // a file outside snapshots/sprint-<id>.json is refused (D74)
      manifestBadFile: variant('manifest_bad_file', { snapshot: mkSprint(Object.assign({ carriedOver: CARRIED }, SP_OK)), manifest: manifestFor(SP_OK, {}, { file: 'backlog.json' }), 'backlog.json': emptyJson }),
      // snapshot and manifest disagree on the end date (C8)
      mismatch: variant('mismatch', { snapshot: mkSprint(Object.assign({ carriedOver: CARRIED }, SP_OK)), manifest: manifestFor(Object.assign({}, SP_OK, { endDate: '2026-09-29' })), 'backlog.json': emptyJson }),
      // valid JSON that makes every page's drawing code throw (C6, C7)
      renderErr: variant('render_error', { snapshot: JSON.stringify({ refreshedAt: '2026-09-25', source: 'x', sprint: SP_OK, tickets: [null] }), 'backlog.json': JSON.stringify({ refreshedAt: '2026-09-25', source: 'x', tickets: [null] }), 'quality-intake.json': JSON.stringify({ refreshedAt: '2026-09-25', exportedAt: 'x', source: 'x', sprints: [null] }) })
    };
    const url = {};
    for (const k of Object.keys(dirs)) { const s = await files.startServer(dirs[k]); servers.push(s); url[k] = s.url; }
    const extra = (process.env.CHROME_ARGS || '').split(/\s+/).filter(Boolean);
    chrome = await launchChrome({ chromePath: CH, profileDir: path.join(SP, 'chrome_profile'), debugPort: Number(process.env.ACCEPT_DEBUG_PORT) || 0, extraArgs: extra });
    const open = (u, w, h) => openPage(chrome.port, u, w, h);
    const base = url.real;
    const isLocal = (u, b = base) => u.startsWith(b) || u.startsWith('data:');
    await suites({ open, url, base, isLocal, MANIFEST, ACTIVE, ACTIVE_FILE, SPRJ, S, BJ, B, Q, CTX, CLOSED_ENTRY, CLOSED, fixtureTxt, dirs });
  } finally {
    if (chrome) chrome.kill();
    servers.forEach(s => s.stop());
  }

  // ---------- the run changed nothing ----------
  const changed = files.diffFingerprints(fingerprintBefore, files.treeFingerprint(ROOT, [SP]));
  check('Read-only: no file under the repository changed during the run (content hash of every file except .git/; .env by size and time)', changed.length === 0, changed.slice(0, 10));
  if (tracker.file) check('Read-only: the tracker workbook (daily_tracker.xlsx) is unchanged (size and modification time)', files.statSignature(tracker.file) === trackerBefore, { tracker: tracker.file });
  else if (tracker.explicit) check('Read-only: tracker workbook found at the path given by AF_TRACKER_PATH / AF_SNAPLOGIC_ROOT', false, 'not found');
  else skip('Read-only: tracker workbook unchanged', 'no tracker on this machine; set AF_TRACKER_PATH to include it');
}

async function suites(ctx) {
  const { open, url, base, isLocal, MANIFEST, ACTIVE_FILE, SPRJ, S, B, Q, CTX, CLOSED_ENTRY, CLOSED, fixtureTxt } = ctx;
  let p;

  // =============== independent checks of one sprint page state ===============
  async function verifySprint(page, Srows, f, label, c = CTX) {
    const e = M.expectSprint(Srows, f, c); const d = await run(page, READ_SPRINT); const errs = [];
    if (!eq(d.kpis.map(k => k.value), e.kpiValues)) errs.push(['kpi', d.kpis.map(k => k.value), e.kpiValues]);
    if (e.active && !/^of \d+/.test(d.kpis[0].hint)) errs.push(['kpi hint filtered', d.kpis[0].hint]);
    if (!e.active && d.kpis[0].hint !== UI.sprint.hints.itemsUnfiltered) errs.push(['kpi hint', d.kpis[0].hint]);
    if (d.kpis.length !== 8 || !eq(d.kpis.map(k => k.label), UI.sprint.kpis)) errs.push(['kpi labels', d.kpis.map(k => k.label)]);
    if (d.kpis[6].hint !== e.kpiHints.time) errs.push(['time hint', d.kpis[6].hint, e.kpiHints.time]);
    if (d.kpis[7].hint !== e.kpiHints.cycle) errs.push(['cycle hint', d.kpis[7].hint, e.kpiHints.cycle]);
    if (d.kpis[3].hint !== e.kpiHints.mid) errs.push(['mid hint', d.kpis[3].hint, e.kpiHints.mid]);
    if (d.kpis[4].hint !== e.kpiHints.carried) errs.push(['carried hint', d.kpis[4].hint, e.kpiHints.carried]);
    { const bd = await run(page, READ_BD), x = e.bd, BDT = UI.sprint.burndown;
      if (!e.all.length) { if (bd.has || bd.empty !== UI.sprint.empty) errs.push(['burndown empty-state', bd.has, bd.empty]); }
      else if (!bd.has) errs.push(['burndown svg missing', bd.empty]);
      else {
        if (!eq(bd.days.map(z => z.date), x.days.map(z => z.date))) errs.push(['burndown dates', bd.days.length, x.days.length]);
        else {
          x.days.forEach((xd, i) => { const g = bd.days[i];
            if ((xd.remaining === null) !== (g.remaining === null) || (xd.remaining !== null && Math.abs(g.remaining - xd.remaining) > 1e-6)) errs.push(['remaining', xd.date, g.remaining, xd.remaining]);
            if (Math.abs(g.ideal - xd.ideal) > 0.002) errs.push(['ideal', xd.date, g.ideal, xd.ideal]);
            if (g.done !== xd.done) errs.push(['done that day', xd.date, g.done, xd.done]);
            const wantTip = xd.remaining === null ? `${M.md(xd.date)}: ideal ${M.f1(xd.ideal)} points (future day)` : `${M.md(xd.date)}: ${xd.remaining} points remaining of ${xd.scope} in scope, ${xd.done} points done that day (${xd.cnt} tickets)`;
            if (g.tip !== wantTip) errs.push(['tooltip', g.tip, wantTip]); });
          // the visually hidden data table repeats the per-day figures for screen readers (C19)
          const dt = bd.dataTable;
          if (!dt || !dt.hidden || !eq(dt.hdr, BDT.dataTableHeaders) || dt.rows.length !== x.days.length || !x.days.every((xd, i) => dt.rows[i][1] === String(xd.scope) && dt.rows[i][2] === (xd.remaining === null ? '—' : String(xd.remaining))))
            errs.push(['burndown data table', dt && { hidden: dt.hidden, hdr: dt.hdr, n: dt.rows.length, first: dt.rows[0] }]);
        }
        const wantAdded = Object.keys(x.by).sort().map(k => [k, x.by[k].c, x.by[k].p]), gotAdded = bd.added.map(a => [a.date, a.count, a.points]).sort();
        if (!eq(gotAdded, wantAdded)) errs.push(['added markers', gotAdded, wantAdded]);
        { const bad = bd.added.filter(a => (a.date <= x.limit) !== (a.early === '1') || (a.date <= x.limit) !== (a.fill === '#ffffff')); if (bad.length) errs.push(['early (hollow) vs after-threshold (filled) markers', bad.map(a => [a.date, a.early, a.fill])]); if (!bd.legend.includes(BDT.legend.earlier)) errs.push(['legend Earlier']); }
        if (!bd.added.every(a => !/approximate/i.test(a.tip))) errs.push(['marker tooltip still labels added dates approximate']);
        { const wantR = Object.keys(x.rby || {}).sort().map(k => [k, x.rby[k].c, x.rby[k].p]), gotR = bd.removed.map(a => [a.date, a.count, a.points]).sort();
          if (!eq(gotR, wantR)) errs.push(['removed markers', gotR, wantR]);
          if (bd.legend.includes(BDT.legend.removed) !== (wantR.length > 0)) errs.push(['legend Removed', bd.legend]);
          if (wantR.length && !bd.removed.every(r => bd.dateLabelY - 9 >= r.labelY)) errs.push(['date labels touch the removal markers', bd.dateLabelY, bd.removed.map(r => r.labelY)]);
          if (!bd.removed.every(r => /removed/.test(r.tip))) errs.push(['removed tooltip']); }
        if (!bd.hasIdeal) errs.push(['ideal line missing']);
        if (bd.actualPoints !== x.ti + 1) errs.push(['actual line points', bd.actualPoints, x.ti + 1]);
        if (bd.todayLabel !== x.inside) errs.push(['today marker', bd.todayLabel, x.inside]);
        const cur = x.ti >= 0 ? x.days[x.ti] : null, when = c.closed || c.today > x.days[x.n - 1].date ? 'at sprint end' : 'today';
        const wantSub = cur ? `${cur.remaining} of ${cur.scope} points remaining ${when}, ideal ${M.f1(cur.ideal)}` : BDT.notStarted;
        if (bd.sub !== wantSub) errs.push(['burndown subtitle', bd.sub, wantSub]);
        if (cur && bd.label !== `Burndown chart for ${x.name || 'the sprint'}: ${wantSub}.`) errs.push(['aria-label', bd.label]);
        if (!bd.legend.includes(BDT.legend.scope)) errs.push(['legend scope', bd.legend]);
        { const want = x.days.slice(0, x.ti + 1).map(z => z.scope);
          if (!bd.scopeLine) errs.push(['scope line missing']);
          else if (bd.scopeLine.n !== 2 * want.length - 1) errs.push(['scope line point count', bd.scopeLine.n, 2 * want.length - 1]);
          else if (bd.scopeLine.vals && !eq(bd.scopeLine.vals, want.map(Math.round))) errs.push(['scope line steps', bd.scopeLine.vals, want]); }
        if (!bd.legend.includes(BDT.legend.added(c.thr)) || /approx/i.test(bd.legend)) errs.push(['legend threshold', bd.legend]);
        if (!bd.foot.includes(BDT.footStart) || (x.hasRemoved ? !bd.foot.includes(BDT.footRemoved) : !bd.foot.includes(BDT.footNoRemoved)) || /approx/i.test(bd.foot)) errs.push(['footnote', bd.foot]);
        if (x.unplaced && !bd.foot.includes(BDT.unplaced(x.unplaced))) errs.push(['unplaced note', bd.foot]);
        if (!x.unplaced && /no done date/.test(bd.foot)) errs.push(['unexpected unplaced note']);
        if (bd.bodyOv !== 'hidden') errs.push(['chart overflow', bd.bodyOv]);
      } }
    if (e.stBase.length) {
      M.BN.forEach(n => { const g = e.status[n] || { i: 0, p: 0 }; const got = d.status[n]; if (got === undefined) { if (n !== 'Other' || g.i) errs.push(['status row missing', n]); } else { if (got[0] !== g.i || got[1] !== g.p) errs.push(['status', n, got, [g.i, g.p]]); if (d.statusRaw[n] !== `${g.i} W.I | ${g.p} SP`) errs.push(['status metric format', n, d.statusRaw[n]]); } });
      if (d.statusFoot.replace(/\s+/g, '') !== `Total${e.stBase.length}W.I|${M.sumP(e.stBase)}SP`) errs.push(['status total', d.statusFoot]);
      const wantSel = [...f.status].sort(); if (!eq([...d.statusSel].sort(), wantSel)) errs.push(['status selected', d.statusSel, wantSel]);
      if (f.status.size ? !Object.keys(d.status).filter(n => !f.status.has(n)).every(n => d.statusDim.includes(n)) : d.statusDim.length) errs.push(['status dimming', d.statusDim]);
    } else if (!d.empties.status) errs.push(['status empty-state missing']);
    if (e.typeBase.length) {
      const names = Object.keys(e.types).sort((a, b) => e.types[b].i - e.types[a].i || a.localeCompare(b));
      const got = Object.keys(d.types);
      if (!eq(got, names)) errs.push(['type row order', got, names]);
      const iconTypes = new Set(['Story', 'Bug', 'Sub-Bug', 'Epic', 'Task', 'Sub-task', 'Initiative', 'Doc Task']);
      names.forEach(n => { const g = d.types[n], x = e.types[n], wantIcon = iconTypes.has(n) ? 'type:' + n : null; if (!g || g[0] !== x.i || g[1] !== x.p || d.typeRaw[n] !== `${x.i} W.I | ${x.p} SP`) errs.push(['type metrics', n, g, x, d.typeRaw[n]]); if (d.typeIcons[n] !== wantIcon) errs.push(['type icon', n, d.typeIcons[n], wantIcon]); });
      if (d.typeFoot.replace(/\s+/g, '') !== `Total${e.typeBase.length}W.I|${M.sumP(e.typeBase)}SP`) errs.push(['type total', d.typeFoot]);
    } else if (!d.empties.type) errs.push(['type empty-state missing']);
    { const xa = e.attention, ga = d.attention, AT = UI.sprint.attention;
      if (!e.all.length) { if (ga.empty !== UI.sprint.empty) errs.push(['attention empty-state', ga.empty]); }
      else {
        const got = ga.rows.map(r => [r.key, r.status, r.days, r.reasons]), want = xa.rows.map(r => [r.key, r.status, r.days, r.reasons]);
        if (!eq(got, want)) errs.push(['attention rows', got.length, want.length, got.filter((g, i) => !eq(g, want[i])).slice(0, 2), want.filter((w, i) => !eq(w, got[i])).slice(0, 2)]);
        if (xa.rows.length ? !eq(ga.hdr, AT.headers) : ga.empty !== AT.none) errs.push(['attention headers or none state', ga.hdr, ga.empty]);
        if (ga.foot !== xa.missing) errs.push(['attention missing line', ga.foot, xa.missing]);
        if (!ga.rows.every(r => r.links.length >= 1 && r.links.every(h => h.startsWith(UI.jiraBrowse)))) errs.push(['attention links']);
      }
      if (ga.sub !== AT.sub(xa.rows.length)) errs.push(['attention subtitle', ga.sub, AT.sub(xa.rows.length)]);
      // R001-02 condition 1 (public site): no person names and no blocker text in the panel
      const names = [...new Set(Srows.flatMap(t => [t.owner, t.tester]).filter(n => n != null && String(n).trim() !== '' && n !== 'Unassigned').map(String))];
      const leaked = names.filter(n => ga.text.includes(n)).concat(Srows.map(t => t.blocker).filter(b => b != null && String(b).trim().length >= 8).map(b => String(b).trim().slice(0, 24)).filter(b => ga.text.includes(b)));
      if (leaked.length) errs.push(['attention shows names or blocker text', leaked.slice(0, 3)]); }
    { const flat = o => { const out = {}; Object.keys(o).forEach(r => Object.keys(o[r]).forEach(cc => { out[r + '|' + cc] = o[r][cc]; })); return out; };
      const a = flat(d.matrix.o), b = flat(e.matrix);
      if (!Object.keys(b).length) { if (!d.empties.matrix) errs.push(['matrix empty-state missing']); }
      else {
        if (!eq(Object.keys(a).sort(), Object.keys(b).sort()) || Object.keys(b).some(k => a[k] !== b[k])) errs.push(['matrix cells', Object.keys(a).length, Object.keys(b).length]);
        // R001-17/18: Self-tested and Unassigned are the last two columns; Unassigned holds exactly the No tester & not self-tested tickets
        const cols = d.matrix.hdr.slice(1, -1), ST_COL = UI.sprint.matrix.selfTested, want = [ST_COL, 'Unassigned'].filter(cName => cols.includes(cName));
        if (!eq(cols.slice(cols.length - want.length), want)) errs.push(['matrix: Self-tested and Unassigned not last', cols]);
        if ((d.matrix.colTotals.Unassigned || 0) !== e.mBase.filter(M.noTester).length) errs.push(['matrix: Unassigned column total differs from no tester & not self-tested', d.matrix.colTotals.Unassigned, e.mBase.filter(M.noTester).length]);
        if (cols.includes(ST_COL) && d.matrix.titles[d.matrix.hdr.indexOf(ST_COL)] !== UI.sprint.matrix.selfTestedTitle) errs.push(['matrix: Self-tested tooltip', d.matrix.titles[d.matrix.hdr.indexOf(ST_COL)]]);
        if (cols.includes('Unassigned') && d.matrix.titles[d.matrix.hdr.indexOf('Unassigned')] !== UI.sprint.matrix.unassignedTitle) errs.push(['matrix: Unassigned tooltip', d.matrix.titles[d.matrix.hdr.indexOf('Unassigned')]]);
      } }
    if (!eq(d.detailKeys, e.detailKeys)) errs.push(['detail keys', d.detailKeys.length, e.detailKeys.length]);
    if (d.detailSub !== `${e.all.length} of ${Srows.length} work items`) errs.push(['detail sub', d.detailSub]);
    if (!e.all.length && !d.detailEmpty) errs.push(['detail empty-state missing']);
    const wantTags = []; Object.keys(f).forEach(dim => f[dim].forEach(v => wantTags.push(UI.sprint.tagLabels[dim] + ': ' + v))); if (e.searchTag) wantTags.push(e.searchTag);
    if (!eq([...d.tags].sort(), wantTags.sort())) errs.push(['tags', d.tags, wantTags]);
    if (d.resetDisabled !== !e.active) errs.push(['reset disabled', d.resetDisabled]);
    if (d.noFilterMsg !== !e.active) errs.push(['no-filter message', d.noFilterMsg]);
    check(label, errs.length === 0, errs.slice(0, 4));
    return { e, d };
  }

  // =============== independent checks of one backlog page state ===============
  async function verifyBacklog(page, Brows, f, query, label) {
    const sm = M.searchModel(query, 'backlog'), ps = { pred: sm ? sm.pred : null, tag: sm ? sm.tag : '' }; const all = M.applyF(Brows, f, M.BKEY, [], ps.pred); const d = await run(page, READ_BACKLOG); const errs = [];
    const active = Object.keys(f).some(k => f[k].size) || !!ps.pred;
    const days = all.map(t => t.days).filter(v => typeof v === 'number'); const med = M.median(days);
    const kv = [String(all.length), String(M.sumP(all)), String(all.filter(t => t.dor === 'Weak' || t.dor === 'Missing').length), String(all.filter(t => t.needsSplitting != null && String(t.needsSplitting).trim() !== '').length), med === null ? '—' : String(med)];
    if (!eq(d.kpis.map(k => k.value), kv)) errs.push(['kpi', d.kpis.map(k => k.value), kv]);
    for (const dim of ['dor', 'priority', 'type', 'age']) {
      const baseRows = M.applyF(Brows, f, M.BKEY, [dim], ps.pred); const cnt = {}; baseRows.forEach(t => { const v = M.BKEY[dim](t); cnt[v] = (cnt[v] || 0) + 1; });
      const got = d[dim];
      if (!baseRows.length) { if (!d.empties[dim]) errs.push([dim + ' empty-state missing']); continue; }
      Object.keys(got.o).forEach(k => { if (got.o[k] !== (cnt[k] || 0)) errs.push([dim, k, got.o[k], cnt[k] || 0]); });
      Object.keys(cnt).forEach(k => { if (got.o[k] === undefined) errs.push([dim + ' missing row', k]); });
      const want = [...f[dim]].filter(v => got.o[v] !== undefined).sort(); if (!eq([...got.sel].sort(), want)) errs.push([dim + ' selected', got.sel, want]);
      if (f[dim].size) { if (!got.order.filter(n => !f[dim].has(n)).every(n => got.dim.includes(n))) errs.push([dim + ' unselected not dimmed']); } else if (got.dim.length) errs.push([dim + ' dimmed w/o selection']);
    }
    { const baseRows = M.applyF(Brows, f, M.BKEY, ['dor', 'priority'], ps.pred); const mat = {}; baseRows.forEach(t => { const r = M.BKEY.priority(t), cc = M.BKEY.dor(t); (mat[r] = mat[r] || {})[cc] = ((mat[r] || {})[cc] || 0) + 1; });
      const flat = o => { const out = {}; Object.keys(o).forEach(r => Object.keys(o[r]).forEach(cc => { out[r + '|' + cc] = o[r][cc]; })); return out; }; const a = flat(d.matrix.o), b = flat(mat);
      if (!baseRows.length) { if (!d.empties.matrix) errs.push(['matrix empty-state missing']); } else if (!eq(Object.keys(a).sort(), Object.keys(b).sort()) || Object.keys(b).some(k => a[k] !== b[k])) errs.push(['matrix cells']); }
    if (!eq(d.keys, M.exactFirst(all, sm).map(t => t.ticket))) errs.push(['table keys', d.keys.length, all.length]);
    if (d.sub !== UI.backlog.sub(all.length, Brows.length)) errs.push(['table sub', d.sub]);
    if (!all.length && !d.tableEmpty) errs.push(['table empty-state missing']);
    const wantTags = []; Object.keys(f).forEach(dim => f[dim].forEach(v => wantTags.push(UI.backlog.tagLabels[dim] + ': ' + v))); if (ps.tag) wantTags.push(ps.tag);
    if (!eq([...d.tags].sort(), wantTags.sort())) errs.push(['tags', d.tags, wantTags]);
    if (d.resetDisabled !== !active) errs.push(['reset disabled', d.resetDisabled]);
    if (d.q !== query) errs.push(['input value', d.q, query]);
    check(label, errs.length === 0, errs.slice(0, 4));
    return { d, all };
  }

  // in-page contrast of text-bearing controls (heat cells, rows, attention reasons); ratio computed in Node
  const readContrast = async page => (await run(page, `return [...document.querySelectorAll('table.heat .cell, .rowbtn .name, .rowbtn .pair, .rowbtn .n, .reason')].map(n => ({ cls: n.className, text: n.textContent.trim().slice(0, 20), fg: rgbOf(getComputedStyle(n).color).slice(0, 3), bg: paintedBg(n), opacity: effOpacity(n), dimmed: !!n.closest('.is-dimmed') }))`))
    .map(r => Object.assign(r, { ratio: M.contrast(r.fg, r.bg) }));
  const lowContrast = list => list.filter(r => r.ratio < 4.5 || r.opacity < 0.999).map(r => [r.cls, r.text, Math.round(r.ratio * 100) / 100, r.opacity]);

  // =============== SPRINT ===============
  console.log('\n--- Sprint page (real data) ---');
  p = await open(base + 'index.html');
  check('Sprint: manifest and default snapshot return 200, no console errors/warnings, only localhost requests', p.resp[base + 'sprints.json'] === 200 && p.resp[base + ACTIVE_FILE] === 200 && p.logs.length === 0 && p.reqs.every(u => isLocal(u)), { resp: p.resp, logs: p.logs, reqs: p.reqs });
  check('Shell: sprint tabs, snapshot label and time, Jira live link, footer', await run(p, `const tabs=[...document.querySelectorAll('.tab')], live=document.querySelector('.live-dashboard-link'); return tabs.length===3 && T(tabs[0])===${q(UI.shell.tabs[0])} && tabs[0].classList.contains('active') && tabs[0].getAttribute('aria-current')==='page' && T(tabs[1])===${q(UI.shell.tabs[1])} && T(tabs[2])===${q(UI.shell.tabs[2])} && T(document.querySelector('.snapshot-badge'))===${q(UI.shell.badge)} && T(document.getElementById('asof'))===${q(asOfLabel(SPRJ))} && live && live.href===window.AF.jiraDashboardUrl && new URL(live.href).pathname===${q(UI.shell.liveDashboardPath)} && live.target==='_blank' && live.rel.includes('noopener') && ${UI.shell.liveText}.test(T(live)) && ${UI.shell.footer}.test(T(document.querySelector('.foot')))`));
  { const h = await run(p, `const h=[...document.querySelectorAll('h1')]; return h.map(x=>({text:T(x), hidden:x.classList.contains('visually-hidden') && x.getBoundingClientRect().width<=1}))`);
    check('Sprint: the page has exactly one h1 (visually hidden, read by screen readers)', h.length === 1 && h[0].text === UI.shell.h1.sprint && h[0].hidden, h); }
  { const a = await run(p, `const live=document.querySelector('.live-dashboard-link'), badges=[...document.querySelectorAll('.snapshot-badge, .live-dashboard-badge, .qi-partial, .qi-complete')]; return { fg: rgbOf(getComputedStyle(live).color).slice(0,3), bg: rgbOf(getComputedStyle(live).backgroundColor).slice(0,3), sizes: badges.map(b => parseFloat(getComputedStyle(b).fontSize)) }`);
    check('Contrast: the Jira dashboard · LIVE link text has at least 4.5:1 and every badge is at least 10px', M.contrast(a.fg, a.bg) >= 4.5 && a.sizes.every(s => s >= 10), { ratio: M.contrast(a.fg, a.bg), sizes: a.sizes }); }
  check('Colours: AF.COLORS (used for SVG and the heat ramp) equal their CSS custom properties in dashboard.css', await run(p, `const cs=getComputedStyle(document.documentElement); return Object.keys(AF.COLOR_TOKENS).every(k => cs.getPropertyValue(AF.COLOR_TOKENS[k]).trim().toLowerCase() === AF.COLORS[k].toLowerCase())`));
  check('AF.el accepts style only as an object and event handlers only as functions (CSP: no inline style or handler strings)', await run(p, `const throws = f => { try { f(); return false; } catch (e) { return true; } }; const d = AF.el('div', { style: { width: '10px' }, onclick: function () {} }); return d.style.width === '10px' && !d.hasAttribute('onclick') && throws(() => AF.el('div', { style: 'color:red' })) && throws(() => AF.el('div', { onclick: 'alert(1)' })) && throws(() => AF.el('div', { onmouseover: 'x' }))`));
  check('Sprint manifest: accessible selector defaults to current and lists sprint name and state without repeated dates', await run(p, `const s=document.getElementById('sprint-select'), opts=s&&[...s.options].map(o=>T(o)); return s && document.querySelector('label[for="sprint-select"]') && T(document.querySelector('label[for="sprint-select"]'))===${q(UI.shell.sprintSelectLabel)} && s.value===String(${MANIFEST.current}) && opts.some(x=>x===${q(MANIFEST.sprints.find(x => x.state === 'active').name + ' (active)')}) && (${!CLOSED_ENTRY} || opts.some(x=>x===${q(CLOSED_ENTRY ? CLOSED_ENTRY.name + ' (closed)' : '')})) && document.getElementById('sprint-banner').hidden`));
  const sprintJsonRequests = () => p.reqs.filter(u => u.endsWith('.json'));
  check('Sprint manifest: initial load requests only the manifest and current snapshot', sprintJsonRequests().length === 2 && sprintJsonRequests().some(u => u.endsWith('/sprints.json')) && sprintJsonRequests().some(u => u.endsWith('/' + ACTIVE_FILE)), p.reqs);
  { const SR = await run(p, SCROLL_REGIONS);
    check('Scroll regions: a tile body is a focusable, labelled region (tabindex 0, role region, aria-label) exactly when it scrolls; others add no tab stop', SR.every(r => r.scrolls ? r.tabindex === '0' && r.role === 'region' && !!r.label : r.tabindex === null && r.role === null) && SR.some(r => r.scrolls) && SR.some(r => !r.scrolls), SR); }
  if (CLOSED_ENTRY) {
    const CID = String(CLOSED_ENTRY.id);
    await run(p, `window.__sprintSessionProbe='kept'; clickRow(${q(ST.status)},'Done'); setSel('sprint-select',${q(CID)})`);
    for (let i = 0; i < 40 && !(await run(p, `!!document.querySelector('.kpis') && document.getElementById('sprint-select').value===${q(CID)}`).catch(() => false)); i++) await sleep(100);
    const closedView = await run(p, `const det=tile(${q(ST.detail)}), hdr=[...det.querySelectorAll('thead th')].map(T), rows=[...det.querySelectorAll('tbody tr')]; const ix=n=>hdr.indexOf(n), byKey=k=>{const r=rows.find(x=>T(x.children[0])===k);return r?{owner:T(r.children[ix('Owner')]),points:T(r.children[ix('Story points')])}:null}; const k=kpi(${q(UI.sprint.kpi.carried)}),b=tile(${q(ST.burndown)}),svg=b.querySelector('svg.burndown'); return {url:location.search,probe:window.__sprintSessionProbe,selected:document.getElementById('sprint-select').value,count:rows.length,work:T(kpi('Work items').querySelector('.value')),closed:!document.getElementById('sprint-banner').hidden,historical:document.querySelector('.app').classList.contains('historical-sprint'),banner:T(document.getElementById('sprint-banner')),carried:[T(k.querySelector('.value')),T(k.querySelector('.hint'))],tags:document.querySelectorAll('.tags .tag').length,rowsNullSituation:rows.every(r=>T(r.children[ix('Last sync update')])==='—'),noToday:![...svg.querySelectorAll('text')].some(x=>T(x)==='Today'),days:svg.querySelectorAll('rect.bd-day').length,unassigned:${q((CLOSED.tickets.find(t => M.grpName(t.owner) === 'Unassigned') || {}).ticket || null)} && byKey(${q((CLOSED.tickets.find(t => M.grpName(t.owner) === 'Unassigned') || {}).ticket || '')}),nullPoints:rows.filter(r=>T(r.children[ix('Story points')])==='—').length,note:document.querySelector('.sprint-banner-note')&&T(document.querySelector('.sprint-banner-note')),foot:T(b.querySelector('.tile-foot'))};`);
    const co = CLOSED.sprint.carriedOver;
    const wantCarried = co ? [co.count == null ? '—' : String(co.count), [co.percent != null ? co.percent + '% of tickets' : null, co.storyPoints != null ? co.storyPoints + ' points' : null].filter(Boolean).join(', ') || UI.sprint.hints.carriedNoFigures] : ['—', UI.sprint.hints.carriedNull];
    const wantDays = M.dn(CLOSED.sprint.endDate) - M.dn(CLOSED.sprint.startDate) + 1;
    const wantFoot = Array.isArray(CLOSED.sprint.removed) ? UI.sprint.burndown.footRemoved : UI.sprint.burndown.footNoRemoved;
    check(`Closed sprint: selection uses SPA navigation, updates the URL, resets filters and loads all ${CLOSED.tickets.length} tickets of sprint ${CID}`, closedView.url === '?sprint=' + CID && closedView.probe === 'kept' && closedView.selected === CID && closedView.count === CLOSED.tickets.length && closedView.work === String(CLOSED.tickets.length) && closedView.tags === 0 && closedView.closed, closedView);
    check('Closed sprint: historical banner and gray view, snapshot date and note, carried over as exported, narratives as exported and no Today marker', closedView.banner.includes(UI.sprint.closed.banner) && closedView.banner.includes(UI.sprint.closed.asOf + asOfLabel(CLOSED).replace(/^Data as of /, '')) && closedView.historical && closedView.note === (CLOSED_ENTRY.note || null) && eq(closedView.carried, wantCarried) && closedView.rowsNullSituation === CLOSED.tickets.every(t => !t.lastSyncUpdate) && closedView.noToday && closedView.days === wantDays && closedView.foot.includes(wantFoot), { closedView, wantCarried, wantDays });
    check('Closed sprint: a null owner displays Unassigned and every null point value displays —', (closedView.unassigned === null || closedView.unassigned.owner === 'Unassigned') && closedView.nullPoints === CLOSED.tickets.filter(t => t.points == null).length, { unassigned: closedView.unassigned, nullPoints: closedView.nullPoints });
    await verifySprint(p, CLOSED.tickets, M.newF(), 'Closed sprint: every tile and the burndown (through sprint end) equal the independent calculation', { sprint: CLOSED.sprint, today: CLOSED.refreshedAt, thr: 1, closed: true });
    await p.screenshot(path.join(SP, 'sprint_closed_1920.png'));
    await p.resize(480, 900);
    { const l = await run(p, LAYOUT), pick = await run(p, `const s=document.getElementById('sprint-select').getBoundingClientRect(); return {select:[s.left,s.right,s.width]}`); await p.screenshot(path.join(SP, 'sprint_closed_480.png')); check('Closed sprint: selector remains visible at narrow width without page-level horizontal overflow', pick.select[2] > 0 && l.sw <= l.iw && l.bad.length === 0, { scrollWidth: l.sw, innerWidth: l.iw, bad: l.bad, picker: pick }); }
    await p.resize(1920, 1080);
    await run(p, `setSel('sprint-select','${MANIFEST.current}')`);
    for (let i = 0; i < 40 && !(await run(p, `!!document.querySelector('.kpis') && document.getElementById('sprint-select').value==='${MANIFEST.current}'`).catch(() => false)); i++) await sleep(100);
    const returned = await run(p, `return {banner:document.getElementById('sprint-banner').hidden,tags:document.querySelectorAll('.tags .tag').length,selector:document.getElementById('sprint-select').value}`);
    check('Sprint selector: switching back reuses cached snapshots and restores the active sprint without a banner or filters', p.reqs.filter(u => u.endsWith('/' + ACTIVE_FILE)).length === 1 && p.reqs.filter(u => u.endsWith('/' + CLOSED_ENTRY.file)).length === 1 && p.reqs.filter(u => u.endsWith('/sprints.json')).length === 1 && returned.banner && returned.tags === 0 && returned.selector === String(MANIFEST.current), { requests: p.reqs, returned });
    // C2: no ResizeObserver is left drawing into a detached chart after sprint switches
    await run(p, `window.__detachedDraws = 0; const orig = AF.drawBurndown; AF.drawBurndown = function (c) { if (!document.contains(c)) window.__detachedDraws++; return orig.apply(this, arguments); }`);
    for (const id of [CID, String(MANIFEST.current), CID, String(MANIFEST.current)]) { await run(p, `setSel('sprint-select', ${q(id)})`); await sleep(400); }
    await p.resize(1500, 900); await p.resize(1920, 1080); await sleep(300);
    check('Sprint switch: the previous burndown ResizeObserver is disconnected (no redraw into a detached chart after four switches and two resizes)', (await run(p, `return window.__detachedDraws`)) === 0, await run(p, `return window.__detachedDraws`));
    await p.close();
    // C2: a slow response for an earlier selection never replaces the later one
    p = await open(base + 'index.html');
    await run(p, `setSel('sprint-select', ${q(CID)}); setSel('sprint-select', ${q(String(MANIFEST.current))})`);
    await sleep(1200);
    { const r = await run(p, `return { selected: document.getElementById('sprint-select').value, url: location.search, banner: document.getElementById('sprint-banner').hidden, historical: document.querySelector('.app').classList.contains('historical-sprint'), rows: tile(${q(ST.detail)}).querySelectorAll('tbody tr').length }`);
      check('Sprint switch race: choosing a closed sprint and then the active one shows the active one, even though the closed snapshot arrives last', r.selected === String(MANIFEST.current) && r.url === '?sprint=' + MANIFEST.current && r.banner && !r.historical && r.rows === S.length, r); }
    await p.close();
    p = await open(base + 'index.html');
  } else skip('Closed sprint checks', 'the manifest lists no closed sprint');
  let unknown = await open(base + 'index.html?sprint=999999');
  const unknownState = await run(unknown, `return {heading:T(document.querySelector('#app h2')),picker:!!document.getElementById('sprint-select'),options:document.getElementById('sprint-select')&&document.getElementById('sprint-select').options.length}`);
  check('Unknown sprint id: clear error and usable selector remain visible', unknownState.heading === UI.sprint.sprintNotFound && unknownState.picker && unknownState.options === MANIFEST.sprints.length + 1, unknownState);
  await run(unknown, `setSel('sprint-select','${MANIFEST.current}')`);
  for (let i = 0; i < 40 && !(await run(unknown, `!!document.querySelector('.kpis')`).catch(() => false)); i++) await sleep(100);
  const recovered = await run(unknown, `return {kpis:!!document.querySelector('.kpis'),value:document.getElementById('sprint-select').value,search:location.search}`);
  check('Unknown sprint id: choosing a valid option recovers', recovered.kpis && recovered.value === String(MANIFEST.current) && recovered.search === '?sprint=' + MANIFEST.current, recovered);
  await unknown.close();
  if (CLOSED_ENTRY) {
    const direct = await open(base + 'index.html?sprint=' + CLOSED_ENTRY.id);
    const directState = await run(direct, `return {selected:document.getElementById('sprint-select').value,count:tile(${q(ST.detail)}).querySelectorAll('tbody tr').length,banner:!document.getElementById('sprint-banner').hidden}`);
    check(`Direct URL: ?sprint=${CLOSED_ENTRY.id} opens the closed snapshot from the manifest`, directState.selected === String(CLOSED_ENTRY.id) && directState.count === CLOSED.tickets.length && directState.banner && direct.reqs.filter(u => u.endsWith('.json')).length === 2 && direct.reqs.some(u => u.endsWith('/sprints.json')) && direct.reqs.some(u => u.endsWith('/' + CLOSED_ENTRY.file)), { state: directState, requests: direct.reqs });
    await direct.close();
  }
  for (const [variantName, desc, extraRe] of [['noManifest', 'missing', null], ['badManifest', 'invalid', null], ['manifestBadFile', 'pointing at a file outside snapshots/sprint-<id>.json', UI.errors.invalidManifest]]) {
    const errPage = await open(url[variantName] + 'index.html');
    const state = await run(errPage, `return {selector:!!document.getElementById('sprint-select'),rows:document.querySelectorAll('#app .lower .data tbody tr').length,text:document.getElementById('app').innerText}`);
    check(`Manifest ${desc}: the page shows a clear error about sprints.json (no fallback), no selector, no JS exception`, !state.selector && state.rows === 0 && UI.errors.cantLoad('sprints.json').test(state.text) && (!extraRe || extraRe.test(state.text)) && !errPage.logs.some(l => l.startsWith('exception')) && (variantName !== 'manifestBadFile' || !errPage.reqs.some(u => u.endsWith('/backlog.json'))), { state: { selector: state.selector, rows: state.rows, text: state.text.slice(0, 200) }, logs: errPage.logs, reqs: errPage.reqs });
    await errPage.close();
  }
  { const pe = await open(url.manifestExtra + 'index.html');
    const r = await run(pe, `return { kpis: !!document.querySelector('.kpis'), select: document.getElementById('sprint-select') && document.getElementById('sprint-select').value }`);
    check('Manifest with unknown extra keys (top level and entry): tolerated, the sprint loads normally', r.kpis && r.select === String(SP_OK.id) && pe.logs.length === 0, { r, logs: pe.logs });
    await pe.close(); }
  { const pm = await open(url.mismatch + 'index.html');
    const txt = await run(pm, `return document.getElementById('app').innerText`);
    check('Snapshot that does not match its manifest entry: the error says so (not "missing or not valid JSON")', UI.errors.cantLoad('snapshots/sprint-1.json').test(txt) && UI.errors.mismatch.test(txt) && !/not valid JSON/.test(txt), txt.slice(0, 240));
    await pm.close(); }

  let f = M.newF();
  await verifySprint(p, S, f, 'Sprint: no filters, every tile = independent calculation');
  check('Sprint page (R001-19): the filter bar has the search box and no dropdown filters (no Fix version, Parent, Status, Type, Assignee or Tester select); the Sprint selector stays', await run(p, `const bar=document.getElementById('filterbar'); return !!bar.querySelector('input#q') && bar.querySelectorAll('select').length === 0 && !document.getElementById('f-fix') && !document.getElementById('f-parent') && document.querySelectorAll('select').length === 1 && !!document.getElementById('sprint-select')`));
  { const typeName = Object.keys(M.expectSprint(S, f, CTX).types)[0];
    await run(p, `clickRow(${q(ST.type)}, ${q(typeName)})`); f.type = new Set([typeName]);
    await verifySprint(p, S, f, `Click Type "${typeName}": filters the dashboard and preserves the type distribution`);
    await run(p, `clickReset()`); f = M.newF();
    await verifySprint(p, S, f, 'Reset all clears the Type selection'); }
  const noTesterKeys = S.filter(M.noTester).map(t => t.ticket);
  const noTesterKpi = await run(p, `const k=kpi(${q(UI.sprint.kpi.noTester)}); return {value:T(k.querySelector('.value')), hint:T(k.querySelector('.hint'))}`);
  check('No tester & not self-tested KPI excludes exact Dev to Test and QA to Test classifications', noTesterKpi.value === String(noTesterKeys.length) && noTesterKpi.hint.startsWith(UI.sprint.hints.noTesterPrefix), { count: noTesterKeys.length, hint: noTesterKpi.hint });
  const detailKeys = () => run(p, `return [...tile(${q(ST.detail)}).querySelectorAll('tbody tr')].map(tr=>T(tr.children[0]))`);
  { const tisKeys = S.filter(M.longRunning).map(t => t.ticket);
    await run(p, `clickReset()`);
    await run(p, `clickEl(kpi(${q(UI.sprint.kpi.time)}))`);
    const got = await detailKeys();
    const hdr = await run(p, `return [...tile(${q(ST.detail)}).querySelectorAll('thead th')].map(T)`);
    const tags = await run(p, `return readCommon().tags`);
    check('Click Long-running work lists exactly the In Progress / In Review tickets with 7 or more days, adds the KPI tag, and the table has a Days in status column', eq([...got].sort(), [...tisKeys].sort()) && hdr.includes('Days in status') && eq(tags, [UI.sprint.kpiTag(UI.sprint.kpi.time)]), { expected: tisKeys, got, tags });
    await run(p, `clickReset()`); }
  await run(p, `clickEl(kpi(${q(UI.sprint.kpi.noTester)}))`);
  let lowerKeys = await detailKeys();
  const resetEnabled = await run(p, `return !document.querySelector('.resetall').disabled`);
  check('Click No tester & not self-tested filters the lower section to matching tickets and activates Reset all', eq([...lowerKeys].sort(), [...noTesterKeys].sort()) && resetEnabled, { expected: noTesterKeys.length, actual: lowerKeys.length, resetEnabled });
  { // removing the KPI tag clears only the KPI filter and keeps a regular filter
    await run(p, `clickRow(${q(ST.status)}, 'Done')`);
    const tags = await run(p, `return readCommon().tags`);
    await run(p, `clickTagX(${tags.indexOf(UI.sprint.kpiTag(UI.sprint.kpi.noTester))})`);
    const after = await run(p, `return { tags: readCommon().tags, selected: kpi(${q(UI.sprint.kpi.noTester)}).classList.contains('is-selected'), pressed: kpi(${q(UI.sprint.kpi.noTester)}).getAttribute('aria-pressed') }`);
    check('Removing the KPI tag clears only the KPI filter and keeps the regular Status filter', eq(after.tags, ['Status: Done']) && !after.selected && after.pressed === 'false' && eq(await detailKeys(), S.filter(t => t.status === 'Done').map(t => t.ticket)), after);
    await run(p, `clickEl(kpi(${q(UI.sprint.kpi.noTester)}))`); }
  await run(p, `clickReset()`);
  lowerKeys = await detailKeys();
  const noTesterSelected = await run(p, `return kpi(${q(UI.sprint.kpi.noTester)}).classList.contains('is-selected')`);
  check('Reset all clears the KPI filter and restores the lower section', lowerKeys.length === S.length && !noTesterSelected, lowerKeys.length);
  const carriedKeys = SPRJ.sprint.carriedOver && Array.isArray(SPRJ.sprint.carriedOver.ticketKeys) ? SPRJ.sprint.carriedOver.ticketKeys : null;
  if (carriedKeys) {
    await run(p, `clickEl(kpi(${q(UI.sprint.kpi.carried)}))`);
    lowerKeys = await detailKeys();
    check('Click Carried Over filters the lower section to exactly the exported carried-over keys (keys never exceed sprint.carriedOver.count; fewer is allowed when a carried ticket left the sprint)', carriedKeys.length <= SPRJ.sprint.carriedOver.count && eq([...lowerKeys].sort(), [...carriedKeys].filter(k => S.some(t => t.ticket === k)).sort()), { expected: carriedKeys, actual: lowerKeys });
    await run(p, `clickEl(kpi(${q(UI.sprint.kpi.carried)}))`);
  } else {
    const k = await run(p, `const k=kpi(${q(UI.sprint.kpi.carried)}); return { clickable: k.classList.contains('clickable'), role: k.getAttribute('role'), pressed: k.getAttribute('aria-pressed') }`);
    check('Carried Over KPI (real data has no carriedOver.ticketKeys): shown, not clickable, no button role or aria-pressed', !k.clickable && k.role === null && k.pressed === null, k);
  }
  check('Non-clickable KPI tiles carry no button role or aria-pressed', await run(p, `return [...document.querySelectorAll('.kpi:not(.clickable)')].every(k => !k.hasAttribute('role') && !k.hasAttribute('aria-pressed') && !k.hasAttribute('tabindex'))`));
  await verifySprint(p, S, f, 'KPI filters clear on second click');
  const L = await run(p, LAYOUT);
  check('Layout 1920x1080: no page scroll (width and height)', L.sh <= L.ih && L.sw <= L.iw, L);
  check('Layout 1920x1080: 8 KPI + 4 main + 2 lower tiles; board fills the width (right edge within 16px), equal gutters', L.tiles.length === 14 && Math.max(...L.tiles.map(t => t.r)) >= L.iw - 16 && Math.min(...L.tiles.map(t => t.l)) <= 16, L.tiles);
  check('Layout 1920x1080: tiles fill the height (bottom of detail tile within 60px of the viewport bottom)', Math.max(...L.tiles.map(t => t.b)) >= L.ih - 60, Math.max(...L.tiles.map(t => t.b)));
  check('Layout: main-row tiles share one height; lower-row tiles share one height and together span the width; heat grid is about 28% wide', new Set(L.tiles.slice(8, 12).map(t => t.h)).size === 1 && new Set(L.tiles.slice(12, 14).map(t => t.h)).size === 1 && L.tiles[12].w + L.tiles[13].w + 10 >= L.iw - 30 && L.tiles[13].w >= 440 && L.tiles[13].w <= 0.32 * L.iw, L.tiles.slice(8));
  const rowRatio = L.tiles[8].h / L.tiles[12].h;
  check('Layout: 15% of former main-row height transferred to the lower row', Math.abs(rowRatio - 1.1475 / 1.2025) < 0.02, { rowRatio, expected: 1.1475 / 1.2025 });
  check('Layout: main row is Burndown, Tickets by status, Tickets by type, Needs attention today; lower row is Ticket detail then Assignee x tester', eq(L.tiles.slice(8).map(t => t.title), UI.sprint.mainRow.concat(UI.sprint.lowerRow)) && L.tiles[9].w >= 250 && L.tiles[10].w >= 250, L.tiles.slice(8).map(t => t.title + ' ' + t.w));
  check('Tile bodies scroll inside (overflow auto), assignee list overflows', L.bodies.every(b => b.ov === 'auto' || b.ov === 'hidden') && L.bodies.some(b => b.sh > b.ch), L.bodies);
  const st = await run(p, `const out={}; for (const [k,t] of [['attention',${q(ST.attention)}],['detail',${q(ST.detail)}],['matrix',${q(ST.matrix)}]]) { const b=tile(t).querySelector('.tile-body'); const th=b.querySelector('thead th'); b.scrollTop=120; const br=b.getBoundingClientRect(); out[k]={scrolls:b.scrollHeight>b.clientHeight, sb:b.offsetWidth-b.clientWidth, thSticky: th?getComputedStyle(th).position:null, thDiff: th?Math.round(th.getBoundingClientRect().top-br.top):null}; if(k==='detail'){const owner=b.querySelector('td.owner'), tester=b.querySelector('td.tester'), status=b.querySelector('td.status'), cell=b.querySelector('td.current-situation'); out[k].ownerWrap=owner?getComputedStyle(owner).whiteSpace==='normal':false; out[k].testerWrap=tester?getComputedStyle(tester).whiteSpace==='normal':false; out[k].statusWrap=status?getComputedStyle(status).whiteSpace==='normal':false; out[k].ownerMaxWidth=owner?getComputedStyle(owner).maxWidth:null; out[k].situationWidth=cell?Math.round(cell.getBoundingClientRect().width):0; out[k].horizontal=b.scrollWidth>b.clientWidth; b.scrollLeft=b.scrollWidth; out[k].horizontalWorks=b.scrollLeft>0; b.scrollLeft=0;} b.scrollTop=0;} const ft=tile(${q(ST.attention)}).querySelector('.tile-foot'); out.footVisible = ft.getBoundingClientRect().bottom <= tile(${q(ST.attention)}).getBoundingClientRect().bottom+1 && T(ft).startsWith('Missing:'); return out;`);
  check('Sticky headers, visible scrollbars, wrapping Owner/Tester/Status cells, Last sync update at least 350 px wide with horizontal scroll, Missing line pinned under Needs attention today', (!st.attention.scrolls || (st.attention.sb > 0 && st.attention.thSticky === 'sticky' && Math.abs(st.attention.thDiff) <= 2)) && st.detail.thSticky === 'sticky' && Math.abs(st.detail.thDiff) <= 2 && st.detail.ownerWrap && st.detail.testerWrap && st.detail.statusWrap && st.detail.ownerMaxWidth === 'none' && st.detail.situationWidth >= 350 && st.detail.horizontal && st.detail.horizontalWorks && st.matrix.thSticky === 'sticky' && Math.abs(st.matrix.thDiff) <= 2 && st.footVisible, st);
  { const ex = M.expectSprint(S, M.newF(), CTX).attention, A = UI.sprint.attention.reasons;
    check('Needs attention today (real data): rows equal the independent calculation (not Done; long-running, carried over, blocked by a ticket not Done, or blocker recorded), most days first; no names or blocker text (checked in every sprint state)', (await run(p, READ_SPRINT)).attention.rows.length === ex.rows.length, ex.rows.length);
    const doneBlockers = S.filter(t => M.bucket(t.status) !== 3).flatMap(t => [...String(t.linkedWorkItems || '').matchAll(/\b([A-Z][A-Z0-9]+-[0-9]+) \(is blocked by\)/g)].map(m => [t.ticket, m[1]])).filter(([, k]) => S.some(x => x.ticket === k && M.bucket(x.status) === 3));
    if (doneBlockers.length) check(`Needs attention today: "is blocked by" links to a Done ticket are ignored (${doneBlockers.map(x => x.join(' by ')).join(', ')})`, doneBlockers.every(([key, b]) => !(ex.rows.find(r => r.key === key) || { reasons: [] }).reasons.includes(A.blocked(b))) && !(await run(p, `return T(tile(${q(ST.attention)}))`)).includes(doneBlockers.map(([, b]) => A.blocked(b))[0]), doneBlockers);
    else skip('Needs attention today: blocked-by link to a Done ticket (real data)', 'no such link in the active sprint; covered by the hand-made attention data'); }

  const typeGroups = M.group(S, M.SKEY.type);
  const typeNames = Object.keys(typeGroups).sort((a, b) => typeGroups[b].i - typeGroups[a].i || a.localeCompare(b));
  if (typeNames.length >= 3) {
    const [pick, pick2, pick3] = typeNames;
    await run(p, `clickRow(${q(ST.type)}, ${q(pick)})`); f.type = new Set([pick]);
    await verifySprint(p, S, f, `Click Type "${pick}": filters ticket detail and other tiles`);
    await run(p, `clickRow(${q(ST.type)}, ${q(pick)})`); f.type = new Set();
    await verifySprint(p, S, f, 'Click the same type again: cleared');
    await run(p, `clickRow(${q(ST.type)}, ${q(pick)})`); await run(p, `clickRow(${q(ST.type)}, ${q(pick2)})`); f.type = new Set([pick2]);
    await verifySprint(p, S, f, 'Plain click on another type replaces the selection');
    await run(p, `clickRow(${q(ST.type)}, ${q(pick3)}, {ctrl:true})`); f.type.add(pick3);
    await verifySprint(p, S, f, 'Ctrl+click adds a second type (OR within dimension)');
    await run(p, `clickRow(${q(ST.type)}, ${q(pick3)}, {meta:true})`); f.type.delete(pick3);
    await verifySprint(p, S, f, 'Cmd+click toggles a value off');
    await run(p, `clickRow(${q(ST.type)}, ${q(pick)}, {shift:true})`); f.type.add(pick);
    await verifySprint(p, S, f, 'Shift+click also multi-selects');
    await run(p, `clickReset()`); f = M.newF();
    await verifySprint(p, S, f, 'Reset all clears everything; Reset is disabled again');
  } else skip('Click, replace and multi-select checks on Type rows', 'the active sprint has fewer than three types');
  // Self-tested cell (R001-17, R001-18): the assignee's tickets they test themselves (Dev to Test or QA to Test without a tester, or tester = assignee)
  { const mm = M.expectSprint(S, M.newF(), CTX).matrix, STC = UI.sprint.matrix.selfTested;
    const rowsWith = Object.keys(mm).filter(r => mm[r][STC]).sort((a, b) => mm[b][STC] - mm[a][STC] || a.localeCompare(b));
    if (rowsWith.length) {
      const who = rowsWith[0];
      await run(p, `clickCell(${q(ST.matrix)}, ${q(who)}, ${q(STC)})`); f.assignee = new Set([who]); f.tester = new Set([STC]);
      const r = await verifySprint(p, S, f, `Matrix cell "${who} / Self-tested" filters to that assignee's self-tested tickets; the tag reads "Tester: Self-tested"`);
      const direct = S.filter(t => M.grpName(t.owner) === who && ((M.grpName(t.tester) === 'Unassigned' && M.selfTestClass(t)) || (M.grpName(t.tester) !== 'Unassigned' && M.grpName(t.tester) === who))).map(t => t.ticket).sort();
      check('Self-tested cell equals the direct count (Dev to Test or QA to Test with no tester, or tester = assignee), and a ticket with one of those classifications and another tester stays under that tester', eq([...r.d.detailKeys].sort(), direct) && S.filter(t => M.selfTestClass(t) && M.grpName(t.tester) !== 'Unassigned' && M.grpName(t.tester) !== M.grpName(t.owner)).every(t => M.testerGroup(t) === M.grpName(t.tester)), { got: r.d.detailKeys.length, direct: direct.length });
      await run(p, `clickReset()`); f = M.newF(); await verifySprint(p, S, f, 'Reset all clears the Self-tested cell');
    } else skip('Self-tested matrix cell', 'no self-tested tickets in the active sprint'); }

  // AND across dimensions: status In Review, then the biggest assignee x tester cell among the In Review tickets
  await run(p, `clickRow(${q(ST.status)}, 'In Review')`); f.status = new Set(['In Review']);
  await verifySprint(p, S, f, 'Click status "In Review"');
  { const mm = M.expectSprint(S, f, CTX).matrix, cells = [];
    Object.keys(mm).forEach(r => Object.keys(mm[r]).forEach(cc => cells.push([r, cc, mm[r][cc]])));
    cells.sort((a, b) => b[2] - a[2] || a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
    const [rA, cT] = cells[0];
    await run(p, `clickCell(${q(ST.matrix)}, ${q(rA)}, ${q(cT)})`); f.assignee = new Set([rA]); f.tester = new Set([cT]);
    await verifySprint(p, S, f, `Click matrix cell "${rA} / ${cT}" on top: In Review tickets with that pair (AND)`);
    const exp1 = M.expectSprint(S, f, CTX);
    check(`That combination equals the In Review tickets with assignee ${rA} and tester column ${cT} (direct count)`, exp1.all.length === S.filter(t => t.status === 'In Review' && M.grpName(t.owner) === rA && M.testerGroup(t) === cT).length, exp1.all.length); }
  await run(p, `clickRow(${q(ST.status)}, 'Done')`); f.status.add('Done');
  await verifySprint(p, S, f, 'Plain click adds Done: status OR, still AND assignee and tester');
  { const c = await readContrast(p);
    check('Contrast: with a selection active, every row, count and attention reason (dimmed or not) keeps text at full opacity and at least 4.5:1', lowContrast(c).length === 0 && c.some(r => r.dimmed), lowContrast(c).slice(0, 6)); }
  await run(p, `clickRow(${q(ST.status)}, 'In Review')`); f.status.delete('In Review');
  await verifySprint(p, S, f, 'Plain click clears one selected status while retaining the other');
  await run(p, `clickTagX(0)`); const firstTag = [...f.status][0]; f.status.delete(firstTag);
  await verifySprint(p, S, f, 'Tag × removes only that one value');
  await run(p, `clickReset()`); f = M.newF();

  // matrix cell: the pair with the most tickets
  { const mm = M.expectSprint(S, M.newF(), CTX).matrix;
    const cells = []; Object.keys(mm).forEach(r => Object.keys(mm[r]).forEach(cc => cells.push([r, cc, mm[r][cc]])));
    cells.sort((a, b) => b[2] - a[2] || a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
    const [rA, cT, nA] = cells[0];
    { const c = await readContrast(p); check('Contrast: every heat-grid cell uses ink text at full opacity with at least 4.5:1 against its shade', lowContrast(c.filter(r => /\bcell\b/.test(r.cls))).length === 0 && c.some(r => /\bcell\b/.test(r.cls)), lowContrast(c).slice(0, 6)); }
    await run(p, `clickCell(${q(ST.matrix)}, ${q(rA)}, ${q(cT)})`); f.assignee = new Set([rA]); f.tester = new Set([cT]);
    const r1 = await verifySprint(p, S, f, `Matrix cell "${rA} / ${cT}" sets both assignee and tester`);
    check('Matrix cell shows the highlighted state and the pair count equals the detail row count', r1.d.matrix.sel.length === 1 && r1.d.detailKeys.length === nA, { sel: r1.d.matrix.sel, n: r1.d.detailKeys.length });
    { const c = await readContrast(p); const cellsC = c.filter(r => /\bcell\b/.test(r.cls));
      check('Contrast: dimmed heat-grid cells (outside the selection) keep their text at full opacity with at least 4.5:1', lowContrast(cellsC).length === 0 && (cellsC.length < 2 || cellsC.some(r => r.dimmed)), lowContrast(cellsC).slice(0, 6)); }
    await run(p, `clickCell(${q(ST.matrix)}, ${q(rA)}, ${q(cT)})`); f.assignee = new Set(); f.tester = new Set();
    await verifySprint(p, S, f, 'Clicking the same matrix cell again clears both'); }
  // zero results: a status tile and a search that excludes it
  { let zero = null;
    for (const sName of M.BN) { if (!S.some(t => M.BN[M.bucket(t.status)] === sName)) continue;
      const other = S.find(t => M.BN[M.bucket(t.status)] !== sName && /^[A-Z][A-Z0-9]+-\d+$/.test(t.ticket));
      if (other && !S.filter(M.searchModel(other.ticket, 'sprint').pred).some(t => M.BN[M.bucket(t.status)] === sName)) { zero = [sName, other.ticket]; break; } }
    if (zero) {
      await run(p, `clickRow(${q(ST.status)}, ${q(zero[0])})`); await run(p, `setQ(${q(zero[1])})`); f.status = new Set([zero[0]]);
      const z = await verifySprint(p, S, f, `Zero results (status ${zero[0]} + search "${zero[1]}"): KPIs 0, empty-state in tiles and table, no errors`, Object.assign({}, CTX, { q: zero[1] }));
      check('Zero results: KPIs show 0 and the empty-state text is the specified sentence', z.d.kpis[0].value === '0' && z.d.detailEmpty === UI.sprint.empty && z.d.empties.attention === z.d.detailEmpty, z.d.detailEmpty);
      await run(p, `clickReset()`); f = M.newF();
    } else check('Zero results case available in data', false, 'no empty combination'); }
  // scroll position kept (Ticket detail; filter by the most common type)
  await run(p, `tile(${q(ST.detail)}).querySelector('.tile-body').scrollTop = 150`);
  await run(p, `clickRow(${q(ST.type)}, ${q(typeNames[0])})`); f.type = new Set([typeNames[0]]);
  { const kept = await run(p, `const b=tile(${q(ST.detail)}).querySelector('.tile-body'); return {top: b.scrollTop, max: b.scrollHeight - b.clientHeight}`);
    if (kept.max >= 150) check('Scroll position inside a tile is kept when a filter changes', kept.top >= 100, kept);
    else skip('Scroll position kept', 'the filtered detail table is too short to scroll 150 px'); }
  await run(p, `clickReset()`); f = M.newF();
  // keyboard
  await run(p, `document.activeElement && document.activeElement.blur()`);
  let focused = null; for (let i = 0; i < 40 && !focused; i++) { await p.key('Tab', 'Tab', 9); const r = await run(p, `const a=document.activeElement; return a && a.classList.contains('rowbtn') && tile(${q(ST.status)}).contains(a) ? {name:T(a.querySelector('.name')), outline:getComputedStyle(a).outlineStyle, w:getComputedStyle(a).outlineWidth, pressed:a.getAttribute('aria-pressed'), tag:a.tagName} : null`); if (r) focused = r; }
  check('Keyboard: Tab reaches a status row (a real button) with a visible focus outline', focused && focused.tag === 'BUTTON' && focused.outline !== 'none' && parseFloat(focused.w) >= 2, focused);
  if (focused) {
    await p.key('Enter', 'Enter', 13, '\r');
    f.status = new Set([focused.name]);
    await verifySprint(p, S, f, 'Keyboard: Enter selects the focused status; aria-pressed and tag reflect it');
    check('Selection exposed with aria-pressed=true', await run(p, `return rowsOf(${q(ST.status)}).filter(r=>r.getAttribute('aria-pressed')==='true').length===1`));
    await p.key(' ', 'Space', 32, ' ');
    f.status = new Set();
    await verifySprint(p, S, f, 'Keyboard: Space on the same row clears it');
  }
  await run(p, `clickReset()`); f = M.newF();
  check('Controls are real elements (rows, cells, tags, Reset all and the clear button are buttons; the search is an input)', await run(p, `return [...document.querySelectorAll('.rowbtn, .cell, .tag-x, .resetall, .search-clear')].every(b=>b.tagName==='BUTTON') && document.getElementById('q').tagName==='INPUT'`));
  check('Light mode, no external fonts', await run(p, `const m=getComputedStyle(document.body).backgroundColor.match(/\\d+/g).map(Number); return m.every(x=>x>200) && getComputedStyle(document.documentElement).colorScheme!=='dark'`));
  check('Empty values: no null/undefined/NaN text in tiles or tables (excluding ticket prose)', await run(p, `const t=[...document.querySelectorAll('.kpis, .main')].map(n=>n.textContent).join(' ') + [...document.querySelectorAll('.tile-body tbody td:not(.wrap)')].map(n=>n.textContent).join(' '); return !/NaN|undefined|\\bnull\\b/.test(t)`));
  const dt = await run(p, `const hdr=[...tile(${q(ST.detail)}).querySelectorAll('thead th')].map(T); const ix=n=>hdr.indexOf(n); const rows=[...tile(${q(ST.detail)}).querySelectorAll('tbody tr')].map(tr=>({summary:tr.children[ix('Summary')].textContent, situation:tr.children[ix('Last sync update')].textContent, pts:T(tr.children[ix('Story points')]), tester:T(tr.children[ix('Tester')]), selfTested:T(tr.children[ix('Self-tested')]), selfTitle:tr.closest('table').querySelectorAll('thead th')[ix('Self-tested')].getAttribute('title'), days:T(tr.children[ix('Days in status')]), status:T(tr.children[ix('Status')]), parent:T(tr.children[ix('Parent')]), fix:T(tr.children[ix('Fix version')]), hdr})); return rows;`);
  check('Detail table: exact summary and last sync update are preserved; Self-tested shows Dev to Test, QA to Test, Same person or a dash (in that precedence) with its tooltip; Days in status with * when approximate; required columns; empty values and original status text', eq(dt[0].hdr, UI.sprint.detailHeaders) && dt.every((r, i) => r.summary === (S[i].summary || '—') && r.situation === (S[i].lastSyncUpdate || '—') && r.pts === (S[i].points == null ? '—' : String(S[i].points)) && r.tester === M.grpName(S[i].tester) && r.selfTested === M.selfTestReason(S[i]) && r.selfTitle === UI.sprint.selfTestedColumnTitle && r.days === (typeof S[i].statusAging === 'number' ? S[i].statusAging + (S[i].statusAgingApprox ? '*' : '') : '—') && r.status === S[i].status && r.parent === (S[i].parent || '—') && r.fix === (S[i].fixVersion || '—')));
  { const L1 = await run(p, `return {ticket: colCells(${q(ST.detail)},'Ticket'), parent: colCells(${q(ST.detail)},'Parent'), linked: colCells(${q(ST.detail)},'Linked work items'), summary: colCells(${q(ST.detail)},'Summary'), situation: colCells(${q(ST.detail)},'Last sync update')}`);
    check('Jira links (sprint): every Ticket cell is a link with the exact href, new tab, noopener', M.linkErrors(L1.ticket, S.map(t => t.ticket), 'ticket').length === 0 && L1.ticket.every(c => c.links.length === 1), M.linkErrors(L1.ticket, S.map(t => t.ticket), 'ticket'));
    check('Jira links (sprint): every key in Parent is its own link, text unchanged, none when no key', M.linkErrors(L1.parent, S.map(t => t.parent)).length === 0, M.linkErrors(L1.parent, S.map(t => t.parent)));
    check('Jira links (sprint): every key in Linked work items is its own link, text unchanged', M.linkErrors(L1.linked, S.map(t => t.linkedWorkItems)).length === 0 && (L1.linked.some(c => c.links.length > 1) || !S.some(t => M.keysIn(t.linkedWorkItems).length > 1)), M.linkErrors(L1.linked, S.map(t => t.linkedWorkItems)));
    check('Jira links (sprint): Summary and Last sync update cells have no links', [...L1.summary, ...L1.situation].every(c => c.links.length === 0)); }
  await run(p, `window.__prevented = 0; document.addEventListener('click', e => { if (e.target.closest && e.target.closest('a.jira')) { e.preventDefault(); window.__prevented++; } }, true); const a = tile(${q(ST.detail)}).querySelector('a.jira'); a.dispatchEvent(new MouseEvent('click', {bubbles:true, cancelable:true}));`);
  check('Jira links (sprint): clicking a link changes no filter, tag or KPI', await verifySprint(p, S, M.newF(), 'Sprint: state unchanged after clicking a Jira link').then(r => r.d.tags.length === 0) && (await run(p, `return window.__prevented`)) === 1);
  await run(p, `document.activeElement && document.activeElement.blur(); window.scrollTo(0,0)`);
  { let li = null; for (let i = 0; i < 260 && !li; i++) { await p.key('Tab', 'Tab', 9); li = await run(p, `const a=document.activeElement; return a && a.matches && a.matches('a.jira') ? {outline:getComputedStyle(a).outlineStyle, w:getComputedStyle(a).outlineWidth} : null`); }
    check('Jira links: Tab reaches a link and it shows a visible focus outline', li && li.outline !== 'none' && parseFloat(li.w) >= 2, li); }
  check('Needs attention today wording: title, subtitle, Ticket/Status/Days/Reason headers and the Missing line; Team Contribution is no longer on the sprint page', await run(p, `const t=tile(${q(ST.attention)}); return !!t && /^\\d+ open tickets?: long-running, carried over or blocked$/.test(T(t.querySelector('.sub'))) && (!t.querySelector('thead') || [...t.querySelectorAll('thead th')].map(T).join('|')===${q(UI.sprint.attention.headers.join('|'))}) && /^Missing: \\d+ no tester \\(not self-tested\\) · \\d+ no fix version · \\d+ no story points$/.test(T(t.querySelector('.tile-foot'))) && !tile('Team Contribution')`));
  check('Sprint: no console errors/warnings after all interactions', p.logs.length === 0, p.logs);
  // threshold setting, detail columns
  await run(p, `AF.config.midSprintThresholdDays = 5; AF.store.reset()`);
  await verifySprint(p, S, M.newF(), 'Changing the mid-sprint threshold in one place (5 days) updates the KPI, the markers and the legend', Object.assign({}, CTX, { thr: 5 }));
  await run(p, `AF.config.midSprintThresholdDays = 1; AF.store.reset()`);
  await verifySprint(p, S, M.newF(), 'Threshold back to 1 day', CTX);
  check('Detail table does not show the approximate addedDate (nor doneDate or cycleTime)', !(await run(p, `return [...tile(${q(ST.detail)}).querySelectorAll('thead th')].map(T)`)).some(h => /added|done date|cycle/i.test(h)));
  // layouts
  for (const [w, h, mode] of [[1440, 900, 'dash'], [1536, 864, 'dash'], [1366, 768, 'dash'], [1280, 720, 'fallback'], [1024, 768, 'fallback'], [800, 900, 'fallback'], [480, 900, 'fallback']]) {
    await p.resize(w, h); const r = await run(p, LAYOUT);
    if (mode === 'dash') check(`Layout ${w}x${h}: dashboard mode, no page scroll, nothing beyond the viewport`, r.sh <= r.ih && r.sw <= r.iw && r.bad.length === 0 && r.tiles.every(t => t.r <= r.iw && t.b <= r.ih), { sh: r.sh, ih: r.ih, sw: r.sw, bad: r.bad });
    else check(`Layout ${w}x${h}: fallback scrolling layout, no page-level horizontal scroll, nothing beyond the viewport outside tile scroll areas`, r.sw <= r.iw && r.bad.length === 0 && r.sh > r.ih, { sw: r.sw, iw: r.iw, bad: r.bad, sh: r.sh, ih: r.ih });
    { const bdf = await run(p, READ_BD); check(`Layout ${w}x${h}: burndown redraws to fit its tile (svg as wide as the tile, no scroll bars)`, bdf.has && Math.abs(bdf.svgW - bdf.bodyW) <= 2 && bdf.bodyOverflow <= 1, { svgW: bdf.svgW, bodyW: bdf.bodyW, o: bdf.bodyOverflow }); }
    if (w === 480) { const b = await run(p, `return [...document.querySelectorAll('.snapshot-badge, .live-dashboard-badge')].map(x => parseFloat(getComputedStyle(x).fontSize))`); check('Layout 480x900: badges stay at least 10px on narrow screens', b.every(s => s >= 10), b); }
    if (w === 1440 || w === 800) await p.screenshot(path.join(SP, `acc2_sprint_${w}.png`));
  }
  const sortableHeaders = UI.sprint.sortableHeaders;
  const sortHeaderState = await run(p, `return [...tile(${q(ST.detail)}).querySelectorAll('thead th')].map(th=>({label:T(th),button:!!th.querySelector('button.detail-sort'),sort:th.getAttribute('aria-sort'),arrow:th.querySelector('.detail-sort-arrow')&&T(th.querySelector('.detail-sort-arrow'))}))`);
  check('Ticket detail: only the eight specified headers (incl. Days in status) have accessible sort buttons and direction arrows', eq(sortHeaderState.filter(x => x.button).map(x => x.label), sortableHeaders) && sortHeaderState.filter(x => x.button).every(x => x.sort === 'none' && x.arrow === '↕') && sortHeaderState.filter(x => !x.button).every(x => x.sort === null), sortHeaderState);
  const naturalAsc = S.map(t => t.ticket).sort(M.natural);
  await run(p, `tile(${q(ST.detail)}).querySelector('.detail-sort[data-sort-key="Ticket"]').click()`);
  const readSort = k => run(p, `return {keys:[...tile(${q(ST.detail)}).querySelectorAll('tbody tr')].map(r=>T(r.children[0])),sort:tile(${q(ST.detail)}).querySelector('thead th button[data-sort-key=${q(k)}]').closest('th').getAttribute('aria-sort'),arrow:T(tile(${q(ST.detail)}).querySelector('thead th button[data-sort-key=${q(k)}] .detail-sort-arrow'))}`);
  const ticketAsc = await readSort('Ticket');
  check('Ticket detail: Ticket sorts naturally ascending (APP-9 before APP-10)', eq(ticketAsc.keys, naturalAsc) && ticketAsc.sort === 'ascending' && ticketAsc.arrow === '↑', ticketAsc);
  await run(p, `tile(${q(ST.detail)}).querySelector('.detail-sort[data-sort-key="Ticket"]').click()`);
  const ticketDesc = await readSort('Ticket');
  check('Ticket detail: clicking the active header reverses the sort direction', eq(ticketDesc.keys, naturalAsc.slice().reverse()) && ticketDesc.sort === 'descending' && ticketDesc.arrow === '↓', ticketDesc);
  const numericAsc = get => S.map((t, i) => ({ t, i, v: get(t) })).sort((a, b) => (typeof a.v !== 'number') ? (typeof b.v !== 'number' ? a.i - b.i : 1) : (typeof b.v !== 'number' ? -1 : a.v - b.v || a.i - b.i)).map(x => x.t.ticket);
  for (const [label, get] of [['Story points', t => t.points], ['Days in status', t => t.statusAging]]) {
    await run(p, `tile(${q(ST.detail)}).querySelector(${q('.detail-sort[data-sort-key="' + label + '"]')}).click()`);
    const r = await readSort(label);
    check(`Ticket detail: ${label} sorts numerically and missing values remain last`, eq(r.keys, numericAsc(get)) && r.sort === 'ascending', r);
  }
  for (const [label, getValue] of [['Owner', t => M.grpName(t.owner)], ['Tester', t => M.grpName(t.tester)], ['Status', t => t.status], ['Parent', t => t.parent], ['Fix version', t => t.fixVersion]]) {
    await run(p, `tile(${q(ST.detail)}).querySelector(${q('.detail-sort[data-sort-key="' + label + '"]')}).click()`);
    const expected = S.map((t, i) => ({ key: t.ticket, value: getValue(t), i })).sort((a, b) => {
      const am = a.value == null || String(a.value).trim() === '', bm = b.value == null || String(b.value).trim() === '';
      if (am || bm) return am === bm ? a.i - b.i : am ? 1 : -1;
      return M.natural(a.value, b.value) || a.i - b.i;
    }).map(x => x.key);
    const actual = await detailKeys();
    check(`Ticket detail: ${label} sorts in natural ascending order`, eq(actual, expected), { actual, expected });
  }
  await run(p, `clickReset(); clickRow(${q(ST.status)},'In Progress'); tile(${q(ST.detail)}).querySelector('.detail-sort[data-sort-key="Owner"]').click()`);
  const filteredOwnerSort = await run(p, `const tl=tile(${q(ST.detail)}),h=[...tl.querySelectorAll('thead th')].map(T),oi=h.indexOf('Owner'),rows=[...tl.querySelectorAll('tbody tr')];return {owners:rows.map(r=>T(r.children[oi])),statuses:rows.map(r=>T(r.children[h.indexOf('Status')])),tags:document.querySelectorAll('.tags .tag').length}`);
  const ownerAsc = S.filter(t => t.status === 'In Progress').map(t => M.grpName(t.owner)).sort(M.natural);
  check('Ticket detail: sorting respects the active status filter', eq(filteredOwnerSort.owners, ownerAsc) && filteredOwnerSort.statuses.every(x => x === 'In Progress') && filteredOwnerSort.tags === 1, filteredOwnerSort);
  await p.close();

  // =============== BACKLOG ===============
  console.log('\n--- Backlog page (real data) ---');
  p = await open(base + 'backlog.html');
  const backlogShell = await run(p, `return !document.getElementById('sprint-select')`);
  check('Backlog: JSON 200, no selector or manifest request, no console errors/warnings', p.resp[base + 'backlog.json'] === 200 && p.logs.length === 0 && backlogShell && p.reqs.filter(u => u.endsWith('.json')).length === 1 && p.reqs.some(u => u.endsWith('/backlog.json')) && p.reqs.every(u => isLocal(u)), { logs: p.logs, reqs: p.reqs });
  check('Shell: backlog tab, snapshot label and time, Jira live link, footer', await run(p, `const tabs=[...document.querySelectorAll('.tab')], live=document.querySelector('.live-dashboard-link'); return tabs[1].classList.contains('active') && !tabs[0].classList.contains('active') && T(document.querySelector('.snapshot-badge'))===${q(UI.shell.badge)} && T(document.getElementById('asof'))===${q(asOfLabel(ctx.BJ))} && live && live.href===window.AF.jiraDashboardUrl && new URL(live.href).pathname===${q(UI.shell.liveDashboardPath)} && live.target==='_blank' && live.rel.includes('noopener') && ${UI.shell.liveText}.test(T(live)) && ${UI.shell.footer}.test(T(document.querySelector('.foot')))`));
  check('Backlog: the page has exactly one h1 (visually hidden)', await run(p, `const h=[...document.querySelectorAll('h1')]; return h.length===1 && T(h[0])===${q(UI.shell.h1.backlog)} && h[0].classList.contains('visually-hidden')`));
  let bf = M.newBF(), query = '';
  await verifyBacklog(p, B, bf, query, 'Backlog: no filters, every tile = independent calculation');
  { const SR = await run(p, SCROLL_REGIONS); check('Backlog scroll regions: focusable and labelled exactly when they scroll', SR.every(r => r.scrolls ? r.tabindex === '0' && r.role === 'region' && !!r.label : r.tabindex === null && r.role === null), SR); }
  const LB = await run(p, LAYOUT);
  check('Layout 1920x1080 (backlog): no page scroll; 5 KPI + 5 main + 1 table tiles; fills width and height', LB.sh <= LB.ih && LB.sw <= LB.iw && LB.tiles.length === 11 && Math.max(...LB.tiles.map(t => t.r)) >= LB.iw - 16 && Math.max(...LB.tiles.map(t => t.b)) >= LB.ih - 60, LB);
  const sb = await run(p, `const b=tile(${q(BT.table)}).querySelector('.tile-body'); const th=b.querySelector('thead th'); b.scrollTop=200; const d=Math.round(th.getBoundingClientRect().top-b.getBoundingClientRect().top); const r={scrolls:b.scrollHeight>b.clientHeight, sb:b.offsetWidth-b.clientWidth, sticky:getComputedStyle(th).position, d}; b.scrollTop=0; return r;`);
  check('Backlog table: scrolls inside its tile, visible scrollbar, sticky header', sb.scrolls && sb.sb > 0 && sb.sticky === 'sticky' && Math.abs(sb.d) <= 2, sb);
  const D0 = await run(p, READ_BACKLOG);
  const backlogSummaries = await run(p, `const tb=tile(${q(BT.table)}); const hdr=[...tb.querySelectorAll('thead th')].map(T); const ix=hdr.indexOf('Summary'); return [...tb.querySelectorAll('tbody tr')].map(tr=>tr.children[ix].textContent)`);
  check('Backlog: exact summary is preserved; columns present; empty points/days/epic/risk/cluster/splitting show "—"; table in sheet order; exact keys', UI.backlog.headers.every(h => D0.hdr.includes(h)) && eq(D0.keys, B.map(t => t.ticket)) && eq(backlogSummaries, B.map(t => t.summary || '—')) && D0.rows.every((r, i) => { const x = B[i]; const ix = h => D0.hdr.indexOf(h); return r[ix('Story points')] === (x.points == null ? '—' : String(x.points)) && r[ix('Days in status')] === (x.days == null ? '—' : String(x.days)) && r[ix('Epic')] === (x.epic || '—') && r[ix('Risk / open question')] === (x.risk || '—') && r[ix('Related / cluster')] === (x.cluster || '—') && r[ix('Needs splitting')] === (x.needsSplitting || '—'); }));
  check('DoR pills: Well-Formed/Ready #C6EFCE, Weak #FFEB9C, Missing #FFC7CE; N/A (Epic) neutral', await run(p, `const c={}; document.querySelectorAll('.pill').forEach(x=>c[T(x)]=getComputedStyle(x).backgroundColor); return (c['Well-Formed'] === undefined || c['Well-Formed']==='rgb(198, 239, 206)') && (c.Ready === undefined || c.Ready==='rgb(198, 239, 206)') && (c['N/A (Epic)'] === undefined || c['N/A (Epic)']==='rgb(232, 236, 241)') && (c.Weak === undefined || c.Weak==='rgb(255, 235, 156)') && (c.Missing === undefined || c.Missing==='rgb(255, 199, 206)')`));
  { const L2 = await run(p, `return {ticket: colCells(${q(BT.table)},'Ticket'), epic: colCells(${q(BT.table)},'Epic'), cluster: colCells(${q(BT.table)},'Related / cluster'), summary: colCells(${q(BT.table)},'Summary'), risk: colCells(${q(BT.table)},'Risk / open question')}`);
    check('Jira links (backlog): every Ticket cell is a link with the exact href, new tab, noopener', M.linkErrors(L2.ticket, B.map(t => t.ticket), 'ticket').length === 0 && L2.ticket.every(c => c.links.length === 1), M.linkErrors(L2.ticket, B.map(t => t.ticket), 'ticket'));
    check('Jira links (backlog): every key in Epic is its own link, text unchanged', M.linkErrors(L2.epic, B.map(t => t.epic)).length === 0, M.linkErrors(L2.epic, B.map(t => t.epic)));
    check('Jira links (backlog): every key in Related / cluster is its own link, text unchanged', M.linkErrors(L2.cluster, B.map(t => t.cluster)).length === 0 && (L2.cluster.some(c => c.links.length > 1) || !B.some(t => M.keysIn(t.cluster).length > 1)), M.linkErrors(L2.cluster, B.map(t => t.cluster)));
    check('Jira links (backlog): Summary and Risk cells have no links', [...L2.summary, ...L2.risk].every(c => c.links.length === 0)); }
  await run(p, `window.__prevented = 0; document.addEventListener('click', e => { if (e.target.closest && e.target.closest('a.jira')) { e.preventDefault(); window.__prevented++; } }, true); tile(${q(BT.table)}).querySelector('a.jira').dispatchEvent(new MouseEvent('click', {bubbles:true, cancelable:true}));`);
  await verifyBacklog(p, B, M.newBF(), '', 'Backlog: state unchanged after clicking a Jira link');
  check('Jira links (backlog): the click did not change filters', (await run(p, `return window.__prevented`)) === 1 && (await run(p, `return readCommon().tags.length`)) === 0);
  const click = async (t, name, o) => run(p, `clickRow(${q(t)}, ${q(name)}, ${q(o || {})})`);
  // targets from the data: the most common DoR value, the two most common priorities, the most common type
  const dor1 = M.mostCommon(B, M.BKEY.dor, ['—'])[0], prios = M.mostCommon(B, M.BKEY.priority, ['—']), type1 = M.mostCommon(B, M.BKEY.type, ['—'])[0];
  await click(BT.dor, dor1); bf.dor = new Set([dor1]);
  await verifyBacklog(p, B, bf, query, `Click DoR "${dor1}": KPIs, other tiles, matrix and table filtered; DoR tile keeps alternatives`);
  await click(BT.priority, prios[0]); bf.priority = new Set([prios[0]]);
  await verifyBacklog(p, B, bf, query, `Add Priority "${prios[0]}" (AND across dimensions)`);
  if (prios[1]) { await click(BT.priority, prios[1], { ctrl: true }); bf.priority.add(prios[1]);
    await verifyBacklog(p, B, bf, query, `Ctrl+click adds Priority "${prios[1]}" (OR within dimension)`); }
  else skip('Backlog Ctrl+click on a second priority', 'the backlog has only one priority value');
  await click(BT.type, type1); bf.type = new Set([type1]);
  await verifyBacklog(p, B, bf, query, `Add Type "${type1}"`);
  const ageRow = M.AGEB.find(a => B.some(t => M.ageOf(t) === a));
  await click(BT.age, ageRow); bf.age = new Set([ageRow]);
  await verifyBacklog(p, B, bf, query, `Add age bucket "${ageRow}"`);
  await run(p, `clickReset()`); bf = M.newBF();
  await verifyBacklog(p, B, bf, query, 'Reset all clears the backlog filters');
  { // matrix: the populated priority/DoR cell with the fewest tickets
    const cells = {}; B.forEach(t => { const k = M.BKEY.priority(t) + '\u0000' + M.BKEY.dor(t); cells[k] = (cells[k] || 0) + 1; });
    const [pr, dr] = Object.keys(cells).sort((a, b) => cells[a] - cells[b] || a.localeCompare(b))[0].split('\u0000');
    await run(p, `clickCell(${q(BT.matrix)}, ${q(pr)}, ${q(dr)})`); bf.priority = new Set([pr]); bf.dor = new Set([dr]);
    await verifyBacklog(p, B, bf, query, `Matrix cell ${pr} / ${dr} sets priority and DoR`);
    await run(p, `clickCell(${q(BT.matrix)}, ${q(pr)}, ${q(dr)})`); bf.priority = new Set(); bf.dor = new Set();
    await verifyBacklog(p, B, bf, query, 'Same cell again clears both'); }
  // search (R001-19): every criterion on backlog.json, whole phrase, accents, AND, clear, URL q, a tile filter
  { const sb = qq => M.searchModel(qq, 'backlog'), cntB = qq => B.filter(sb(qq).pred).length;
    const ask = async (qq, label) => { await run(p, `setQ(${q(qq)})`); query = qq; const r = await verifyBacklog(p, B, bf, query, label); console.log(`COUNT backlog | ${label} | "${qq}" | ${r.all.length} of ${B.length}`); return r; };
    const t0 = B.find(t => /^[A-Z][A-Z0-9]+-\d+$/.test(t.ticket)), num = t0.ticket.split('-')[1];
    { const r = await ask(num, `Backlog search, key (partial number "${num}"): table and every tile = model; the exact key comes first`); check('Backlog search: a key query puts the exact key first', r.d.keys[0] === t0.ticket, r.d.keys.slice(0, 3)); }
    await ask(t0.ticket.slice(0, -1), 'Backlog search, key (partial prefix)');
    const word = (B.map(t => t.summary).join(' ').match(/[A-Za-z]{7,}/g) || ['ticket'])[0].toLowerCase();
    { const r = await ask(word, `Backlog search, summary word "${word}"`); check(`Backlog search: summary word "${word}" finds at least one ticket`, r.all.length > 0, r.all.length); }
    for (const dw of ['weak', 'missing']) { const L = dw[0].toUpperCase() + dw.slice(1); const r = await ask(dw, `Backlog search, whole phrase "${dw}" (DoR only)`);
      check(`Backlog search: "${dw}" is a whole phrase on DoR: exactly the ${B.filter(t => t.dor === L).length} ${L} tickets`, eq(r.all.map(t => t.ticket), B.filter(t => t.dor === L).map(t => t.ticket)), r.all.length); }
    { const titled = B.filter(t => t.dor !== 'Missing' && M.swords(t.summary).some(w => w.startsWith('missing')));
      if (titled.length) { await run(p, `setQ('missing')`); const keys = (await run(p, READ_SEARCH(BT.table))).keys;
        check(`Backlog search: a title that merely contains "missing" no longer matches "missing" (${titled.map(t => t.ticket).join(', ')})`, titled.every(t => !keys.includes(t.ticket)), { titled: titled.map(t => t.ticket), n: keys.length }); }
      else skip('Backlog search: title containing "missing"', 'no backlog title outside DoR Missing contains the word'); }
    { const r = await ask('well-formed', 'Backlog search, whole phrase "well-formed"'); check(`Backlog search: "well-formed" is a whole phrase on DoR: exactly the ${B.filter(t => t.dor === 'Well-Formed').length} Well-Formed tickets`, eq(r.all.map(t => t.ticket), B.filter(t => t.dor === 'Well-Formed').map(t => t.ticket)), r.all.length); }
    const te = B.find(t => !M.dv(t.epic).startsWith('—') && /^[A-Z][A-Z0-9]+-\d+/.test(t.epic));
    if (te) { const ek = te.epic.match(/^[A-Z][A-Z0-9]+-\d+/)[0], ew = (te.epic.replace(ek, '').match(/[A-Za-z]{5,}/) || [null])[0];
      { const r = await ask(ek, `Backlog search, epic key "${ek}"`); check(`Backlog search: epic key ${ek} finds every ticket of that epic`, B.filter(t => String(t.epic || '').startsWith(ek)).every(t => r.all.includes(t)), r.all.length); }
      if (ew) await ask(ew.toLowerCase(), `Backlog search, epic title word "${ew.toLowerCase()}"`); }
    else skip('Backlog search by epic', 'no backlog ticket has an epic');
    { const pool = []; B.forEach(t => [t.risk, t.cluster, t.type, t.priority, t.quickCheck].forEach(v => (String(v || '').match(/[A-Za-z]{6,}/g) || []).forEach(w => pool.push(w.toLowerCase()))));
      const excluded = [...new Set(pool)].find(w => cntB(w) === 0);
      if (excluded) { const r = await ask(excluded, `Backlog search, "${excluded}" appears only in fields the box does not search (risk, cluster, type, priority, comment draft)`); check(`Backlog search: "${excluded}" finds nothing (not a searched field)`, r.all.length === 0, r.all.length); }
      else skip('Backlog search excluded fields', 'no word found only in excluded fields'); }
    { const a = await ask('WÉLL-FÖRMED', 'Backlog search, accents and case: "WÉLL-FÖRMED"'); check('Backlog search: accents and case are ignored ("WÉLL-FÖRMED" = "well-formed")', eq(a.all, B.filter(sb('well-formed').pred)), a.all.length); }
    { const r = await ask(word + ' weak', `Backlog search, AND: "${word} weak"`); check(`Backlog search: several words are AND ("${word} weak" = "${word}" ∩ "weak")`, eq(r.all, B.filter(sb(word).pred).filter(sb('weak').pred)), r.all.length); }
    { await ask('weak', 'Backlog search "weak" before a tile filter'); const pr = M.mostCommon(B.filter(sb('weak').pred), M.BKEY.priority)[0]; await click(BT.priority, pr); bf.priority = new Set([pr]);
      const r = await verifyBacklog(p, B, bf, query, `Backlog search "weak" AND Priority tile "${pr}": every KPI, tile and the table = model`); console.log(`COUNT backlog | weak + Priority ${pr} | ${r.all.length}`);
      await run(p, `clickReset()`); bf = M.newBF(); query = ''; await verifyBacklog(p, B, bf, query, 'Reset all clears the search and the tile filter'); }
    { const st = await run(p, READ_SEARCH(BT.table)); check('Backlog search: placeholder, empty box, no q in the URL and no clear button after Reset all', st.placeholder === UI.backlog.placeholder && st.value === '' && st.url === null && st.clearHidden === true, st); }
    { const zr = await ask('zzqxjv', 'Backlog search "zzqxjv": zero results'); check('Zero results: KPIs are 0 and the empty text is the specified sentence', eq(zr.d.kpis.map(k => k.value).slice(0, 2), ['0', '0']) && zr.d.tableEmpty === UI.backlog.empty, zr.d.tableEmpty);
      await run(p, `clickTagX(${zr.d.tags.indexOf(UI.backlog.textTag('zzqxjv'))})`); query = '';
      await verifyBacklog(p, B, bf, query, 'Removing the search tag clears the search and the input box'); }
    { await run(p, `setQ('weak')`); const a = await run(p, READ_SEARCH(BT.table)); await run(p, `clickEl(document.querySelector('.search-clear'))`); const b = await run(p, READ_SEARCH(BT.table));
      check('Backlog search: typing keeps the text in the URL as q; the clear button empties the box, removes q and the tag, and shows every ticket', a.url === 'weak' && a.clearHidden === false && b.value === '' && b.url === null && b.clearHidden === true && b.tags.length === 0 && b.keys.length === B.length, { a: [a.url, a.clearHidden], b }); query = ''; }
    { const pq = await open(base + 'backlog.html?q=well-formed'); const r = await run(pq, READ_SEARCH(BT.table));
      check('Backlog search: a link with ?q=well-formed restores the box, the tag and the results', r.value === 'well-formed' && eq(r.keys, B.filter(sb('well-formed').pred).map(t => t.ticket)) && r.tags.includes(UI.backlog.textTag('well-formed')) && pq.logs.length === 0, { value: r.value, n: r.keys.length });
      await pq.close(); } }
  await run(p, `clickReset()`); bf = M.newBF(); query = ''; await run(p, `setQ('')`);
  await verifyBacklog(p, B, bf, query, 'Reset all clears everything on the backlog page');
  // Priority and Type icons (SPEC §10b)
  { const PR = ['Highest', 'High', 'Medium', 'Low', 'Lowest'], TY = ['Story', 'Bug', 'Sub-Bug', 'Epic', 'Task', 'Sub-task', 'Initiative', 'Doc Task'];
    const r = await run(p, `const rows = t => rowsOf(t).map(r => { const n = r.querySelector('.name'); return { name: T(n), icons: [...n.querySelectorAll('svg')].map(v => v.dataset.icon), hidden: [...n.querySelectorAll('svg')].every(v => v.getAttribute('aria-hidden') === 'true' && v.textContent === '' && !v.querySelector('title')) }; });
      const cells = col => colCells(${q(BT.table)}, col).map(c => c.text); const tb = tile(${q(BT.table)}); const hdr = [...tb.querySelectorAll('thead th')].map(T);
      const cellIcons = col => [...tb.querySelectorAll('tbody tr')].map(tr => [...tr.children[hdr.indexOf(col)].querySelectorAll('svg')].map(v => v.dataset.icon));
      return { prio: rows(${q(BT.priority)}), type: rows(${q(BT.type)}), pc: cellIcons('Priority'), tc: cellIcons('Type'), ptxt: cells('Priority'), ttxt: cells('Type'), imgs: document.querySelectorAll('img').length };`);
    const want = (kind, known, name) => known.includes(name) ? [kind + ':' + name] : [];
    check('Icons: every Priority and Type tile row has the right single icon before its (unchanged) name; unknown values have none; icons are decorative with no text', r.prio.every(x => eq(x.icons, want('priority', PR, x.name)) && x.hidden) && r.type.every(x => eq(x.icons, want('type', TY, x.name)) && x.hidden) && r.prio.some(x => x.icons.length) && r.type.some(x => x.icons.length), { p: r.prio, t: r.type });
    check('Icons: every Priority and Type table cell has the right single icon; the cell text is exactly the value (or a dash)', B.every((t, i) => eq(r.pc[i], t.priority && PR.includes(t.priority) ? ['priority:' + t.priority] : []) && eq(r.tc[i], t.type && TY.includes(t.type) ? ['type:' + t.type] : []) && r.ptxt[i] === (t.priority || '—') && r.ttxt[i] === (t.type || '—')), { pc: r.pc.slice(0, 3), ptxt: r.ptxt.slice(0, 3) });
    check('Icons: no image elements were added (inline SVG only)', r.imgs === 0); }
  check('Backlog page (R001-19): the filter bar has the search box and no Epic dropdown (no button, panel or checkboxes)', await run(p, `return !!document.querySelector('#filterbar input#q') && !document.getElementById('epic-btn') && !document.querySelector('.epicpop, .epicopt') && document.querySelectorAll('#filterbar select').length === 0`));
  // keyboard
  await run(p, `document.activeElement && document.activeElement.blur()`);
  let bfk = null; for (let i = 0; i < 40 && !bfk; i++) { await p.key('Tab', 'Tab', 9); const r = await run(p, `const a=document.activeElement; return a && a.classList.contains('rowbtn') && tile(${q(BT.dor)}).contains(a) ? {name:T(a.querySelector('.name')), outline:getComputedStyle(a).outlineStyle, w:getComputedStyle(a).outlineWidth} : null`); if (r) bfk = r; }
  check('Keyboard: Tab reaches a DoR row with a visible focus outline', bfk && bfk.outline !== 'none' && parseFloat(bfk.w) >= 2, bfk);
  if (bfk) { await p.key('Enter', 'Enter', 13, '\r'); bf.dor = new Set([bfk.name]);
    await verifyBacklog(p, B, bf, query, 'Keyboard: Enter selects the focused DoR row'); }
  await run(p, `clickReset()`); bf = M.newBF();
  check('Backlog: no console errors/warnings after all interactions', p.logs.length === 0, p.logs);
  for (const [w, h, mode] of [[1440, 900, 'dash'], [1536, 864, 'dash'], [1280, 720, 'fallback'], [800, 900, 'fallback'], [480, 900, 'fallback']]) {
    await p.resize(w, h); const r = await run(p, LAYOUT);
    if (mode === 'dash') check(`Backlog layout ${w}x${h}: dashboard mode, no page scroll, nothing beyond the viewport`, r.sh <= r.ih && r.sw <= r.iw && r.bad.length === 0, { sh: r.sh, ih: r.ih, sw: r.sw, bad: r.bad });
    else check(`Backlog layout ${w}x${h}: fallback layout, no page-level horizontal scroll`, r.sw <= r.iw && r.bad.length === 0 && r.sh > r.ih, { sw: r.sw, iw: r.iw, bad: r.bad });
  }
  await p.close();

  // =============== QUALITY INTAKE ===============
  console.log('\n--- Quality Intake page (real data) ---');
  p = await open(base + 'quality-intake.html');
  check('Quality Intake: JSON 200, local requests only, no console errors', p.resp[base + 'quality-intake.json'] === 200 && p.logs.length === 0 && p.reqs.filter(u => u.endsWith('.json')).length === 1 && p.reqs.every(u => isLocal(u)), { resp: p.resp, reqs: p.reqs, logs: p.logs });
  const qualityShell = await run(p, `const tabs=[...document.querySelectorAll('.tab')], live=document.querySelector('.live-dashboard-link'); return tabs.length===3 && T(tabs[2])===${q(UI.shell.tabs[2])} && tabs[2].classList.contains('active') && tabs[2].getAttribute('aria-current')==='page' && T(document.querySelector('.snapshot-badge'))===${q(UI.shell.badge)} && live && live.href===window.AF.jiraDashboardUrl && new URL(live.href).pathname===${q(UI.shell.liveDashboardPath)} && live.target==='_blank' && live.rel.includes('noopener') && ${UI.shell.liveText}.test(T(live)) && document.querySelectorAll('h1').length===1 && T(document.querySelector('h1'))===${q(UI.quality.title)} && ${UI.quality.caveat}.test(T(document.querySelector('.qi-intro'))) && ${UI.quality.pswatDefinition}.test(T(document.querySelector('.qi-intro')))`);
  check('Quality Intake: third tab active, one h1, intake-signal caveat and source definitions', qualityShell);
  const qCards = await run(p, `const txt=n=>n?T(n):''; return [...document.querySelectorAll('.qi-sprint')].map(card=>({id:Number(card.dataset.sprintId),title:txt(card.querySelector('h2')),sub:txt(card.querySelector('.sub')),partial:txt(card.querySelector('.qi-partial')),complete:txt(card.querySelector('.qi-complete')),rows:[...card.querySelectorAll('.qi-metrics tbody tr')].map(r=>({source:txt(r.querySelector('th')),count:txt(r.querySelector('.qi-count')||r.querySelector('.qi-na')),rate:txt(r.lastElementChild)}))}))`);
  const NA = UI.quality.na;
  const qExpected = Q.sprints.map(s => ({ id: s.sprintId, title: s.name || `Sprint ${s.sprintId}`, sub: `Sprint ${s.sprintId} · Window: ${s.windowStart || NA} to ${s.windowEnd || NA} · ${s.weekdays == null ? NA : s.weekdays} weekdays`, partial: s.partial === true ? UI.quality.partial : '', complete: s.partial === false ? UI.quality.complete : '', rows: UI.quality.sources.map(([source, k]) => ({ source, count: s.counts && s.counts[k] != null ? String(s.counts[k]) : NA, rate: s.ratesPer10Weekdays && s.ratesPer10Weekdays[k] != null ? (Math.round(s.ratesPer10Weekdays[k] * 10) / 10).toFixed(1) : NA })) }));
  check('Quality Intake: sprint windows, partial marker, raw counts and rates match the JSON', eq(qCards, qExpected), { actual: qCards, expected: qExpected });
  const qChoice = Q.sprints.find(s => Array.isArray(s.tickets) && s.tickets.length && s.counts && s.counts.pswat > 0) || Q.sprints.find(s => Array.isArray(s.tickets) && s.tickets.length);
  if (qChoice) {
    const qSource = qChoice.tickets[0].source, qSourceKey = qSource === 'PSWAT' ? 'pswat' : 'appBugs', qItems = qChoice.tickets.filter(t => t.source === qSource);
    const sel = `.qi-count[data-key="${qChoice.sprintId}|${qSourceKey}"]`;
    await run(p, `document.querySelector(${q(sel)}).click()`);
    const qDetail = await run(p, `const card=[...document.querySelectorAll('.qi-sprint')].find(c=>c.dataset.sprintId===${q(String(qChoice.sprintId))});const d=card.querySelector('.qi-details'),b=card.querySelector(${q(sel)}),box=d&&d.querySelector('.qi-ticket-scroll'),hint=d&&d.querySelector('.qi-scroll-hint');return {open:!!d,head:T(d&&d.querySelector('h3')),expanded:b&&b.getAttribute('aria-expanded'),overflow:box&&box.scrollHeight>box.clientHeight+1,hint:hint&&T(hint),aria:box&&box.getAttribute('aria-label'),tabindex:box&&box.getAttribute('tabindex'),role:box&&box.getAttribute('role'),bottomGap:Math.round(card.getBoundingClientRect().bottom-box.getBoundingClientRect().bottom),rows:[...(d?d.querySelectorAll('tbody tr'):[])].map(r=>({key:T(r.children[0]),summary:T(r.children[1]),type:T(r.children[2]),status:T(r.children[3]),created:T(r.children[4]),href:r.querySelector('a')&&r.querySelector('a').href}))}`);
    const qRowsExpected = qItems.map(t => ({ key: t.key, summary: t.summary || NA, type: t.type || NA, status: t.status || NA, created: t.created || NA, href: t.url || null }));
    check('Quality Intake: clicking a source count expands exactly its ticket list with Jira-linked keys', qDetail.open && qDetail.expanded === 'true' && qDetail.head === UI.quality.detailHead(qSource, qItems.length) && eq(qDetail.rows, qRowsExpected), { actual: qDetail, expected: qRowsExpected });
    check('Quality Intake: expanded list reaches the bottom of its card, explains visible overflow, and is a focusable region only when it overflows', qDetail.bottomGap <= 48 && (qDetail.overflow ? qDetail.hint === UI.quality.scrollHint(qItems.length) && qDetail.aria.includes(UI.quality.scrollAria(qItems.length)) && qDetail.tabindex === '0' && qDetail.role === 'region' : qDetail.tabindex === null && qDetail.role === null), { overflow: qDetail.overflow, hint: qDetail.hint, aria: qDetail.aria, tabindex: qDetail.tabindex, bottomGap: qDetail.bottomGap });
    await run(p, `document.querySelector(${q(sel)}).click()`);
    check('Quality Intake: clicking the expanded count closes its detail', await run(p, `return !document.querySelector('.qi-details') && document.querySelector(${q(sel)}).getAttribute('aria-expanded')==='false'`));
  } else check('Quality Intake: click-through has a populated source row', false);
  check('Quality Intake: no console errors after interactions', p.logs.length === 0, p.logs);
  await p.close();

  // =============== R001-19 search on the sprint page: every criterion on all four sprints ===============
  console.log('\n--- R001-19: search on the sprint page (every manifest sprint) ---');
  for (const entry of MANIFEST.sprints) {
    const T = J(entry.file).tickets, id = entry.id, pg = await open(base + 'index.html?sprint=' + id);
    const sm = qq => M.searchModel(qq, 'sprint'), keysOf = rows => rows.map(t => t.ticket);
    const ask = async (label, qq, extra) => {
      await run(pg, `setQ(${q(qq)})`); const r = await run(pg, READ_SEARCH(ST.detail)), want = keysOf(M.exactFirst(T.filter(sm(qq).pred), sm(qq)));
      const extraOk = extra ? extra(r.keys) : true;
      check(`Sprint ${id} search, ${label} "${qq}": ${want.length} of ${T.length}; detail rows, counter, tag and URL equal the model`, eq(r.keys, want) && (want.length ? r.sub.startsWith(`${want.length} of ${T.length} work items`) : r.empty === UI.sprint.empty) && r.tags.includes(UI.sprint.searchTag(qq)) && r.url === qq.trim() && r.sprintParam === String(id) && extraOk, { got: r.keys.length, want: want.length, sub: r.sub, extraOk });
      console.log(`COUNT sprint ${id} | ${label} | "${qq}" | ${want.length} of ${T.length}`); return r.keys; };
    const direct = pred => keysOf(T.filter(pred));
    const t0 = T.find(t => /^[A-Z][A-Z0-9]+-\d+$/.test(t.ticket));
    await ask('key, partial number (exact key first)', t0.ticket.split('-')[1], k => k[0] === t0.ticket);
    await ask('key, partial prefix', t0.ticket.slice(0, -1));
    { const w = (T.map(t => t.summary).join(' ').match(/[A-Za-z]{7,}/g) || ['ticket'])[0].toLowerCase(); await ask('summary word', w, k => k.length > 0); }
    await ask('status, whole phrase', 'in review', k => eq(k, direct(t => t.status === 'In Review')));
    await ask('status, whole phrase', 'in progress', k => eq(k, direct(t => t.status === 'In Progress')));
    await ask('status word', 'done', k => direct(t => t.status === 'Done').every(x => k.includes(x)));
    await ask('status word', 'open', k => direct(t => t.status === 'Open').every(x => k.includes(x)));
    for (const [ph, v] of [['dev to test', 'Dev to Test'], ['qa to test', 'QA to Test'], ['same person', 'Same person']]) await ask('Self-tested, whole phrase', ph, k => eq(k, direct(t => M.selfTestReason(t) === v)));
    await ask('Self-tested, any of the three', 'self-tested', k => eq(k, direct(t => M.selfTestReason(t) !== '—')));
    { const tp = T.find(t => /^[A-Z][A-Z0-9]+-\d+/.test(t.parent || ''));
      if (tp) { const pk = tp.parent.match(/^[A-Z][A-Z0-9]+-\d+/)[0], pw = (tp.parent.replace(pk, '').match(/[A-Za-z]{5,}/) || [null])[0];
        await ask('parent key', pk, k => direct(t => String(t.parent || '').startsWith(pk)).every(x => k.includes(x)));
        if (pw) await ask('parent title word', pw.toLowerCase(), k => k.length > 0); }
      else skip(`Sprint ${id} search by parent`, 'no ticket has a parent'); }
    { const fv = (T.find(t => t.fixVersion) || {}).fixVersion;
      if (fv) { const pre = String(fv).split('.').slice(0, 2).join('.');
        await ask('fix version, prefix', pre, k => direct(t => String(t.fixVersion || '').startsWith(pre)).every(x => k.includes(x)));
        await ask('fix version, full value', String(fv), k => direct(t => t.fixVersion === fv).every(x => k.includes(x))); }
      else skip(`Sprint ${id} search by fix version`, 'no ticket has a fix version'); }
    { const on = (T.find(t => M.grpName(t.owner) !== 'Unassigned') || {}).owner; if (on) await ask('assignee name', on, k => direct(t => t.owner === on).every(x => k.includes(x))); }
    { const tn = (T.find(t => M.grpName(t.tester) !== 'Unassigned') || {}).tester; if (tn) await ask('tester name', tn, k => direct(t => t.tester === tn).every(x => k.includes(x))); }
    { const pool = []; T.forEach(t => [t.lastSyncUpdate, t.linkedWorkItems, t.type, t.blocker].forEach(v => (String(v || '').match(/[A-Za-z]{6,}/g) || []).forEach(w => pool.push(w.toLowerCase()))));
      const ex = [...new Set(pool)].find(w => T.filter(sm(w).pred).length === 0);
      if (ex) await ask('a word found only in fields the box does not search (Last sync update, linked work items, type)', ex, k => k.length === 0);
      else skip(`Sprint ${id} search excluded fields`, 'no word found only in excluded fields'); }
    await run(pg, `clickReset()`);
    check(`Sprint ${id} search: no console errors`, pg.logs.length === 0, pg.logs);
    await pg.close();
  }
  { // behaviour on the active sprint: phrase rule, accents, AND, clear, URL q, a tile filter, Reset all
    const T = S, pg = await open(base + 'index.html'), sm = qq => M.searchModel(qq, 'sprint');
    const askK = async qq => { await run(pg, `setQ(${q(qq)})`); return (await run(pg, READ_SEARCH(ST.detail))).keys; };
    { const ph = await askK('dev to test'), words = await askK('test to dev');
      check(`Sprint search, whole phrase: "dev to test" returns only Dev to Test tickets (${ph.length}); the same words in another order are plain words (${words.length})`, ph.every(k => M.selfTestReason(T.find(t => t.ticket === k)) === 'Dev to Test') && eq(words, T.filter(sm('test to dev').pred).map(t => t.ticket)), { ph: ph.length, words: words.length }); }
    { const a = await askK('ÏN RÉVÏEW'), b = await askK('in review'); check(`Sprint search, accents and case: "ÏN RÉVÏEW" = "in review" (${b.length})`, eq(a, b) && b.length === T.filter(t => t.status === 'In Review').length, { a: a.length, b: b.length }); }
    { const on = T.find(t => M.grpName(t.owner) !== 'Unassigned').owner.split(' ')[0].toLowerCase(), both = await askK(on + ' in review');
      check(`Sprint search, AND: "${on} in review" = "${on}" ∩ "in review" (${both.length})`, eq(both, T.filter(sm(on).pred).filter(t => t.status === 'In Review').map(t => t.ticket)), both.length); }
    { await askK('in review'); const tName = Object.keys(M.group(T.filter(t => t.status === 'In Review'), M.SKEY.type))[0];
      await run(pg, `clickRow(${q(ST.type)}, ${q(tName)})`); const f = M.newF(); f.type = new Set([tName]);
      await verifySprint(pg, T, f, `Sprint search "in review" AND Type tile "${tName}": every KPI, tile, the burndown and the detail = model`, Object.assign({}, CTX, { q: 'in review' }));
      const mm = M.expectSprint(T, f, Object.assign({}, CTX, { q: 'in review' })).matrix, r0 = Object.keys(mm)[0], c0 = Object.keys(mm[r0] || {})[0];
      if (r0 && c0) { await run(pg, `clickCell(${q(ST.matrix)}, ${q(r0)}, ${q(c0)})`); f.assignee = new Set([r0]); f.tester = new Set([c0]);
        await verifySprint(pg, T, f, `Sprint search "in review" AND Type "${tName}" AND grid cell "${r0} / ${c0}"`, Object.assign({}, CTX, { q: 'in review' })); }
      await run(pg, `clickReset()`); const st = await run(pg, READ_SEARCH(ST.detail));
      check('Sprint search: Reset all clears the box, the tag and q in the URL; the placeholder names Self-tested and fix version', st.value === '' && st.url === null && st.clearHidden === true && st.tags.length === 0 && st.keys.length === T.length && st.placeholder === UI.sprint.placeholder, st); }
    { await askK('same person'); const a = await run(pg, READ_SEARCH(ST.detail)); await run(pg, `clickEl(document.querySelector('.search-clear'))`); const b = await run(pg, READ_SEARCH(ST.detail));
      check('Sprint search: the clear button empties the box, removes q and the tag and shows every ticket', a.clearHidden === false && a.url === 'same person' && b.value === '' && b.url === null && b.clearHidden === true && b.tags.length === 0 && b.keys.length === T.length, { a: [a.url, a.clearHidden], b: [b.value, b.url, b.tags] }); }
    check('Sprint search (active sprint): no console errors', pg.logs.length === 0, pg.logs);
    await pg.close();
    if (CLOSED_ENTRY) { const pq = await open(base + 'index.html?sprint=' + CLOSED_ENTRY.id + '&q=in%20review'); const r = await run(pq, READ_SEARCH(ST.detail)), sel = await run(pq, `return document.getElementById('sprint-select').value`);
      check(`Sprint search: a link with ?sprint=${CLOSED_ENTRY.id}&q=in review opens that sprint with the search restored`, sel === String(CLOSED_ENTRY.id) && r.value === 'in review' && eq(r.keys, CLOSED.tickets.filter(t => t.status === 'In Review').map(t => t.ticket)) && r.sprintParam === String(CLOSED_ENTRY.id) && pq.logs.length === 0, { sel, value: r.value, n: r.keys.length });
      await pq.close(); } }

  // =============== R001-18 expected values, all four sprints ===============
  // Fixed values from the Project Improvements Log, R001-18 (data of 2026-10-30): the old rule (Dev to Test only)
  // and the new one (Dev to Test or QA to Test). Closed sprints are frozen, so their values stay fixed. The active
  // sprint changes at every export, so its fixed values are checked only on the export they were taken from
  // (exportedAt below); later exports SKIP them, while the rule itself is still checked against the model everywhere.
  console.log('\n--- R001-18: self-tested rule, expected values per sprint (Project Improvements Log) ---');
  { const R18 = [
      { id: 12191, exportedAt: '2026-10-30T13:09:35-07:00', kpi: [7, 4], self: [46, 49], unassigned: 4, column: { 'Dev to Test': 11, 'QA to Test': 3, 'Same person': 36, '—': 28 }, dashOther: 24 },
      { id: 12176, kpi: [0, 0], self: [38, 38], unassigned: 0 },
      { id: 12119, kpi: [0, 0], self: [47, 47], unassigned: 0 },
      { id: 4697, kpi: [19, 19], self: [25, 25], unassigned: 19 }];
    const oldNoTester = t => M.grpName(t.tester) === 'Unassigned' && !M.isDevToTest(t);
    const oldGroup = t => M.grpName(t.tester) === 'Unassigned' ? (M.isDevToTest(t) ? 'Self-tested' : 'Unassigned') : (M.grpName(t.tester) === M.grpName(t.owner) ? 'Self-tested' : M.grpName(t.tester));
    for (const x of R18) {
      const entry = MANIFEST.sprints.find(e => e.id === x.id);
      if (!entry) { skip(`R001-18 sprint ${x.id}`, 'not in sprints.json'); continue; }
      const snap = J(entry.file), T = snap.tickets;
      if (x.exportedAt && snap.exportedAt !== x.exportedAt) { skip(`R001-18 sprint ${x.id}: fixed expected values`, `the snapshot is a later export (${snap.exportedAt}) than the one the log values come from (${x.exportedAt})`); continue; }
      const pg = await open(base + 'index.html?sprint=' + x.id);
      const got = await run(pg, `const m=matrixOf(${q(ST.matrix)}); const det=tile(${q(ST.detail)}), hdr=[...det.querySelectorAll('thead th')].map(T), ix=hdr.indexOf('Self-tested'); const col={}; det.querySelectorAll('tbody tr').forEach(tr=>{const v=T(tr.children[ix]); col[v]=(col[v]||0)+1;}); return { kpi: T(kpi(${q(UI.sprint.kpi.noTester)}).querySelector('.value')), self: m.colTotals['Self-tested']||0, unassigned: m.colTotals['Unassigned']||0, col, attention: T(tile(${q(ST.attention)}).querySelector('.tile-foot')) }`);
      const oldK = T.filter(oldNoTester).length, oldS = T.filter(t => oldGroup(t) === 'Self-tested').length;
      const dashOther = T.filter(t => M.selfTestReason(t) === '—' && M.grpName(t.tester) !== 'Unassigned').length;
      check(`R001-18 sprint ${x.id}: the snapshot gives the log's old values under the old rule (no tester KPI ${x.kpi[0]}, grid Self-tested ${x.self[0]})`, oldK === x.kpi[0] && oldS === x.self[0], { oldK, oldS });
      check(`R001-18 sprint ${x.id}: page shows No tester & not self-tested ${x.kpi[1]}, grid Self-tested ${x.self[1]}, Unassigned ${x.unassigned} (= the KPI), and the attention Missing line uses the same count`, got.kpi === String(x.kpi[1]) && got.self === x.self[1] && got.unassigned === x.unassigned && got.unassigned === x.kpi[1] && got.attention.startsWith(`Missing: ${x.kpi[1]} no tester (not self-tested)`), got);
      if (x.column) check(`R001-18 sprint ${x.id}: Self-tested column counts Dev to Test ${x.column['Dev to Test']}, QA to Test ${x.column['QA to Test']}, Same person ${x.column['Same person']}, dash ${x.column['—']} (${x.dashOther} tested by another person, ${x.column['—'] - x.dashOther} with no tester)`, eqObj(got.col, x.column) && dashOther === x.dashOther, { col: got.col, dashOther });
      check(`R001-18 sprint ${x.id}: no console errors`, pg.logs.length === 0, pg.logs);
      await pg.close();
    } }

  // =============== FIXTURE ===============
  console.log('\n--- Fixture edge cases (copy of the app) ---');
  p = await open(url.fixture + 'index.html');
  const FJ = JSON.parse(fixtureTxt), F = FJ.tickets, FCTX = { sprint: FJ.sprint, today: FJ.refreshedAt, thr: 1 };
  await verifySprint(p, F, M.newF(), 'Fixture: all tiles consistent (Other bucket, Unassigned merge, null points, removed ticket, Dev to Test, days in status)', FCTX);
  const fd = await run(p, READ_SPRINT);
  { const fe = M.expectSprint(F, M.newF(), FCTX), un = fe.matrix.Unassigned;
    check(`Fixture: "Blocked" is an Other row counted in totals (Total ${F.length} / ${M.sumP(F)}); null and literal "Unassigned" owners merge into one Unassigned grid row`, fd.status.Other && fd.status.Other[0] === 1 && fd.statusFoot.replace(/\s+/g, '') === `Total${F.length}W.I|${M.sumP(F)}SP` && un && fd.matrix.o.Unassigned && eq(fd.matrix.o.Unassigned, un), { un, rows: Object.keys(fd.matrix.o) }); }
  check('Fixture: "Dev to Testing" is not Dev to Test (stays Unassigned and shows a dash in Self-tested); Dev to Test with a named tester stays under that tester; null points show "—"; Blocked text in detail', await run(p, `const hdr=[...tile(${q(ST.detail)}).querySelectorAll('thead th')].map(T); const rows=[...tile(${q(ST.detail)}).querySelectorAll('tbody tr')].map(tr=>[...tr.children].map(T)); const r=rows.find(r=>r[0]==='APP-3053'); return r[hdr.indexOf('Story points')]==='—' && r[hdr.indexOf('Status')]==='Blocked'`) && M.testerGroup(F.find(t => t.ticket === 'APP-2631')) === 'Unassigned' && M.testerGroup(F.find(t => t.ticket === 'APP-193')) === M.grpName(F.find(t => t.ticket === 'APP-193').tester) && fd.matrix.colTotals[M.grpName(F.find(t => t.ticket === 'APP-193').tester)] >= 1);
  { const fk = FJ.sprint.carriedOver.ticketKeys || [];
    await run(p, `clickEl(kpi(${q(UI.sprint.kpi.carried)}))`);
    const got = await run(p, `return [...tile(${q(ST.detail)}).querySelectorAll('tbody tr')].map(tr=>T(tr.children[0]))`);
    check('Fixture: carriedOver.ticketKeys makes Carried over clickable and it filters the lower section to those keys', eq(got, fk), { got, fk });
    await run(p, `clickReset()`); }
  await run(p, `clickRow(${q(ST.status)}, 'Other')`); const ff = M.newF(); ff.status = new Set(['Other']);
  await verifySprint(p, F, ff, 'Fixture: clicking the Other status filters to the Blocked ticket', FCTX);
  await run(p, `clickReset()`);
  check('Fixture: no console errors', p.logs.length === 0, p.logs);
  await p.close();

  console.log('\n--- Burndown, cycle time, mid-sprint and carried over with hand-made data (copies of the app) ---');
  p = await open(url.burn + 'index.html');
  await run(p, `AF.config.midSprintThresholdDays = 2; AF.store.reset()`); // the hand-made sprint's expected numbers are worked out by hand for a 2-day threshold, independent of the app default
  { const BJ2 = JSON.parse(mkSprint(Object.assign({ carriedOver: CARRIED }, SP_OK))), BCTX = { sprint: BJ2.sprint, today: BJ2.refreshedAt, thr: 2 };
    await verifySprint(p, BURN_T, M.newF(), 'Hand-made sprint: every tile and the burndown equal the independent calculation', BCTX);
    const k = await run(p, READ_SPRINT), bd = await run(p, READ_BD);
    check('Hand-made sprint: KPIs equal the numbers worked out by hand (6 items, 15 points, 87% done, 2 added mid-sprint, 3 carried over, 2 no tester, cycle time 3.3)', eq(k.kpis.map(x => x.value), ['6', '15', '87%', '2', '3', '2', '—', '3.3']) && k.kpis[7].hint === 'days, over 3 Done tickets' && k.kpis[3].hint === '2 points, added after day 2' && k.kpis[4].hint === '20% of tickets, 8 points', k.kpis);
    check('Hand-made sprint: scope [13,13,13,13] (APP-903 enters on 9/26, after today), remaining [9,4,1,1] then nothing after today; ideal falls from the starting scope 13 to 0 in steps of 13/6; done per day [4,5,3,0,0,0,0] (the pre-start date counts on day 1)', eq(bd.days.map(d => d.remaining), [9, 4, 1, 1, null, null, null]) && eq(bd.days.map(d => d.scope), [13, 13, 13, 13, 15, 15, 15]) && eq(bd.days.map(d => Math.round(d.ideal * 1000) / 1000), [13, 10.833, 8.667, 6.5, 4.333, 2.167, 0]) && eq(bd.days.map(d => d.done), [4, 5, 3, 0, 0, 0, 0]), bd.days);
    check('Hand-made sprint: markers on 9/25 (1 ticket, 0 points) and 9/26 (1 ticket, 2 points); today is 9/25; subtitle and footnote as specified', eq(bd.added.map(a => [a.date, a.count, a.points]), [['2026-09-25', 1, 0], ['2026-09-26', 1, 2]]) && bd.todayLabel && bd.sub === '1 of 13 points remaining today, ideal 6.5' && bd.foot.includes('1 Done ticket has no done date and is not on the line.'), { added: bd.added, sub: bd.sub, foot: bd.foot });
    // marker click: list of added tickets (SPEC §6.3, D44)
    const PANEL = `const b = tile(${q(ST.burndown)}); const pop = b.querySelector('.bd-pop'); const mk = [...b.querySelectorAll('g.bd-added')].map(g => [g.dataset.date, g.getAttribute('aria-pressed'), g.getAttribute('class')]);
      return { open: !!pop, role: pop ? pop.getAttribute('role') : null, label: pop ? pop.getAttribute('aria-label') : null, head: pop ? T(pop.querySelector('.bd-pop-head')) : null, hdr: pop ? [...pop.querySelectorAll('th')].map(T) : [], rows: pop ? [...pop.querySelectorAll('tbody tr')].map(tr => [...tr.children].map(T)) : [],
        links: pop ? [...pop.querySelectorAll('tbody a')].map(a => [T(a), a.getAttribute('href'), a.getAttribute('target')]) : [], mk, inside: pop ? (r => r.left >= b.getBoundingClientRect().left - 1 && r.right <= b.getBoundingClientRect().right + 1 && r.top >= b.getBoundingClientRect().top - 1 && r.bottom <= b.getBoundingClientRect().bottom + 1)(pop.getBoundingClientRect()) : null,
        tags: [...document.querySelectorAll('.tags .tag')].length, kpis: [...document.querySelectorAll('.kpi .value')].map(T) };`;
    const kBefore = (await run(p, PANEL)).kpis;
    check('Marker panel: closed at the start; markers expose aria-pressed=false', (r => !r.open && eq(r.mk.map(m => m[1]), ['false', 'false']))(await run(p, PANEL)));
    await run(p, `clickEl(tile(${q(ST.burndown)}).querySelector('g.bd-added[data-date="2026-09-26"]'))`);
    { const r = await run(p, PANEL);
      check('Marker panel: clicking the 9/26 marker lists exactly APP-903 (Jira link, summary, 2 points, In Progress, Bob) under "Added Sep. 26, 2026"; it is a labelled region', r.open && r.role === 'region' && /Sep\. 26, 2026/.test(r.label || '') && r.head.startsWith('Added Sep. 26, 2026') && r.head.includes('1 ticket, 2 points') && eq(r.hdr, UI.sprint.burndown.panelHeaders) && eq(r.rows, [['APP-903', 's', '2', 'In Progress', 'Bob']]) && eq(r.links, [['APP-903', UI.jiraBrowse + 'APP-903', '_blank']]) && eq(r.mk, [['2026-09-25', 'false', 'bd-added'], ['2026-09-26', 'true', 'bd-added is-selected']]), r);
      check('Marker panel: it stays inside the burndown tile and changes no filter, tag or KPI', r.inside === true && r.tags === 0 && eq(r.kpis, kBefore), r); }
    await run(p, `clickEl(tile(${q(ST.burndown)}).querySelector('g.bd-added[data-date="2026-09-25"]'))`);
    { const r = await run(p, PANEL);
      check('Marker panel: another marker replaces the list (9/25: APP-906, 0 points, In Review, Ann)', r.open && r.head.startsWith('Added Sep. 25, 2026') && eq(r.rows, [['APP-906', 's', '0', 'In Review', 'Ann']]) && eq(r.mk.map(m => m[1]), ['true', 'false']), r); }
    await run(p, `clickEl(tile(${q(ST.burndown)}).querySelector('g.bd-added[data-date="2026-09-25"]'))`);
    check('Marker panel: clicking the same marker again closes it', (r => !r.open && eq(r.mk.map(m => m[1]), ['false', 'false']))(await run(p, PANEL)));
    await run(p, `tile(${q(ST.burndown)}).querySelector('g.bd-added[data-date="2026-09-26"]').dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', bubbles:true}))`);
    check('Marker panel: Enter on a marker opens it, and the marker keeps keyboard focus', await run(p, `const a = document.activeElement; return !!tile(${q(ST.burndown)}).querySelector('.bd-pop') && a && a.classList && a.classList.contains('bd-added') && a.dataset.date === '2026-09-26'`));
    await p.resize(1440, 900);
    check('Marker panel: stays open and inside the tile after the chart is redrawn at a new window size', (r => r.open && r.inside === true && eq(r.rows.map(x => x[0]), ['APP-903']))(await run(p, PANEL)));
    await p.resize(1920, 1080);
    await run(p, `document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true}))`);
    check('Marker panel: Escape closes it', (r => !r.open && eq(r.mk.map(m => m[1]), ['false', 'false']))(await run(p, PANEL)));
    await run(p, `clickEl(tile(${q(ST.burndown)}).querySelector('g.bd-added[data-date="2026-09-26"]'))`);
    await run(p, `clickEl(tile(${q(ST.burndown)}).querySelector('.bd-pop-x'))`);
    check('Marker panel: the x button closes it', (r => !r.open)(await run(p, PANEL)));
    // a keyboard user sees where the focus is on a marker (C19)
    await run(p, `document.activeElement && document.activeElement.blur(); window.scrollTo(0,0)`);
    { let ring = null; for (let i = 0; i < 80 && !ring; i++) { await p.key('Tab', 'Tab', 9); ring = await run(p, `const a=document.activeElement; if (!a || !a.classList || !a.classList.contains('bd-added')) return null; const hit=a.querySelector('.bd-hit'); return { stroke: getComputedStyle(hit).stroke, width: parseFloat(getComputedStyle(hit).strokeWidth), focusVisible: a.matches(':focus-visible') }`); }
      check('Marker focus: Tab reaches a burndown marker and it shows a visible teal focus ring', ring && ring.focusVisible && ring.stroke === 'rgb(42, 157, 143)' && ring.width >= 2, ring); }
    await run(p, `clickEl(tile(${q(ST.burndown)}).querySelector('g.bd-added[data-date="2026-09-26"]'))`);
    await run(p, `clickRow(${q(ST.status)}, 'Done')`);
    check('Marker panel: after a filter that removes its tickets (status Done) the panel closes', (r => !r.open && r.mk.length === 0)(await run(p, PANEL)));
    await run(p, `clickReset()`);
    check('Marker panel: after Reset all the markers are back and no panel is open', (r => !r.open && r.mk.length === 2)(await run(p, PANEL)));
    await run(p, `clickRow(${q(ST.status)}, 'Done')`); const ff2 = M.newF(); ff2.status = new Set(['Done']);
    await verifySprint(p, BURN_T, ff2, 'Hand-made sprint, status Done selected: scope and both lines recomputed for the filtered set', BCTX);
    const bd2 = await run(p, READ_BD), k2 = await run(p, READ_SPRINT);
    check('Hand-made sprint, Done only: scope 13 on every day, remaining [9,4,1,1], ideal starts at 13, no markers, mid-sprint 0, carried over unchanged (3)', eq(bd2.days.slice(0, 4).map(d => d.remaining), [9, 4, 1, 1]) && bd2.days[0].ideal === 13 && bd2.added.length === 0 && k2.kpis[3].value === '0' && k2.kpis[4].value === '3', { r: bd2.days.map(d => d.remaining), k: k2.kpis.map(x => x.value) });
    await run(p, `clickReset()`); await run(p, `setDim('assignee', ['Bob'])`); const ff3 = M.newF(); ff3.assignee = new Set(['Bob']);
    await verifySprint(p, BURN_T, ff3, 'Hand-made sprint, assignee Bob selected: burndown and KPIs follow the filter', BCTX);
    check('Hand-made sprint: no console errors', p.logs.length === 0, p.logs); }
  await p.close();
  for (const [name, want, label] of [['cnull', ['—', UI.sprint.hints.carriedNull], 'carriedOver null shows "Not calculated yet", never 0'], ['czero', ['0', '0% of tickets, 0 points'], 'zero carried over shows 0, which differs from not calculated'], ['cpart', ['5', '12 points'], 'a null percent is left out of the hint']]) {
    p = await open(url[name] + 'index.html');
    const read = () => run(p, `const k=kpi(${q(UI.sprint.kpi.carried)}); return [T(k.querySelector('.value')), T(k.querySelector('.hint'))]`);
    const a = await read(); await run(p, `clickRow(${q(ST.status)}, 'Done')`); const b = await read();
    check(`Carried over tile: ${label}; unchanged by filters; no console errors`, eq(a, want) && eq(b, want) && p.logs.length === 0, { a, b, logs: p.logs });
    if (name === 'cnull') {
      const clickable = await run(p, `return kpi(${q(UI.sprint.kpi.carried)}).classList.contains('clickable')`);
      check('Carried Over KPI without ticketKeys is visible but not clickable', clickable === false, clickable);
    }
    await p.close();
  }
  console.log('\n--- Removed tickets (sprint.removed) with hand-made data ---');
  p = await open(url.rem + 'index.html');
  await run(p, `AF.config.midSprintThresholdDays = 2; AF.store.reset()`); // hand-made data worked out for a 2-day threshold
  { const RJ = JSON.parse(mkSprint(Object.assign({ carriedOver: CARRIED, removed: REMOVED }, SP_OK))), RCTX = { sprint: RJ.sprint, today: RJ.refreshedAt, thr: 2 };
    await verifySprint(p, BURN_T, M.newF(), 'Removed: every tile and the burndown equal the independent calculation (with sprint.removed)', RCTX);
    const bd = await run(p, READ_BD);
    check('Removed (by hand): scope [16,18,13,13,15,15,15], remaining [12,9,1,1] then nothing, ideal falls from 16, one removal marker on 9/24 (2 tickets, 5 points), subtitle uses today\'s scope', eq(bd.days.map(d => d.scope), [16, 18, 13, 13, 15, 15, 15]) && eq(bd.days.map(d => d.remaining), [12, 9, 1, 1, null, null, null]) && eq(bd.days.map(d => Math.round(d.ideal * 1000) / 1000), [16, 13.333, 10.667, 8, 5.333, 2.667, 0]) && eq(bd.removed.map(r => [r.date, r.count, r.points]), [['2026-09-24', 2, 5]]) && bd.sub === '1 of 13 points remaining today, ideal 8', { days: bd.days, removed: bd.removed, sub: bd.sub });
    await p.resize(600, 900);
    { const lg = await run(p, `const s=tile(${q(ST.burndown)}).querySelector('svg.burndown'), w=+s.getAttribute('width'); const names=${q(UI.sprint.burndown.legendNames(2))}; const boxes=[...s.querySelectorAll('text')].filter(t=>names.includes(T(t))).map(t=>{const b=t.getBBox();return {name:T(t),x:b.x,right:b.x+b.width,bottom:b.y+b.height}}); const top=Math.min(...[...s.querySelectorAll('line')].filter(l=>+l.getAttribute('y1')===+l.getAttribute('y2') && +l.getAttribute('x1')<100 && +l.getAttribute('x2')>w-30).map(l=>+l.getAttribute('y1'))); return {w,boxes,top};`);
      check('Narrow burndown: two-row legend keeps every label inside the chart and above the plot', lg.boxes.length === 6 && lg.boxes.every(b => b.x >= 0 && b.right <= lg.w && b.bottom <= lg.top), lg); }
    await p.resize(1920, 1080);
    check('Removed: the added markers are unchanged (9/25 and 9/26 only; removed tickets are not "added")', eq(bd.added.map(a => a.date), ['2026-09-25', '2026-09-26']));
    check('Removed: the date labels sit below the removal triangles, which are red and point down', await run(p, `const g=document.querySelector('g.bd-removed'); const path=g.querySelector('path').getAttribute('d'); const m=path.match(/M([\\d.]+),([\\d.]+) L([\\d.]+),([\\d.]+) L([\\d.]+),([\\d.]+)/); return g.querySelector('path').getAttribute('fill')==='#d64545' && +m[6] > +m[2];`));
    const PANEL2 = `const b = tile(${q(ST.burndown)}); const pop = b.querySelector('.bd-pop'); return { open: !!pop, head: pop ? T(pop.querySelector('.bd-pop-head')) : null, rows: pop ? [...pop.querySelectorAll('tbody tr')].map(tr => [...tr.children].map(T)) : [], pressed: b.querySelector('g.bd-removed').getAttribute('aria-pressed'), tags: document.querySelectorAll('.tags .tag').length };`;
    await run(p, `clickEl(tile(${q(ST.burndown)}).querySelector('g.bd-removed'))`);
    { const r = await run(p, PANEL2);
      check('Removed: clicking the red triangle opens "Removed Sep. 24, 2026" listing exactly APP-950 and APP-951 (status at removal, assignee), aria-pressed true, no filter changed', r.open && r.head.startsWith('Removed Sep. 24, 2026') && r.head.includes('2 tickets, 5 points') && eq(r.rows, [['APP-950', 'gone one', '3', 'In Progress', 'Ann'], ['APP-951', 'gone two', '2', 'To Do', 'Bob']]) && r.pressed === 'true' && r.tags === 0, r); }
    await run(p, `document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true}))`);
    check('Removed: Escape closes the panel', !(await run(p, PANEL2)).open);
    await run(p, `setDim('assignee', ['Bob'])`); const fb = M.newF(); fb.assignee = new Set(['Bob']);
    await verifySprint(p, BURN_T, fb, 'Removed, assignee Bob selected: the removed ticket of another assignee drops out, the scope and markers follow the filter', RCTX);
    { const b2 = await run(p, READ_BD); check('Removed, Bob only: scope [5,7,5,5,7,7,7] and one removal marker (APP-951, 2 points)', eq(b2.days.map(d => d.scope), [5, 7, 5, 5, 7, 7, 7]) && eq(b2.removed.map(r => [r.date, r.count, r.points]), [['2026-09-24', 1, 2]]), { s: b2.days.map(d => d.scope), r: b2.removed }); }
    check('Removed: no console errors', p.logs.length === 0, p.logs); }
  await p.close();

  console.log('\n--- Needs attention today and Self-tested with hand-made data (copy of the app) ---');
  p = await open(url.attn + 'index.html');
  { const AJ = JSON.parse(mkSprint(Object.assign({ carriedOver: ATT_CARRIED }, SP_OK), '2026-09-25', ATT_T)), ACTX = { sprint: AJ.sprint, today: AJ.refreshedAt, thr: 1 };
    const A = UI.sprint.attention.reasons;
    await verifySprint(p, ATT_T, M.newF(), 'Attention data: every tile equals the independent calculation', ACTX);
    const a = (await run(p, READ_SPRINT)).attention;
    check('Attention (by hand): APP-805 Open 12* carried over; APP-801 In Review 9 long-running; APP-802 blocked by APP-804 only (APP-803 is Done); APP-804 blocker recorded; APP-807 blocked by APP-999 (outside the sprint); Done APP-806 and APP-810 (blocker Done) are left out', eq(a.rows.map(r => [r.key, r.status, r.days, r.reasons]), [['APP-805', 'Open', '12*', [A.carried]], ['APP-801', 'In Review', '9', [A.long]], ['APP-802', 'In Progress', '2', [A.blocked('APP-804')]], ['APP-804', 'In Progress', '1', [A.blocker]], ['APP-807', 'In Progress', '0', [A.blocked('APP-999')]]]) && a.sub === UI.sprint.attention.sub(5), a.rows);
    check('Attention (by hand): Missing line counts 1 no tester (APP-804 is Dev to Test, APP-812 QA to Test), 1 no fix version, 1 no story points', a.foot === UI.sprint.attention.missing(1, 1, 1), a.foot);
    check('Attention (by hand): no names (Ann, Tim, Bob) and no blocker text in the panel; blocker keys link to Jira', !['Ann', 'Tim', 'Bob', 'Zed Person', 'Waiting on', 'Old blocker'].some(x => a.text.includes(x)) && eq(a.rows.find(r => r.key === 'APP-802').links, [UI.jiraBrowse + 'APP-802', UI.jiraBrowse + 'APP-804']), a.text);
    const mx = (await run(p, READ_SPRINT)).matrix;
    check('Self-tested (by hand): Ann row = Tim 6, Self-tested 3 (APP-801 tester = assignee, APP-804 Dev to Test and APP-812 QA to Test without tester), Unassigned 1 (APP-808); Bob row = Ann 1, Tim 1 (Dev to Test and QA to Test with another tester); columns Tim, Ann, Self-tested, Unassigned; tooltips', eqObj(mx.o.Ann, { Tim: 6, 'Self-tested': 3, Unassigned: 1 }) && eqObj(mx.o.Bob, { Ann: 1, Tim: 1 }) && eq(mx.hdr, ['Assignee', 'Tim', 'Ann', 'Self-tested', 'Unassigned', 'Total']) && mx.titles[3] === UI.sprint.matrix.selfTestedTitle && mx.titles[4] === UI.sprint.matrix.unassignedTitle, mx);
    { const col = await run(p, `const hdr=[...tile(${q(ST.detail)}).querySelectorAll('thead th')].map(T), ix=hdr.indexOf('Self-tested'); return [...tile(${q(ST.detail)}).querySelectorAll('tbody tr')].map(tr=>[T(tr.children[0]), T(tr.children[ix])])`);
      check('Self-tested column (by hand): APP-801 Same person; APP-804 and APP-811 Dev to Test (also with another tester); APP-812 and APP-813 QA to Test; every other ticket a dash', eq(col, [['APP-801', 'Same person'], ['APP-802', '—'], ['APP-803', '—'], ['APP-804', 'Dev to Test'], ['APP-805', '—'], ['APP-806', '—'], ['APP-807', '—'], ['APP-808', '—'], ['APP-810', '—'], ['APP-811', 'Dev to Test'], ['APP-812', 'QA to Test'], ['APP-813', 'QA to Test']]), col); }
    await run(p, `clickCell(${q(ST.matrix)}, 'Ann', 'Self-tested')`); const fa = M.newF(); fa.assignee = new Set(['Ann']); fa.tester = new Set(['Self-tested']);
    const r = await verifySprint(p, ATT_T, fa, 'Attention data: the Ann / Self-tested cell filters every tile', ACTX);
    check('Self-tested (by hand): the cell lists APP-801, APP-804 and APP-812; the attention panel follows the filter (APP-812 is Done)', eq(r.d.detailKeys, ['APP-801', 'APP-804', 'APP-812']) && eq(r.d.attention.rows.map(x => x.key), ['APP-801', 'APP-804']), { detail: r.d.detailKeys, attention: r.d.attention.rows.map(x => x.key) });
    await run(p, `clickReset()`);
    await run(p, `clickRow(${q(ST.status)}, 'Done')`); const fd2 = M.newF(); fd2.status = new Set(['Done']);
    const r2 = await verifySprint(p, ATT_T, fd2, 'Attention data: status Done selected', ACTX);
    check('Attention (by hand): with only Done tickets the panel says nothing needs attention', r2.d.attention.empty === UI.sprint.attention.none && r2.d.attention.rows.length === 0, r2.d.attention);
    await run(p, `clickReset()`);
    check('Attention data: no console errors', p.logs.length === 0, p.logs); }
  await p.close();

  console.log('\n--- Jira links with odd data (copy of the app) ---');
  p = await open(url.links + 'index.html');
  { const odd = JSON.parse(linksSprint).tickets; const LO = await run(p, `return {ticket: colCells(${q(ST.detail)},'Ticket'), parent: colCells(${q(ST.detail)},'Parent'), linked: colCells(${q(ST.detail)},'Linked work items'), summary: colCells(${q(ST.detail)},'Summary'), situation: colCells(${q(ST.detail)},'Last sync update'), badEls: document.querySelectorAll('.tile-body img, .tile-body script, .tile-body iframe').length, allLinks:[...document.querySelectorAll('a.jira')].map(a=>a.getAttribute('href'))}`);
    check('Odd data: only valid keys become links; every other character stays text; nothing is lost', M.linkErrors(LO.parent, odd.map(t => t.parent)).length === 0 && M.linkErrors(LO.linked, odd.map(t => t.linkedWorkItems)).length === 0, [M.linkErrors(LO.parent, odd.map(t => t.parent)), M.linkErrors(LO.linked, odd.map(t => t.linkedWorkItems))]);
    check('Odd data: expected keys exactly (APP-5, DOC-6 in parent; APP-7, DOC-22, PLATENG-9 in linked work items)', eq(LO.parent[0].links.map(l => l.t), ['APP-5', 'DOC-6']) && eq(LO.linked[0].links.map(l => l.t), ['APP-7', 'DOC-22', 'PLATENG-9']), [LO.parent[0].links, LO.linked[0].links]);
    check('Odd data: no injected elements; all hrefs start with the Jira address; no javascript: link', LO.badEls === 0 && LO.allLinks.every(h => h.startsWith(UI.jiraBrowse)) && !LO.allLinks.some(h => /javascript:/i.test(h)), LO.allLinks);
    check('Odd data: a Ticket value that is not a key stays plain text; Summary and Last sync update are never linked', LO.ticket[1].links.length === 0 && LO.ticket[1].text === 'not a key' && LO.ticket[0].links.length === 1 && LO.situation[0].text === 'blocked by APP-98' && [...LO.summary, ...LO.situation].every(c => c.links.length === 0), [LO.ticket, LO.summary[0], LO.situation[0]]);
    check('Odd data: no console errors', p.logs.length === 0, p.logs); }
  await p.close();

  // =============== ERROR / EMPTY ===============
  console.log('\n--- Error and empty states ---');
  const states = [['missing', 'index', UI.errors.cantLoad('sprints.json'), 'Missing sprints.json (manifest)'], ['missing', 'backlog', UI.errors.cantLoad('backlog.json'), 'Missing backlog.json'], ['invalid', 'index', /Can’t load snapshots\/sprint-1\.json[\s\S]*not valid JSON/, 'Invalid sprint snapshot'], ['invalid', 'backlog', UI.errors.cantLoad('backlog.json'), 'Invalid backlog.json'], ['empty', 'index', UI.sprint.noTickets, 'Empty sprint snapshot'], ['empty', 'backlog', UI.backlog.noTickets, 'Empty backlog snapshot']];
  for (const [v, page, re, name] of states) {
    p = await open(`${url[v]}${page}.html`);
    const txt = await run(p, `return document.getElementById('app').innerText`);
    const isErr = v !== 'empty';
    check(`${name}: clear message${isErr ? ' with the regenerate command' : ''}, no blank page, no JS exception`, re.test(txt) && (!isErr || UI.errors.regenerate.test(txt)) && !p.logs.some(l => l.startsWith('exception')), { txt: txt.slice(0, 160), logs: p.logs.slice(0, 2) });
    await p.close();
  }
  for (const page of ['index', 'backlog', 'quality-intake']) { // C6, C7: a drawing bug says so instead of "can't load the file"
    p = await open(`${url.renderErr}${page}.html`);
    const txt = await run(p, `return document.getElementById('app').innerText`);
    check(`Render error on ${page}.html: "Can’t draw this page" (not a load error), no unhandled exception, the error is logged to the console`, UI.errors.cantDraw.test(txt) && !/Can’t load/.test(txt) && !p.logs.some(l => l.startsWith('exception')) && p.logs.some(l => /render error/i.test(l)), { txt: txt.slice(0, 200), logs: p.logs.slice(0, 3) });
    await p.close();
  }
  p = await open('file://' + path.join(SP, 'real', 'index.html'));
  const ft = await run(p, `return document.getElementById('app').innerText`);
  check('file:// open: message says to use the local server', UI.errors.openedAsFile.test(ft) && UI.errors.useServer.test(ft), ft.slice(0, 160));
  await p.close();

  // =============== STATIC ===============
  console.log('\n--- Static and safety checks ---');
  const codeOf = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
  const APP = files.APP_FILES;
  const ext = [];
  for (const f of APP) { const t = codeOf(f); (t.match(/(?:src|href)\s*=\s*"https?:\/\/[^"]+"|url\(\s*['"]?https?:/g) || []).forEach(m => ext.push(f + ': ' + m)); if (/@import|googleapis|cdn\./i.test(t)) ext.push(f + ': cdn/font/import'); if (/\bimport\s+.*from|require\(/.test(t)) ext.push(f + ': module import'); if (/XMLHttpRequest|WebSocket|sendBeacon/.test(t)) ext.push(f + ': network API'); }
  check('No external src/href/url(), CDN, @import, web font, module import or network API', ext.length === 0, ext);
  { const hits = []; APP.filter(f => /\.(html|js|css)$/.test(f)).forEach(f => { const m = codeOf(f).match(/atlassian\.net/g); if (m) hits.push(f + ' x' + m.length); });
    check('The Jira address appears once in the app source (one constant in dashboard.js)', eq(hits, ['dashboard.js x1']), hits); }
  const strip = f => codeOf(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
  const fetches = []; APP.filter(f => f.endsWith('.js')).forEach(f => (strip(f).match(/fetch\([^)]*\)/g) || []).forEach(m => fetches.push(f + ': ' + m)));
  check('Only one fetch() code path, loading a local relative JSON path via loadJson', fetches.length === 1 && /fetch\(file/.test(fetches[0]), fetches);
  check('No innerHTML / document.write / eval / inline style strings (setAttribute("style") or cssText) in app code (comments stripped)', APP.filter(f => f.endsWith('.js')).every(f => !/innerHTML|outerHTML|document\.write|\beval\(|new Function|setAttribute\(\s*['"]style|cssText/.test(strip(f))));
  { const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
    const pages = ['index.html', 'backlog.html', 'quality-intake.html'].map(f => ({ f, csp: (codeOf(f).match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/) || [])[1] || null, inline: /<script>(?!\s*<\/script>)|\sstyle="|\son[a-z]+="/i.test(codeOf(f)), probe: /deployment probe/i.test(codeOf(f)) }));
    check('Every page has the same Content-Security-Policy meta (self only, no inline script or style), no inline style/handler attributes, no leftover probe comment', pages.every(x => x.csp === CSP && !x.inline && !x.probe), pages); }
  { const r = spawnSync(process.execPath, ['--test', '--test-reporter=tap', path.join(__dirname, 'unit.test.js')], { encoding: 'utf8', timeout: 120000 });
    const summary = (r.stdout || '').split('\n').filter(l => /^# (tests|pass|fail)/.test(l)).join(', ');
    check('Unit tests (node --test scripts/unit.test.js) pass: ' + summary, r.status === 0, (r.stdout || '').split('\n').filter(l => /not ok|Error/.test(l)).slice(0, 8)); }

  // ---------- data conformance (one validator, lib/schema.js) ----------
  const snapSchema = J('schema/snapshot.schema.json'), manifestSchema = J('schema/sprints.schema.json'), qualitySchema = J('schema/quality-intake.schema.json');
  { const unsupported = [['snapshot', snapSchema], ['sprints', manifestSchema], ['quality-intake', qualitySchema]].map(([n, s]) => [n, unsupportedKeywords(s)]).filter(x => x[1].length);
    check('The harness validator implements every keyword the three schemas use', unsupported.length === 0, unsupported); }
  const strict = (data, def) => validate(snapSchema, data, 'root').concat(validate(snapSchema, data.tickets || [], 'tickets', { type: 'array', items: { $ref: '#/$defs/' + def } })).slice(0, 5);
  for (const entry of MANIFEST.sprints) {
    const exists = fs.existsSync(path.join(ROOT, entry.file));
    const data = exists ? J(entry.file) : null;
    const errs = exists ? strict(data, 'sprintTicket') : ['file missing'];
    const meta = data && data.sprint ? data.sprint.id === entry.id && data.sprint.startDate === entry.startDate && data.sprint.endDate === entry.endDate : false;
    check(`${entry.file} (${entry.state}) exists, conforms to the snapshot schema (strict sprintTicket shape) and matches its manifest entry (id, start, end)`, errs.length === 0 && meta, { errs, meta });
  }
  check('backlog.json conforms to the snapshot schema (strict backlogTicket shape)', strict(ctx.BJ, 'backlogTicket').length === 0, strict(ctx.BJ, 'backlogTicket'));
  { const FJ2 = JSON.parse(fixtureTxt); const errs = strict(FJ2, 'sprintTicket');
    check('fixtures/sample_snapshot.json conforms to the schema and covers the edge cases (carriedOver.ticketKeys, removed with a note, classifications, statusAging, statusAgingApprox)', errs.length === 0 && !!FJ2.sprint.carriedOver && Array.isArray(FJ2.sprint.carriedOver.ticketKeys) && Array.isArray(FJ2.sprint.removed) && FJ2.sprint.removed.some(r => 'note' in r) && FJ2.tickets.some(t => 'classifications' in t) && FJ2.tickets.some(t => typeof t.statusAging === 'number') && FJ2.tickets.some(t => t.statusAgingApprox === true), errs); }
  { const manifestConform = obj => { const errs = validate(manifestSchema, obj, 'manifest'); const ids = (obj.sprints || []).map(s => s.id), act = (obj.sprints || []).filter(s => s.state === 'active'); if (new Set(ids).size !== ids.length) errs.push('duplicate ids'); if (act.length !== 1 || act[0].id !== obj.current) errs.push('current must match exactly one active entry'); return errs.slice(0, 5); };
    const live = manifestConform(MANIFEST), fixture = manifestConform(J('fixtures/sprints.json'));
    check('sprints.json and the manifest fixture conform to the schema, with exactly one active current id and unique ids', live.length === 0 && fixture.length === 0, { live, fixture }); }
  { const errs = validate(qualitySchema, Q, 'quality-intake'); check('quality-intake.json conforms to schema/quality-intake.schema.json', errs.length === 0, errs.slice(0, 8)); }
}

// ---------- run ----------
(async () => {
  let harnessError = null;
  if (!fs.existsSync(CH)) harnessError = new Error('Chrome not found at ' + CH + '. Set CHROME_PATH.');
  else { try { await main(); } catch (e) { harnessError = e; } }
  const failed = results.filter(r => !r.ok);
  console.log(`\nTOTAL ${results.length}  PASS ${results.length - failed.length}  FAIL ${failed.length}` + (skips.length ? `  SKIP ${skips.length}` : ''));
  failed.forEach(x => console.log('FAILED: ' + x.name + ' ' + String(JSON.stringify(x.detail)).slice(0, 500)));
  fs.mkdirSync(SP, { recursive: true });
  fs.writeFileSync(path.join(SP, 'acceptance_results.json'), JSON.stringify({ results, skips, harnessError: harnessError ? String(harnessError.stack || harnessError) : null }, null, 1));
  const clean = !harnessError && !failed.length;
  if (clean && OWN_SCRATCH) { await sleep(300); fs.rmSync(SP, { recursive: true, force: true }); }
  else console.log('Results and screenshots kept in: ' + SP);
  if (harnessError) { console.error('HARNESS ERROR', harnessError); process.exit(2); }
  process.exit(failed.length ? 1 : 0);
})();
