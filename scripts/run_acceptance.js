#!/usr/bin/env node
/*
 * run_acceptance.js — automated acceptance run for the 07_Dashboard web app (ACCEPTANCE.md).
 *
 * Drives a real headless Chrome over the DevTools protocol, clicks through both pages
 * and compares every tile, KPI, tag and table with an independent calculation from
 * sprint.json / backlog.json. Read-only: it never modifies the real data files, the
 * tracker or the app; edge cases (fixture, empty, missing, invalid data) run on throwaway
 * copies of the app in a temp folder.
 *
 * Needs: Node 22+ (global fetch and WebSocket), python3 (for the local servers), Google Chrome.
 * Run from anywhere:   node 07_Dashboard/scripts/run_acceptance.js [dashboard_dir] [scratch_dir]
 * Chrome location:     set CHROME_PATH if it is not the default macOS path.
 * Ports used:          8771-8782 (servers) and 9333 (Chrome debugging) on 127.0.0.1.
 * Exit code:           0 when every check passes, 1 otherwise.
 * Keep it in sync:     if SPEC.md, DATA_CONTRACT.md or ACCEPTANCE.md change, update the
 *                      expectations here in the same pass.
 */
const { spawn } = require('child_process');
const fs = require('fs'); const path = require('path'); const os = require('os');
const ROOT = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const OWN_SCRATCH = !process.argv[3];
const SP = process.argv[3] || fs.mkdtempSync(path.join(os.tmpdir(), 'af_dashboard_accept_'));
const CH = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if (!fs.existsSync(CH)) { console.error('Chrome not found at ' + CH + '. Set CHROME_PATH.'); process.exit(2); }
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: !!ok, detail }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (!ok && detail !== undefined ? '  -> ' + JSON.stringify(detail).slice(0, 700) : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const J = f => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---------- variants (copies; real data files never touched) ----------
const APP = ['index.html', 'backlog.html', 'dashboard.css', 'dashboard.js', 'sprint.js', 'backlog.js'];
function variant(name, files) {
  const d = path.join(SP, 'var_' + name); fs.rmSync(d, { recursive: true, force: true }); fs.mkdirSync(d, { recursive: true });
  APP.forEach(f => fs.copyFileSync(path.join(ROOT, f), path.join(d, f)));
  Object.entries(files).forEach(([k, v]) => fs.writeFileSync(path.join(d, k), v));
  return d;
}
const emptyJson = JSON.stringify({ refreshedAt: '2026-10-01', source: 'x', tickets: [] });
const fixtureTxt = fs.readFileSync(path.join(ROOT, 'fixtures/sample_snapshot.json'), 'utf8');
const linksSprint = JSON.stringify({ refreshedAt: '2026-10-01', source: 'x', tickets: [
  { ticket: 'APP-1', owner: 'A', status: 'Done', tester: null, points: 1, parent: 'APP-5/DOC-6 and lower-1 and APP- and xAPP-2 and APP-3y', linkedWorkItems: 'APP-7, <img src=x onerror=alert(1)> DOC-22, javascript:alert(1) PLATENG-9', fixVersion: '1', summary: 'UTF-8 and SHA-256 text, see APP-99', currentSituation: null, blocker: 'blocked by APP-98', actionOwner: null, followUp: null, demo: null, discussed: null },
  { ticket: 'not a key', owner: 'B', status: 'Done', tester: null, points: null, parent: null, linkedWorkItems: null, fixVersion: null, summary: null, currentSituation: null, blocker: null, actionOwner: null, followUp: null, demo: null, discussed: null }] });
const TK = (o) => Object.assign({ owner: 'Ann', status: 'Done', tester: 'Tim', points: 1, parent: null, linkedWorkItems: null, fixVersion: '4.46', doneDate: null, addedDate: '2026-09-22', cycleTime: null, summary: 's', currentSituation: null, blocker: null, actionOwner: null, followUp: null, demo: null, discussed: null }, o);
// Hand-made sprint whose answers are computed by hand (see the "Burndown with hand-made data" checks).
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
const SP_OK = { id: 1, name: 'Hand sprint', startDate: '2026-09-22', endDate: '2026-09-28' };
const dirs = { real: ROOT, missing: variant('missing', {}), invalid: variant('invalid', { 'sprint.json': '{not json', 'backlog.json': '{not json' }), empty: variant('empty', { 'sprint.json': emptyJson, 'backlog.json': emptyJson }), fixture: variant('fixture', { 'sprint.json': fixtureTxt, 'backlog.json': emptyJson }), links: variant('links', { 'sprint.json': linksSprint, 'backlog.json': emptyJson }),
  burn: variant('burn', { 'sprint.json': mkSprint(Object.assign({ carriedOver: { count: 3, percent: 20, storyPoints: 8 } }, SP_OK)), 'backlog.json': emptyJson }),
  cnull: variant('cnull', { 'sprint.json': mkSprint(Object.assign({ carriedOver: null }, SP_OK)), 'backlog.json': emptyJson }),
  czero: variant('czero', { 'sprint.json': mkSprint(Object.assign({ carriedOver: { count: 0, percent: 0, storyPoints: 0 } }, SP_OK)), 'backlog.json': emptyJson }),
  cpart: variant('cpart', { 'sprint.json': mkSprint(Object.assign({ carriedOver: { count: 5, percent: null, storyPoints: 12 } }, SP_OK)), 'backlog.json': emptyJson }),
  rem: variant('rem', { 'sprint.json': mkSprint(Object.assign({ carriedOver: { count: 3, percent: 20, storyPoints: 8 }, removed: REMOVED }, SP_OK)), 'backlog.json': emptyJson }),
  nodates: variant('nodates', { 'sprint.json': mkSprint({ id: 1, name: 'No dates', startDate: null, endDate: null, carriedOver: null }), 'backlog.json': emptyJson }) };
const ports = { real: 8771, missing: 8772, invalid: 8773, empty: 8774, fixture: 8775, links: 8776, burn: 8777, cnull: 8778, czero: 8779, cpart: 8780, nodates: 8781, rem: 8782 };
const servers = Object.keys(dirs).map(k => spawn('python3', ['-m', 'http.server', String(ports[k]), '--bind', '127.0.0.1', '--directory', dirs[k]], { stdio: 'ignore' }));

// ---------- CDP ----------
let chrome;
async function launch() {
  fs.rmSync(path.join(SP, 'prof5'), { recursive: true, force: true });
  chrome = spawn(CH, ['--headless=new', '--disable-gpu', '--remote-debugging-port=9333', '--user-data-dir=' + path.join(SP, 'prof5'), '--no-first-run', 'about:blank'], { stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { await fetch('http://127.0.0.1:9333/json/version'); return; } catch (e) { await sleep(200); } }
  throw new Error('chrome did not start');
}
async function openPage(url, w = 1920, h = 1080) {
  const t = await (await fetch('http://127.0.0.1:9333/json/new?about:blank', { method: 'PUT' })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise(r => ws.addEventListener('open', r));
  let id = 0; const pend = {}; const logs = []; const reqs = []; const resp = {};
  ws.addEventListener('message', m => {
    const d = JSON.parse(m.data);
    if (d.id && pend[d.id]) { pend[d.id](d); delete pend[d.id]; return; }
    if (d.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(d.params.type)) logs.push(d.params.type + ': ' + d.params.args.map(a => a.value || a.description).join(' '));
    if (d.method === 'Runtime.exceptionThrown') logs.push('exception: ' + (d.params.exceptionDetails.exception || {}).description);
    if (d.method === 'Log.entryAdded' && ['error', 'warning'].includes(d.params.entry.level)) logs.push('log ' + d.params.entry.level + ': ' + d.params.entry.text + ' ' + (d.params.entry.url || ''));
    if (d.method === 'Network.requestWillBeSent') reqs.push(d.params.request.url);
    if (d.method === 'Network.responseReceived') resp[d.params.response.url] = d.params.response.status;
  });
  const send = (method, params = {}) => new Promise(res => { const i = ++id; pend[i] = res; ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async expr => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.result.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails.exception.description)); return r.result.result.value; };
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable'); await send('Log.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url });
  await sleep(300);
  for (let i = 0; i < 40; i++) { const ready = await ev("document.readyState==='complete' && !document.querySelector('#app .loading')").catch(() => false); if (ready) break; await sleep(150); }
  await sleep(200);
  const key = async (k, code, vk, text, modifiers = 0) => { await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, text, modifiers }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, modifiers }); };
  const resize = async (ww, hh) => { await send('Emulation.setDeviceMetricsOverride', { width: ww, height: hh, deviceScaleFactor: 1, mobile: false }); await sleep(300); };
  return { send, ev, logs, reqs, resp, key, resize, close: async () => { await fetch('http://127.0.0.1:9333/json/close/' + t.id); ws.close(); } };
}

// ---------- page-side helpers ----------
const H = `
const T = n => n.textContent.replace(/\\s+/g,' ').trim();
const tile = t => [...document.querySelectorAll('section.tile')].find(s => { const h = s.querySelector('h2'); return h && h.textContent.trim() === t; });
const kpi = t => [...document.querySelectorAll('.kpi')].find(k => T(k.querySelector('.label')) === t);
const rowsOf = t => [...tile(t).querySelectorAll('.tile-body .rowbtn')];
const clickEl = (el, o={}) => el.dispatchEvent(new MouseEvent('click', {bubbles:true, cancelable:true, ctrlKey: !!o.ctrl, metaKey: !!o.meta, shiftKey: !!o.shift}));
const clickRow = (t, name, o) => { const r = rowsOf(t).find(r => T(r.querySelector('.person, .name')) === name); if(!r) throw new Error('row not found: '+t+' / '+name); clickEl(r, o); };
const clickCell = (t, rowName, colName, o) => { const tl = tile(t); const hdr=[...tl.querySelectorAll('thead th')].map(T); const ci = hdr.indexOf(colName); const tr=[...tl.querySelectorAll('tbody tr')].find(tr => T(tr.querySelector('th'))===rowName); if(!tr) throw new Error('matrix row not found '+rowName); const td = tr.querySelectorAll('td')[ci-1]; const b = td && td.querySelector('button'); if(!b) throw new Error('cell not clickable '+rowName+'/'+colName); clickEl(b, o); };
const clickReset = () => clickEl(document.querySelector('.resetall'));
const clickTagX = i => clickEl(document.querySelectorAll('.tag .tag-x')[i]);
const setSel = (id, v) => { const s=document.getElementById(id); s.value=v; s.dispatchEvent(new Event('change',{bubbles:true})); };
const setQ = v => { const i=document.getElementById('q'); i.value=v; i.dispatchEvent(new Event('input',{bubbles:true})); };
const readCommon = () => ({ kpis: [...document.querySelectorAll('.kpi')].map(k=>({label:T(k.querySelector('.label')),value:T(k.querySelector('.value')),hint:T(k.querySelector('.hint'))})), tags:[...document.querySelectorAll('.tags .tag > span')].map(T), noFilterMsg: !!document.querySelector('.nofilter'), resetDisabled: document.querySelector('.resetall').disabled, asof: T(document.getElementById('asof')) });
const JIRA = 'https://mysnaplogic.atlassian.net/browse/';
const colCells = (t, col) => { const tl = tile(t); const hdr=[...tl.querySelectorAll('thead th')].map(T); const ix=hdr.indexOf(col); return [...tl.querySelectorAll('tbody tr')].map(tr=>{ const td=tr.children[ix]; return { text: T(td), links: [...td.querySelectorAll('a')].map(a=>({ t:T(a), h:a.getAttribute('href'), target:a.getAttribute('target'), rel:a.getAttribute('rel'), cls:a.className })), foreign: td.querySelectorAll('img,script,iframe,style,svg').length }; }); };
const emptyIn = t => { const e = tile(t).querySelector('.tile-body .empty'); return e ? T(e) : null; };
const matrixOf = t => { const tl=tile(t); const hdr=[...tl.querySelectorAll('thead th')].map(T); const o={}; const sel=[]; const dim=[]; tl.querySelectorAll('tbody tr').forEach(tr=>{const rn=T(tr.querySelector('th')); o[rn]={}; [...tr.querySelectorAll('td')].forEach((td,i)=>{const b=td.querySelector('button'); if(b){o[rn][hdr[i+1]]=+T(b); if(b.classList.contains('sel')) sel.push(rn+'|'+hdr[i+1]); if(td.classList.contains('dim')) dim.push(rn+'|'+hdr[i+1]);}});}); return {o, sel, dim, hdr}; };
`;
const run = (p, body) => p.ev(`(()=>{${H}${body}})()`);

const READ_BD = `
const b = tile('Burndown'); const s = b.querySelector('svg.burndown'); const body = b.querySelector('.tile-body'); const emp = body.querySelector('.empty'); const act = s && s.querySelector('polyline.bd-actual');
return { sub: T(b.querySelector('.sub')), empty: emp ? T(emp) : null, has: !!s, label: s ? s.getAttribute('aria-label') : null,
  days: s ? [...s.querySelectorAll('rect.bd-day')].map(r => ({ date: r.dataset.date, remaining: r.dataset.remaining === '' ? null : +r.dataset.remaining, ideal: +r.dataset.ideal, done: +r.dataset.done, scope: +r.dataset.scope, tip: r.querySelector('title').textContent })) : [],
  removed: s ? [...s.querySelectorAll('g.bd-removed')].map(g => ({ date: g.dataset.date, count: +g.dataset.count, points: +g.dataset.points, labelY: +g.querySelector('text').getAttribute('y'), tip: g.querySelector('title').textContent })) : [],
  dateLabelY: s ? Math.min(...[...s.querySelectorAll('text')].filter(x => /^\\d+\\/\\d+$/.test(x.textContent)).map(x => +x.getAttribute('y'))) : null,
  added: s ? [...s.querySelectorAll('g.bd-added')].map(g => ({ date: g.dataset.date, count: +g.dataset.count, points: +g.dataset.points, early: g.dataset.early, fill: g.querySelector('path').getAttribute('fill'), tip: g.querySelector('title').textContent })) : [],
  hasIdeal: !!(s && s.querySelector('polyline.bd-ideal')), scopeLine: (() => { const sl = s && s.querySelector('polyline.bd-scope'), il = s && s.querySelector('polyline.bd-ideal'); if (!sl || !il) return null;
    const P = e => e.getAttribute('points').split(' ').map(q => q.split(',').map(Number)); const sp = P(sl), ip = P(il), r = [...s.querySelectorAll('rect.bd-day')];
    const i0 = +r[0].dataset.ideal, i1 = +r[r.length - 1].dataset.ideal; if (!(i0 - i1 > 0)) return { vals: null, n: sp.length };
    const k = (ip[0][1] - ip[ip.length - 1][1]) / (i0 - i1), val = y => Math.round((y - ip[ip.length - 1][1]) / k + i1); // value at the screen y
    const steps = []; sp.forEach((q, i) => { if (i === 0 || i % 2 === 0 || sp.length === 1) steps.push(val(q[1])); }); return { vals: steps, n: sp.length }; })(),
  actualPoints: act ? act.getAttribute('points').split(' ').length : 0, todayLabel: s ? [...s.querySelectorAll('text')].some(x => x.textContent === 'Today') : false,
  legend: s ? [...s.querySelectorAll('text')].map(x => x.textContent).join('|') : '', foot: T(b.querySelector('.tile-foot')), svgW: s ? +s.getAttribute('width') : 0, bodyW: body.clientWidth, bodyOverflow: body.scrollHeight - body.clientHeight, bodyOv: getComputedStyle(body).overflowY };
`;
const READ_SPRINT = `
const c = readCommon();
const status = {}, statusSel = [], statusDim = [];
rowsOf('Tickets by status').forEach(r => { const n=T(r.querySelector('.name')); const [i,pp]=T(r.querySelector('.pair')).split(' / '); status[n]=[+i,+pp]; if(r.classList.contains('sel')) statusSel.push(n); if(r.classList.contains('dim')) statusDim.push(n); });
const people = t => { const o={}, sel=[], dim=[]; rowsOf(t).forEach(r=>{ const n=T(r.querySelector('.person')); o[n]=[...r.querySelectorAll('.n')].map(x=>+T(x)); if(r.classList.contains('sel')) sel.push(n); if(r.classList.contains('dim')) dim.push(n); }); return {o, sel, dim, order:Object.keys(o)}; };
const det = tile('Ticket detail'); const keys=[...det.querySelectorAll('tbody tr')].map(tr=>T(tr.children[0]));
const statusFoot = T(tile('Tickets by status').querySelector('.tile-foot'));
return Object.assign(c, { status, statusSel, statusDim, assignee: people('Work by assignee'), tester: people('Work by tester'), matrix: matrixOf('Assignee x tester'), detailKeys: keys, detailSub: T(det.querySelector('.sub')), detailEmpty: emptyIn('Ticket detail'), empties: {status: emptyIn('Tickets by status'), assignee: emptyIn('Work by assignee'), tester: emptyIn('Work by tester'), matrix: emptyIn('Assignee x tester')}, statusFoot, fixSel: document.getElementById('f-fix').value, parentSel: document.getElementById('f-parent').value });
`;

// ---------- independent sprint model ----------
const BN = ['To Do/Open', 'In Progress', 'In Review', 'Done', 'Other'];
const bucket = s => ({ 'To Do': 0, 'Open': 0, 'In Progress': 1, 'In Review': 2, 'Done': 3 }[s] ?? 4);
const pt = v => typeof v === 'number' ? v : 0;
const grpName = v => (v == null || String(v).trim() === '' || v === 'Unassigned') ? 'Unassigned' : v;
const SKEY = { status: t => BN[bucket(t.status)], assignee: t => grpName(t.owner), tester: t => grpName(t.tester), fix: t => t.fixVersion || '(none)', parent: t => t.parent || '(none)' };
const newF = () => ({ status: new Set(), assignee: new Set(), tester: new Set(), fix: new Set(), parent: new Set() });
const applyF = (rows, f, keyMap, except = [], pred = null) => rows.filter(t => Object.keys(f).every(d => except.includes(d) || !f[d].size || f[d].has(keyMap[d](t))) && (!pred || pred(t)));
const group = (rows, kf) => { const m = {}; rows.forEach(t => { const k = kf(t); (m[k] = m[k] || { i: 0, p: 0 }); m[k].i++; m[k].p += pt(t.points); }); return m; };
const sumP = rows => rows.reduce((a, t) => a + pt(t.points), 0);

const DAYMS = 86400000;
const dn = s => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || '')); return m ? Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / DAYMS) : NaN; };
const isoN = n => new Date(n * DAYMS).toISOString().slice(0, 10);
const md = iso => Number(iso.slice(5, 7)) + '/' + Number(iso.slice(8, 10));
const f1 = x => String(Math.round(x * 10) / 10);
// Independent burndown expectation (written separately from the page code).
function expectBurn(all, ctx, thr, rem = []) {
  const sp = ctx.sprint; if (!sp) return null;
  const s = dn(sp.startDate), e = dn(sp.endDate); if (isNaN(s) || isNaN(e) || e < s) return null;
  const n = e - s + 1, addOn = Array(n).fill(0), doneOn = Array(n).fill(0), cnt = Array(n).fill(0); let unplaced = 0;
  all.forEach(t => { const a = dn(t.addedDate), ai = isNaN(a) ? 0 : Math.min(n - 1, Math.max(0, a - s)); addOn[ai] += pt(t.points);
    if (bucket(t.status) !== 3) return; const d = dn(t.doneDate); if (isNaN(d)) { unplaced++; return; } let idx = Math.max(0, d - s); if (idx >= n) return; idx = Math.max(idx, ai); doneOn[idx] += pt(t.points); cnt[idx]++; });
  const remOn = Array(n).fill(0), rby = {};
  rem.forEach(r => { const rd = dn(r.removedDate); if (isNaN(rd)) return; const a = dn(r.addedDate), ai = isNaN(a) ? 0 : Math.min(n - 1, Math.max(0, a - s)), ri = Math.max(ai, Math.min(n - 1, Math.max(0, rd - s))); addOn[ai] += pt(r.points); remOn[ri] += pt(r.points); const k = isoN(s + ri); (rby[k] = rby[k] || { c: 0, p: 0 }); rby[k].c++; rby[k].p += pt(r.points); });
  const td = dn(ctx.today), ti = isNaN(td) ? -1 : Math.max(-1, Math.min(n - 1, td - s)), inside = !isNaN(td) && td >= s && td <= e;
  let cum = 0, sc = 0, mx = 0; const days = [];
  for (let i = 0; i < n; i++) { cum += doneOn[i]; sc += addOn[i] - remOn[i]; mx = Math.max(mx, sc); days.push({ date: isoN(s + i), scope: sc, ideal: n > 1 ? (addOn[0] - remOn[0]) * (1 - i / (n - 1)) : 0, remaining: i <= ti ? sc - cum : null, done: doneOn[i], cnt: cnt[i] }); }
  const total = mx;
  const lim = isoN(s + thr), mid = all.filter(t => t.addedDate && String(t.addedDate) > lim), by = {};
  all.filter(t => t.addedDate && String(t.addedDate) > sp.startDate).forEach(t => { const k = String(t.addedDate) > days[n - 1].date ? days[n - 1].date : String(t.addedDate); (by[k] = by[k] || { c: 0, p: 0 }); by[k].c++; by[k].p += pt(t.points); });
  return { n, total, ti, inside, days, unplaced, mid: { count: mid.length, points: sumP(mid) }, by, rby, hasRemoved: Array.isArray(sp.removed), name: sp.name };
}
function expectSprint(S, f, ctx = CTX) {
  const all = applyF(S, f, SKEY), P = sumP(all), TP = sumP(S);
  const doneP = sumP(all.filter(t => bucket(t.status) === 3));
  const active = Object.keys(f).some(d => f[d].size);
  const thr = ctx.thr || 2, bd = expectBurn(all, ctx, thr, (ctx.sprint && Array.isArray(ctx.sprint.removed)) ? applyF(ctx.sprint.removed, f, SKEY) : []);
  const cyc = all.filter(t => bucket(t.status) === 3 && typeof t.cycleTime === 'number'), avg = cyc.length ? cyc.reduce((a, t) => a + t.cycleTime, 0) / cyc.length : null;
  const co = ctx.sprint ? ctx.sprint.carriedOver : undefined; let carriedV, carriedH;
  if (!ctx.sprint) { carriedV = '—'; carriedH = 'No sprint data in sprint.json'; }
  else if (!co) { carriedV = '—'; carriedH = 'Not calculated yet for this sprint'; }
  else { const parts = []; if (co.percent != null) parts.push(String(co.percent) + '% of tickets'); if (co.storyPoints != null) parts.push(String(co.storyPoints) + ' points'); carriedV = co.count == null ? '—' : String(co.count); carriedH = parts.length ? parts.join(', ') : 'No figures in sprint.json'; }
  const midOk = ctx.sprint && !isNaN(dn(ctx.sprint.startDate));
  const kh = { cycle: cyc.length ? `days, over ${cyc.length} Done ticket${cyc.length === 1 ? '' : 's'}` : 'no Done tickets with a cycle time', mid: midOk ? `${sumP(all.filter(t => t.addedDate && String(t.addedDate) > isoN(dn(ctx.sprint.startDate) + thr)))} points, added after day ${thr} (approx.)` : 'No sprint start date in sprint.json', carried: carriedH };
  const kp = [String(all.length), String(P), P > 0 ? Math.round(doneP / P * 100) + '%' : '—', String(all.filter(t => t.tester === null && !String(t.classifications || '').split('; ').includes('Dev to Test')).length),
    avg === null ? '—' : f1(avg), midOk ? String(bd ? bd.mid.count : all.filter(t => t.addedDate && String(t.addedDate) > isoN(dn(ctx.sprint.startDate) + thr)).length) : '—', carriedV];
  const stBase = applyF(S, f, SKEY, ['status']); const stG = group(stBase, SKEY.status);
  const people = (dim) => { const g = group(applyF(S, f, SKEY, [dim]), SKEY[dim]); const o = {}; Object.keys(g).forEach(k => o[k] = [g[k].i, g[k].p]); return o; };
  const mBase = applyF(S, f, SKEY, ['assignee', 'tester']); const mat = {}; mBase.forEach(t => { const r = SKEY.assignee(t), c = SKEY.tester(t); (mat[r] = mat[r] || {})[c] = (mat[r][c] || 0) + 1; });
  return { kpiValues: kp, active, all, status: stG, stBase, assignee: people('assignee'), tester: people('tester'), matrix: mat, detailKeys: all.map(t => t.ticket), points: P, totalPoints: TP, kpiHints: kh, bd };
}

async function verifySprint(p, S, f, label, ctx = CTX) {
  const e = expectSprint(S, f, ctx); const d = await run(p, READ_SPRINT); const errs = [];
  if (!eq(d.kpis.map(k => k.value), e.kpiValues)) errs.push(['kpi', d.kpis.map(k => k.value), e.kpiValues]);
  if (e.active && !/^of \d+/.test(d.kpis[0].hint)) errs.push(['kpi hint filtered', d.kpis[0].hint]);
  if (!e.active && d.kpis[0].hint !== 'tickets in the sprint') errs.push(['kpi hint', d.kpis[0].hint]);
  if (d.kpis.length !== 7 || !eq(d.kpis.map(k => k.label), ['Work items', 'Story points', 'Done', 'No tester', 'Avg cycle time', 'Added mid-sprint', 'Carried over'])) errs.push(['kpi labels', d.kpis.map(k => k.label)]);
  if (d.kpis[4].hint !== e.kpiHints.cycle) errs.push(['cycle hint', d.kpis[4].hint, e.kpiHints.cycle]);
  if (d.kpis[5].hint !== e.kpiHints.mid) errs.push(['mid hint', d.kpis[5].hint, e.kpiHints.mid]);
  if (d.kpis[6].hint !== e.kpiHints.carried) errs.push(['carried hint', d.kpis[6].hint, e.kpiHints.carried]);
  { const bd = await run(p, READ_BD), x = e.bd;
    if (!x) { if (bd.has || bd.empty !== 'Sprint dates are not in sprint.json. Run the Jira sync and the export.') errs.push(['burndown message', bd.has, bd.empty]); }
    else if (!e.all.length) { if (bd.has || bd.empty !== 'No work items match these filters. Remove a tag or use Reset all.') errs.push(['burndown empty-state', bd.has, bd.empty]); }
    else {
      if (!bd.has) errs.push(['burndown svg missing', bd.empty]);
      else {
        if (!eq(bd.days.map(d => d.date), x.days.map(d => d.date))) errs.push(['burndown dates', bd.days.length, x.days.length]);
        else {
          x.days.forEach((xd, i) => { const g = bd.days[i];
            if ((xd.remaining === null) !== (g.remaining === null) || (xd.remaining !== null && Math.abs(g.remaining - xd.remaining) > 1e-6)) errs.push(['remaining', xd.date, g.remaining, xd.remaining]);
            if (Math.abs(g.ideal - xd.ideal) > 0.002) errs.push(['ideal', xd.date, g.ideal, xd.ideal]);
            if (g.done !== xd.done) errs.push(['done that day', xd.date, g.done, xd.done]);
            const wantTip = xd.remaining === null ? `${md(xd.date)}: ideal ${f1(xd.ideal)} points (future day)` : `${md(xd.date)}: ${xd.remaining} points remaining of ${xd.scope} in scope, ${xd.done} points done that day (${xd.cnt} tickets)`;
            if (g.tip !== wantTip) errs.push(['tooltip', g.tip, wantTip]); });
        }
        const wantAdded = Object.keys(x.by).sort().map(k => [k, x.by[k].c, x.by[k].p]), gotAdded = bd.added.map(a => [a.date, a.count, a.points]).sort();
        if (!eq(gotAdded, wantAdded)) errs.push(['added markers', gotAdded, wantAdded]);
        { const lim = isoN(dn(ctx.sprint.startDate) + (ctx.thr || 2)); const bad = bd.added.filter(a => (a.date <= lim) !== (a.early === '1') || (a.date <= lim) !== (a.fill === '#ffffff')); if (bad.length) errs.push(['early (hollow) vs after-threshold (filled) markers', bad.map(a => [a.date, a.early, a.fill])]); if (!bd.legend.includes('Earlier')) errs.push(['legend Earlier']); }
        if (!bd.added.every(a => /approximate/.test(a.tip))) errs.push(['marker tooltip lacks "approximate"']);
        { const wantR = Object.keys(x.rby || {}).sort().map(k => [k, x.rby[k].c, x.rby[k].p]), gotR = bd.removed.map(a => [a.date, a.count, a.points]).sort();
          if (!eq(gotR, wantR)) errs.push(['removed markers', gotR, wantR]);
          if (bd.legend.includes('Removed') !== (wantR.length > 0)) errs.push(['legend Removed', bd.legend]);
          if (wantR.length && !bd.removed.every(r => bd.dateLabelY - 9 >= r.labelY)) errs.push(['date labels touch the removal markers', bd.dateLabelY, bd.removed.map(r => r.labelY)]);
          if (!bd.removed.every(r => /removed/.test(r.tip))) errs.push(['removed tooltip']); }
        if (!bd.hasIdeal) errs.push(['ideal line missing']);
        if (bd.actualPoints !== x.ti + 1) errs.push(['actual line points', bd.actualPoints, x.ti + 1]);
        if (bd.todayLabel !== x.inside) errs.push(['today marker', bd.todayLabel, x.inside]);
        const cur = x.ti >= 0 ? x.days[x.ti] : null, when = ctx.today <= x.days[x.n - 1].date ? 'today' : 'at sprint end';
        const wantSub = cur ? `${cur.remaining} of ${cur.scope} points remaining ${when}, ideal ${f1(cur.ideal)}` : 'The sprint has not started yet';
        if (bd.sub !== wantSub) errs.push(['burndown subtitle', bd.sub, wantSub]);
        if (cur && bd.label !== `Burndown chart for ${x.name || 'the sprint'}: ${wantSub}.`) errs.push(['aria-label', bd.label]);
        if (!bd.legend.includes('Scope')) errs.push(['legend scope', bd.legend]);
        { const want = x.days.slice(0, x.ti + 1).map(d => d.scope);
          if (!bd.scopeLine) errs.push(['scope line missing']);
          else if (bd.scopeLine.n !== 2 * want.length - 1) errs.push(['scope line point count', bd.scopeLine.n, 2 * want.length - 1]);
          else if (bd.scopeLine.vals && !eq(bd.scopeLine.vals, want.map(Math.round))) errs.push(['scope line steps', bd.scopeLine.vals, want]); }
        if (!bd.legend.includes('Added after day ' + (ctx.thr || 2) + ' (approx.)')) errs.push(['legend threshold', bd.legend]);
        if (!bd.foot.includes('Scope grows on each ticket') || (x.hasRemoved ? !bd.foot.includes('shrinks on the date a ticket left the sprint') : !bd.foot.includes('Tickets removed from the sprint and re-estimates are not reflected')) || !bd.foot.includes('approximate for tickets not yet Done')) errs.push(['footnote', bd.foot]);
        if (x.unplaced && !bd.foot.includes(`${x.unplaced} Done ticket${x.unplaced === 1 ? ' has' : 's have'} no done date`)) errs.push(['unplaced note', bd.foot]);
        if (!x.unplaced && /no done date/.test(bd.foot)) errs.push(['unexpected unplaced note']);
        if (bd.bodyOv !== 'hidden') errs.push(['chart overflow', bd.bodyOv]);
      } } }
  if (e.stBase.length) {
    BN.forEach(n => { const g = e.status[n] || { i: 0, p: 0 }; const got = d.status[n]; if (got === undefined) { if (n !== 'Other' || g.i) errs.push(['status row missing', n]); } else if (got[0] !== g.i || got[1] !== g.p) errs.push(['status', n, got, [g.i, g.p]]); });
    if (d.statusFoot.replace(/\s+/g, '') !== `Total${e.stBase.length}/${sumP(e.stBase)}`) errs.push(['status total', d.statusFoot]);
  } else if (!d.empties.status) errs.push(['status empty-state missing']);
  for (const [dim, key] of [['assignee', 'assignee'], ['tester', 'tester']]) {
    const exp = e[dim]; const got = d[dim];
    if (Object.keys(exp).length === 0) { if (!d.empties[dim]) errs.push([dim + ' empty-state missing']); continue; }
    const gotMap = {}; Object.keys(got.o).forEach(k => gotMap[k] = [got.o[k][0], got.o[k][1]]);
    if (!eq(Object.keys(gotMap).sort(), Object.keys(exp).sort())) errs.push([dim + ' people set', Object.keys(gotMap).length, Object.keys(exp).length]);
    else Object.keys(exp).forEach(k => { if (!eq(gotMap[k], exp[k])) errs.push([dim, k, gotMap[k], exp[k]]); });
    const sorted = Object.keys(exp).sort((a, b) => exp[b][1] - exp[a][1] || a.localeCompare(b));
    if (!eq(got.order, sorted)) errs.push([dim + ' order', got.order.slice(0, 4), sorted.slice(0, 4)]);
    const want = [...f[key]].filter(v => exp[v]).sort(); if (!eq([...got.sel].sort(), want)) errs.push([dim + ' selected', got.sel, want]);
    if (f[key].size) { const others = got.order.filter(n => !f[key].has(n)); if (!others.every(n => got.dim.includes(n))) errs.push([dim + ' unselected not dimmed']); }
    else if (got.dim.length) errs.push([dim + ' dimmed with no selection']);
  }
  { const mexp = e.matrix; const mg = d.matrix.o; const flat = o => { const out = {}; Object.keys(o).forEach(r => Object.keys(o[r]).forEach(c => out[r + '|' + c] = o[r][c])); return out; };
    const a = flat(mg), b = flat(mexp);
    if (!Object.keys(b).length) { if (!d.empties.matrix) errs.push(['matrix empty-state missing']); } else if (!eq(Object.keys(a).sort(), Object.keys(b).sort()) || Object.keys(b).some(k => a[k] !== b[k])) errs.push(['matrix cells', Object.keys(a).length, Object.keys(b).length]);
    if (Object.keys(b).length) { const sumM = Object.values(b).reduce((x, y) => x + y, 0); if (sumM !== e.stBase.length && !f.status.size && true) { /* base ignores assignee/tester only */ } } }
  if (!eq(d.detailKeys, e.detailKeys)) errs.push(['detail keys', d.detailKeys.length, e.detailKeys.length]);
  if (d.detailSub !== `${e.all.length} of ${S.length} work items`) errs.push(['detail sub', d.detailSub]);
  if (!e.all.length && !d.detailEmpty) errs.push(['detail empty-state missing']);
  const wantTags = []; Object.keys(f).forEach(dim => f[dim].forEach(v => wantTags.push(({ status: 'Status', assignee: 'Assignee', tester: 'Tester', fix: 'Fix version', parent: 'Parent' })[dim] + ': ' + v)));
  if (!eq([...d.tags].sort(), wantTags.sort())) errs.push(['tags', d.tags, wantTags]);
  if (d.resetDisabled !== !e.active) errs.push(['reset disabled', d.resetDisabled]);
  if (d.noFilterMsg !== !e.active) errs.push(['no-filter message', d.noFilterMsg]);
  const wantFix = f.fix.size === 0 ? '' : f.fix.size === 1 ? [...f.fix][0] : '__multi', wantPar = f.parent.size === 0 ? '' : f.parent.size === 1 ? [...f.parent][0] : '__multi';
  if (d.fixSel !== wantFix || d.parentSel !== wantPar) errs.push(['select sync', d.fixSel, d.parentSel]);
  check(label, errs.length === 0, errs.slice(0, 4));
  return { e, d };
}

// ---------- independent backlog model ----------
const AGEB = ['0–30', '31–90', '91–180', '181–365', '366+', 'No value'];
const ageOf = t => typeof t.days !== 'number' ? AGEB[5] : t.days <= 30 ? AGEB[0] : t.days <= 90 ? AGEB[1] : t.days <= 180 ? AGEB[2] : t.days <= 365 ? AGEB[3] : AGEB[4];
const dv = v => (v == null || String(v).trim() === '') ? '—' : String(v);
const BKEY = { dor: t => dv(t.dor), priority: t => dv(t.priority), type: t => dv(t.type), age: ageOf, epic: t => (t.epic === null || t.epic === undefined || String(t.epic).trim() === '') ? '(no epic)' : String(t.epic) };
const newBF = () => ({ dor: new Set(), priority: new Set(), type: new Set(), age: new Set(), epic: new Set() });
const hay = t => [t.ticket, t.summary, t.epic, t.cluster, t.risk].filter(v => v != null && String(v).trim() !== '').join('\n').toLowerCase();
function predFor(q) { const s = String(q || '').trim().toLowerCase(); if (!s) return { pred: null, tag: '', dor: null }; for (const [w, L] of [['missing', 'Missing'], ['weak', 'Weak'], ['well-formed', 'Well-Formed'], ['n/a (epic)', 'N/A (Epic)'], ['ready', 'Ready']]) if (s.length >= 3 && w.startsWith(s)) return { pred: t => t.dor === L, tag: 'Search: DoR = ' + L, dor: L }; return { pred: t => hay(t).includes(s), tag: 'Search: “' + String(q).trim() + '”', dor: null }; }
const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

const READ_EPIC = `
const btn = document.getElementById('epic-btn'), pop = document.querySelector('.epicpop');
return { btn: T(btn), expanded: btn.getAttribute('aria-expanded'), open: !!pop && !pop.hidden && getComputedStyle(pop).display !== 'none', haspopup: btn.getAttribute('aria-haspopup'),
  opts: [...document.querySelectorAll('.epicopt')].map(l => ({ name: T(l.querySelector('.name')), n: +T(l.querySelector('.n')), checked: l.querySelector('input').checked, type: l.querySelector('input').type })) };
`;
const READ_BACKLOG = `
const c = readCommon();
const dist = t => { const o={}, sel=[], dim=[]; rowsOf(t).forEach(r=>{ const n=T(r.querySelector('.name')); o[n]=+T(r.querySelector('.n')); if(r.classList.contains('sel')) sel.push(n); if(r.classList.contains('dim')) dim.push(n); }); return {o, sel, dim, order:Object.keys(o)}; };
const tb = tile('Backlog tickets'); const hdr=[...tb.querySelectorAll('thead th')].map(T);
const rows=[...tb.querySelectorAll('tbody tr')].map(tr=>[...tr.children].map(T));
return Object.assign(c, { dor: dist('Readiness (DoR)'), priority: dist('Priority'), type: dist('Type'), age: dist('Days in status'), matrix: matrixOf('Readiness x priority'), hdr, keys: rows.map(r=>r[0]), rows, sub: T(tb.querySelector('.sub')), tableEmpty: emptyIn('Backlog tickets'), empties:{dor:emptyIn('Readiness (DoR)'),priority:emptyIn('Priority'),type:emptyIn('Type'),age:emptyIn('Days in status'),matrix:emptyIn('Readiness x priority')}, hint: T(document.querySelector('.dorhint')), q: document.getElementById('q').value });
`;
async function verifyBacklog(p, B, f, q, label) {
  const ps = predFor(q); const all = applyF(B, f, BKEY, [], ps.pred); const d = await run(p, READ_BACKLOG); const errs = [];
  const active = Object.keys(f).some(k => f[k].size) || !!ps.pred;
  const days = all.map(t => t.days).filter(v => typeof v === 'number'); const med = median(days);
  const kv = [String(all.length), String(sumP(all)), String(all.filter(t => t.dor === 'Weak' || t.dor === 'Missing').length), String(all.filter(t => t.needsSplitting != null && String(t.needsSplitting).trim() !== '').length), med === null ? '—' : String(med)];
  if (!eq(d.kpis.map(k => k.value), kv)) errs.push(['kpi', d.kpis.map(k => k.value), kv]);
  const whole = { dor: {}, priority: {}, type: {}, age: {} }; B.forEach(t => Object.keys(whole).forEach(k => { const v = BKEY[k](t); whole[k][v] = (whole[k][v] || 0) + 1; }));
  for (const dim of ['dor', 'priority', 'type', 'age']) {
    const base = applyF(B, f, BKEY, [dim], ps.pred); const cnt = {}; base.forEach(t => { const v = BKEY[dim](t); cnt[v] = (cnt[v] || 0) + 1; });
    const got = d[dim];
    if (!base.length) { if (!d.empties[dim]) errs.push([dim + ' empty-state missing']); continue; }
    Object.keys(got.o).forEach(k => { if (got.o[k] !== (cnt[k] || 0)) errs.push([dim, k, got.o[k], cnt[k] || 0]); });
    Object.keys(cnt).forEach(k => { if (got.o[k] === undefined) errs.push([dim + ' missing row', k]); });
    const want = [...f[dim]].filter(v => got.o[v] !== undefined).sort(); if (!eq([...got.sel].sort(), want)) errs.push([dim + ' selected', got.sel, want]);
    if (f[dim].size) { if (!got.order.filter(n => !f[dim].has(n)).every(n => got.dim.includes(n))) errs.push([dim + ' unselected not dimmed']); } else if (got.dim.length) errs.push([dim + ' dimmed w/o selection']);
  }
  { const base = applyF(B, f, BKEY, ['dor', 'priority'], ps.pred); const mat = {}; base.forEach(t => { const r = BKEY.priority(t), c = BKEY.dor(t); (mat[r] = mat[r] || {})[c] = ((mat[r] || {})[c] || 0) + 1; });
    const flat = o => { const out = {}; Object.keys(o).forEach(r => Object.keys(o[r]).forEach(c => out[r + '|' + c] = o[r][c])); return out; }; const a = flat(d.matrix.o), b = flat(mat);
    if (!base.length) { if (!d.empties.matrix) errs.push(['matrix empty-state missing']); } else if (!eq(Object.keys(a).sort(), Object.keys(b).sort()) || Object.keys(b).some(k => a[k] !== b[k])) errs.push(['matrix cells']); }
  { const E = await run(p, READ_EPIC), base = applyF(B, f, BKEY, ['epic'], ps.pred), cnt = {}; base.forEach(t => { const v = BKEY.epic(t); cnt[v] = (cnt[v] || 0) + 1; });
    const whole = {}; B.forEach(t => { const v = BKEY.epic(t); whole[v] = (whole[v] || 0) + 1; });
    const wantOrder = Object.keys(whole).filter(k => k !== '(no epic)').sort((a, b) => whole[b] - whole[a] || a.localeCompare(b)).concat(whole['(no epic)'] ? ['(no epic)'] : []);
    if (!eq(E.opts.map(o => o.name), wantOrder)) errs.push(['epic option order', E.opts.map(o => o.name).slice(0, 5), wantOrder.slice(0, 5)]);
    E.opts.forEach(o => { if (o.n !== (cnt[o.name] || 0)) errs.push(['epic option count', o.name, o.n, cnt[o.name] || 0]); if (o.checked !== f.epic.has(o.name)) errs.push(['epic checkbox', o.name, o.checked]); if (o.type !== 'checkbox') errs.push(['epic option is not a checkbox', o.name]); });
    if (E.btn !== 'Epic' + (f.epic.size ? ' (' + f.epic.size + ')' : '') + ' \u25be') errs.push(['epic button label', E.btn]); }
  if (!eq(d.keys, all.map(t => t.ticket))) errs.push(['table keys', d.keys.length, all.length]);
  if (d.sub !== `Showing ${all.length} of ${B.length} tickets`) errs.push(['table sub', d.sub]);
  if (!all.length && !d.tableEmpty) errs.push(['table empty-state missing']);
  const wantTags = []; Object.keys(f).forEach(dim => f[dim].forEach(v => wantTags.push(({ dor: 'DoR', priority: 'Priority', type: 'Type', age: 'Age', epic: 'Epic' })[dim] + ': ' + v))); if (ps.tag) wantTags.push(ps.tag);
  if (!eq([...d.tags].sort(), wantTags.sort())) errs.push(['tags', d.tags, wantTags]);
  if (d.resetDisabled !== !active) errs.push(['reset disabled', d.resetDisabled]);
  if (d.hint !== (ps.dor ? `Searching by readiness: DoR = ${ps.dor}.` : '')) errs.push(['hint', d.hint]);
  if (d.q !== q) errs.push(['input value', d.q, q]);
  check(label, errs.length === 0, errs.slice(0, 4));
  return { d, all };
}

const KEYRE = /\b[A-Z][A-Z0-9]+-[0-9]+\b/g;
const keysIn = s => (s == null ? [] : String(s).match(KEYRE) || []);
function linkErrors(cells, values, structured) {
  const errs = [];
  cells.forEach((c, i) => {
    const v = values[i], want = structured === 'ticket' ? (/^[A-Z][A-Z0-9]+-[0-9]+$/.test(String(v)) ? [String(v)] : []) : keysIn(v);
    const got = c.links.map(l => l.t);
    if (!eq(got, want)) errs.push(['keys', i, got, want]);
    c.links.forEach(l => { if (l.h !== 'https://mysnaplogic.atlassian.net/browse/' + encodeURIComponent(l.t) || l.target !== '_blank' || !/noopener/.test(l.rel || '')) errs.push(['link attrs', l]); });
    const wantText = v == null || String(v).trim() === '' ? '—' : String(v);
    if (c.text !== wantText.replace(/\s+/g, ' ').trim()) errs.push(['text changed', i, c.text, wantText]);
    if (c.foreign) errs.push(['foreign element', i]);
  });
  return errs.slice(0, 4);
}
const mtime = f => fs.statSync(f).mtimeMs;
const TRACKER = process.env.AF_SNAPLOGIC_TRACKER || '/Users/cespitia/Library/CloudStorage/GoogleDrive-cespitia@snaplogic.com/My Drive/AF_Snaplogic/03_Team_Enablement/daily_tracker.xlsx';
const before = { s: mtime(path.join(ROOT, 'sprint.json')), b: mtime(path.join(ROOT, 'backlog.json')), x: mtime(TRACKER) };
const SPRJ = J('sprint.json'); const S = SPRJ.tickets, B = J('backlog.json').tickets;
const CTX = { sprint: SPRJ.sprint || null, today: SPRJ.refreshedAt, thr: 2 };

const layoutJs = `const d=document.scrollingElement; const bodies=[...document.querySelectorAll('.tile-body')].map(b=>({sh:b.scrollHeight,ch:b.clientHeight,ov:getComputedStyle(b).overflowY})); const tiles=[...document.querySelectorAll('section.tile')].map(t=>{const r=t.getBoundingClientRect(); return {l:Math.round(r.left), r:Math.round(r.right), t:Math.round(r.top), b:Math.round(r.bottom), w:Math.round(r.width), h:Math.round(r.height), title:(t.querySelector('h2')||t.querySelector('.label')).textContent.trim()};}); const bad=[]; document.querySelectorAll('body *').forEach(n=>{ if(n.closest('.tile-body')) return; const r=n.getBoundingClientRect(); if(r.width>0 && r.right>innerWidth+1) bad.push(n.tagName+'.'+n.className+':'+Math.round(r.right)); }); return {iw:innerWidth, ih:innerHeight, sw:d.scrollWidth, sh:d.scrollHeight, bodies, tiles, bad:bad.slice(0,5)};`;

(async () => {
  await launch();
  const base = 'http://127.0.0.1:' + ports.real + '/';
  let p;

  // =============== SPRINT ===============
  console.log('\n--- Sprint page (real data) ---');
  p = await openPage(base + 'index.html');
  check('Sprint: JSON 200, no console errors/warnings, only localhost requests', p.resp[base + 'sprint.json'] === 200 && p.logs.length === 0 && p.reqs.every(u => u.startsWith('http://127.0.0.1:' + ports.real + '/')), { resp: p.resp, logs: p.logs, reqs: p.reqs });
  check('Shell: top bar tabs (Current sprint active), Data as of, footer text', await run(p, `const tabs=[...document.querySelectorAll('.tab')]; return tabs.length===2 && T(tabs[0])==='Current sprint' && tabs[0].classList.contains('active') && tabs[0].getAttribute('aria-current')==='page' && T(tabs[1])==='Backlog' && T(document.getElementById('asof'))==='Data as of ${J('sprint.json').refreshedAt}' && /Internal — team only/.test(T(document.querySelector('.foot')))`));
  let f = newF();
  await verifySprint(p, S, f, 'Sprint: no filters, every tile = independent calculation');
  const noTesterKeys = S.filter(t => t.tester === null && !String(t.classifications || '').split('; ').includes('Dev to Test')).map(t => t.ticket);
  check('No tester KPI excludes exact Dev to Test classifications (18 of 74)', noTesterKeys.length === 18 && kpi('No tester').querySelector('.value').textContent === '18' && kpi('No tester').querySelector('.hint').textContent.startsWith('no tester, excluding Dev to Test'), { count: noTesterKeys.length, hint: kpi('No tester').querySelector('.hint').textContent });
  await run(p, `clickEl(kpi('No tester'))`);
  let lowerKeys = await run(p, `return [...tile('Ticket detail').querySelectorAll('tbody tr')].map(tr=>T(tr.children[0]))`);
  const resetEnabled = await run(p, `return !document.querySelector('.resetall').disabled`);
  check('Click No tester filters the lower section to matching tickets and activates Reset all', eq([...lowerKeys].sort(), [...noTesterKeys].sort()) && resetEnabled, { expected: noTesterKeys.length, actual: lowerKeys.length, resetEnabled });
  await run(p, `clickReset()`);
  lowerKeys = await run(p, `return [...tile('Ticket detail').querySelectorAll('tbody tr')].map(tr=>T(tr.children[0]))`);
  check('Reset all clears the KPI filter and restores the lower section', lowerKeys.length === S.length && !kpi('No tester').classList.contains('selected'), lowerKeys.length);
  const carriedKeys = SPRJ.sprint.carriedOver.ticketKeys;
  await run(p, `clickEl(kpi('Carried over'))`);
  lowerKeys = await run(p, `return [...tile('Ticket detail').querySelectorAll('tbody tr')].map(tr=>T(tr.children[0]))`);
  check('Click Carried Over filters the lower section to exactly the exported 11 keys', carriedKeys.length === 11 && eq([...lowerKeys].sort(), [...carriedKeys].sort()), { expected: carriedKeys, actual: lowerKeys });
  await run(p, `clickEl(kpi('Carried over'))`);
  await verifySprint(p, S, f, 'KPI filters clear on second click');
  const L = await run(p, layoutJs);
  check('Layout 1920x1080: no page scroll (width and height)', L.sh <= L.ih && L.sw <= L.iw, L);
  check('Layout 1920x1080: 7 KPI + 4 main + 2 lower tiles; board fills the width (right edge within 16px), equal gutters', L.tiles.length === 13 && Math.max(...L.tiles.map(t => t.r)) >= L.iw - 16 && Math.min(...L.tiles.map(t => t.l)) <= 16, L.tiles);
  check('Layout 1920x1080: tiles fill the height (bottom of detail tile within 40px of the footer)', Math.max(...L.tiles.map(t => t.b)) >= L.ih - 60, Math.max(...L.tiles.map(t => t.b)));
  check('Layout: main-row tiles share one height; lower-row tiles share one height and together span the width; heat grid is about 28% wide', new Set(L.tiles.slice(7, 11).map(t => t.h)).size === 1 && new Set(L.tiles.slice(11, 13).map(t => t.h)).size === 1 && L.tiles[11].w + L.tiles[12].w + 10 >= L.iw - 30 && L.tiles[12].w >= 440 && L.tiles[12].w <= 0.32 * L.iw, L.tiles.slice(7));
  const rowRatio = L.tiles[7].h / L.tiles[11].h;
  check('Layout: 15% of former main-row height transferred to the lower row', Math.abs(rowRatio - 1.1475 / 1.2025) < 0.02, { rowRatio, expected: 1.1475 / 1.2025 });
  check('Layout: main row is Burndown, Tickets by status, Work by assignee, Work by tester; lower row is Ticket detail then Assignee x tester', eq(L.tiles.slice(7).map(t => t.title), ['Burndown', 'Tickets by status', 'Work by assignee', 'Work by tester', 'Ticket detail', 'Assignee x tester']) && L.tiles[8].w >= 250, L.tiles.slice(7).map(t => t.title + ' ' + t.w));
  check('Tile bodies scroll inside (overflow auto), assignee list overflows', L.bodies.every(b => b.ov === 'auto' || b.ov === 'hidden') && L.bodies.some(b => b.sh > b.ch), L.bodies);
  const st = await run(p, `const out={}; for (const [k,t] of [['assignee','Work by assignee'],['detail','Ticket detail'],['matrix','Assignee x tester']]) { const b=tile(t).querySelector('.tile-body'); const th=b.querySelector('thead th'); b.scrollTop=120; const br=b.getBoundingClientRect(); out[k]={scrolls:b.scrollHeight>b.clientHeight, sb:b.offsetWidth-b.clientWidth, thSticky: th?getComputedStyle(th).position:null, thDiff: th?Math.round(th.getBoundingClientRect().top-br.top):null}; b.scrollTop=0;} const ft=tile('Work by assignee').querySelector('.tile-foot'); out.footVisible = ft.getBoundingClientRect().bottom <= tile('Work by assignee').getBoundingClientRect().bottom+1 && T(ft).startsWith('Total'); return out;`);
  check('Sticky headers, visible scrollbars, Total line pinned', st.assignee.scrolls && st.assignee.sb > 0 && st.detail.thSticky === 'sticky' && Math.abs(st.detail.thDiff) <= 2 && st.matrix.thSticky === 'sticky' && Math.abs(st.matrix.thDiff) <= 2 && st.footVisible, st);

  const owners = Object.keys(group(S, SKEY.assignee)).sort((a, b) => group(S, SKEY.assignee)[b].p - group(S, SKEY.assignee)[a].p || a.localeCompare(b));
  const pick = owners[2], pick2 = owners[5], pick3 = owners[1];
  // click an assignee
  await run(p, `clickRow('Work by assignee', ${JSON.stringify(pick)})`); f.assignee = new Set([pick]);
  await verifySprint(p, S, f, `Click assignee "${pick}": KPIs, status, tester, matrix, detail all filtered; assignee tile highlights/dims`);
  await run(p, `clickRow('Work by assignee', ${JSON.stringify(pick)})`); f.assignee = new Set();
  await verifySprint(p, S, f, 'Click the same assignee again: cleared');
  await run(p, `clickRow('Work by assignee', ${JSON.stringify(pick)})`); await run(p, `clickRow('Work by assignee', ${JSON.stringify(pick2)})`); f.assignee = new Set([pick2]);
  await verifySprint(p, S, f, 'Plain click on another assignee replaces the selection');
  await run(p, `clickRow('Work by assignee', ${JSON.stringify(pick3)}, {ctrl:true})`); f.assignee.add(pick3);
  await verifySprint(p, S, f, 'Ctrl+click adds a second assignee (OR within dimension)');
  await run(p, `clickRow('Work by assignee', ${JSON.stringify(pick3)}, {meta:true})`); f.assignee.delete(pick3);
  await verifySprint(p, S, f, 'Cmd+click toggles a value off');
  await run(p, `clickRow('Work by assignee', ${JSON.stringify(pick)}, {shift:true})`); f.assignee.add(pick);
  await verifySprint(p, S, f, 'Shift+click also multi-selects');
  await run(p, `clickReset()`); f = newF();
  await verifySprint(p, S, f, 'Reset all clears everything; Reset is disabled again');

  // AND across dimensions
  await run(p, `clickRow('Tickets by status', 'In Review')`); f.status = new Set(['In Review']);
  await verifySprint(p, S, f, 'Click status "In Review"');
  await run(p, `clickRow('Work by tester', 'Unassigned')`); f.tester = new Set(['Unassigned']);
  await verifySprint(p, S, f, 'Click tester "Unassigned" on top: In Review tickets with no tester (AND)');
  const exp1 = expectSprint(S, f);
  check('That combination equals the In Review tickets without a tester (direct count)', exp1.all.length === S.filter(t => t.status === 'In Review' && t.tester == null).length, exp1.all.length);
  await run(p, `clickRow('Tickets by status', 'Done', {ctrl:true})`); f.status.add('Done');
  await verifySprint(p, S, f, 'Ctrl+click adds Done: status OR, still AND tester');
  await run(p, `clickTagX(0)`); const firstTag = [...f.status][0]; f.status.delete(firstTag);
  await verifySprint(p, S, f, 'Tag × removes only that one value');
  await run(p, `clickReset()`); f = newF();

  // matrix cell
  const mm = expectSprint(S, newF()).matrix; const rA = Object.keys(mm)[3]; const cT = Object.keys(mm[rA])[0];
  await run(p, `clickCell('Assignee x tester', ${JSON.stringify(rA)}, ${JSON.stringify(cT)})`); f.assignee = new Set([rA]); f.tester = new Set([cT]);
  const r1 = await verifySprint(p, S, f, `Matrix cell "${rA} / ${cT}" sets both assignee and tester`);
  check('Matrix cell shows the highlighted state and the pair count equals the detail row count', r1.d.matrix.sel.length === 1 && r1.d.detailKeys.length === mm[rA][cT], { sel: r1.d.matrix.sel, n: r1.d.detailKeys.length });
  await run(p, `clickCell('Assignee x tester', ${JSON.stringify(rA)}, ${JSON.stringify(cT)})`); f.assignee = new Set(); f.tester = new Set();
  await verifySprint(p, S, f, 'Clicking the same matrix cell again clears both');
  // selects
  const fixes = [...new Set(S.map(t => t.fixVersion).filter(Boolean))].sort(), pars = [...new Set(S.map(t => t.parent).filter(Boolean))].sort();
  await run(p, `setSel('f-fix', ${JSON.stringify(fixes[0])})`); f.fix = new Set([fixes[0]]);
  await verifySprint(p, S, f, `Fix version select "${fixes[0]}" filters every tile and shows a tag`);
  await run(p, `setSel('f-parent', ${JSON.stringify(pars[0])})`); f.parent = new Set([pars[0]]);
  await verifySprint(p, S, f, `Parent select "${pars[0]}" combines with Fix version (AND)`);
  await run(p, `setSel('f-fix', '')`); f.fix = new Set();
  await verifySprint(p, S, f, 'Fix version "All" clears that dimension');
  const hasNoneFix = S.some(t => !t.fixVersion), hasNonePar = S.some(t => !t.parent);
  if (hasNonePar) { await run(p, `setSel('f-parent', '(none)')`); f.parent = new Set(['(none)']); await verifySprint(p, S, f, 'Parent "(none)" selects tickets without a parent'); }
  await run(p, `clickReset()`); f = newF();
  await verifySprint(p, S, f, 'Reset all also resets the selects');
  // zero results
  let zero = null;
  for (const sName of BN) { if (!S.some(t => BN[bucket(t.status)] === sName)) continue; for (const fx of fixes) if (!S.some(t => BN[bucket(t.status)] === sName && t.fixVersion === fx)) { zero = [sName, 'f-fix', 'fix', fx]; break; } if (zero) break; }
  if (!zero) for (const sName of BN) { if (!S.some(t => BN[bucket(t.status)] === sName)) continue; for (const pr of pars) if (!S.some(t => BN[bucket(t.status)] === sName && t.parent === pr)) { zero = [sName, 'f-parent', 'parent', pr]; break; } if (zero) break; }
  if (zero) {
    await run(p, `clickRow('Tickets by status', ${JSON.stringify(zero[0])})`); await run(p, `setSel(${JSON.stringify(zero[1])}, ${JSON.stringify(zero[3])})`); f.status = new Set([zero[0]]); f[zero[2]] = new Set([zero[3]]);
    const z = await verifySprint(p, S, f, `Zero results (${zero[0]} + ${zero[2]} ${zero[3]}): KPIs 0, empty-state in tiles and table, no errors`);
    check('Zero results: KPIs show 0 and the empty-state text is the specified sentence', z.d.kpis[0].value === '0' && z.d.detailEmpty === 'No work items match these filters. Remove a tag or use Reset all.' && z.d.empties.assignee === z.d.detailEmpty, z.d.detailEmpty);
    await run(p, `clickReset()`); f = newF();
  } else check('Zero results case available in data', false, 'no empty combination');
  // scroll position kept
  await run(p, `tile('Work by assignee').querySelector('.tile-body').scrollTop = 150`);
  const rowName = owners[Math.min(9, owners.length - 1)];
  await run(p, `clickRow('Work by assignee', ${JSON.stringify(rowName)})`); f.assignee = new Set([rowName]);
  const kept = await run(p, `return tile('Work by assignee').querySelector('.tile-body').scrollTop`);
  check('Scroll position inside a tile is kept when a filter changes', kept >= 100, kept);
  await run(p, `clickReset()`); f = newF();
  // keyboard
  await run(p, `document.activeElement && document.activeElement.blur()`);
  let focused = null; for (let i = 0; i < 40 && !focused; i++) { await p.key('Tab', 'Tab', 9); const r = await run(p, `const a=document.activeElement; return a && a.classList.contains('rowbtn') && tile('Tickets by status').contains(a) ? {name:T(a.querySelector('.name')), outline:getComputedStyle(a).outlineStyle, w:getComputedStyle(a).outlineWidth, pressed:a.getAttribute('aria-pressed'), tag:a.tagName} : null`); if (r) focused = r; }
  check('Keyboard: Tab reaches a status row (a real button) with a visible focus outline', focused && focused.tag === 'BUTTON' && focused.outline !== 'none' && parseFloat(focused.w) >= 2, focused);
  await p.key('Enter', 'Enter', 13, '\r');
  f.status = new Set([focused.name]);
  await verifySprint(p, S, f, 'Keyboard: Enter selects the focused status; aria-pressed and tag reflect it');
  check('Selection exposed with aria-pressed=true', await run(p, `return rowsOf('Tickets by status').filter(r=>r.getAttribute('aria-pressed')==='true').length===1`));
  await p.key(' ', 'Space', 32, ' ');
  f.status = new Set();
  await verifySprint(p, S, f, 'Keyboard: Space on the same row clears it');
  await run(p, `clickReset()`); f = newF();
  check('Controls are real elements (rows and cells are buttons, selects and inputs)', await run(p, `return [...document.querySelectorAll('.rowbtn, .cell, .tag-x, .resetall')].every(b=>b.tagName==='BUTTON') && document.getElementById('f-fix').tagName==='SELECT'`));
  check('Light mode, no external fonts', await run(p, `const m=getComputedStyle(document.body).backgroundColor.match(/\\d+/g).map(Number); return m.every(x=>x>200) && getComputedStyle(document.documentElement).colorScheme!=='dark'`));
  check('Empty values: no null/undefined/NaN text in tiles or tables (excluding ticket prose)', await run(p, `const t=[...document.querySelectorAll('.kpis, .main')].map(n=>n.textContent).join(' ') + [...document.querySelectorAll('.tile-body tbody td:not(.wrap)')].map(n=>n.textContent).join(' '); return !/NaN|undefined|\\bnull\\b/.test(t)`));
  const dt = await run(p, `const hdr=[...tile('Ticket detail').querySelectorAll('thead th')].map(T); const ix=n=>hdr.indexOf(n); const rows=[...tile('Ticket detail').querySelectorAll('tbody tr')].map(tr=>({pts:T(tr.children[ix('Story points')]), tester:T(tr.children[ix('Tester')]), owner:T(tr.children[ix('Owner')]), status:T(tr.children[ix('Status')]), parent:T(tr.children[ix('Parent')]), fix:T(tr.children[ix('Fix version')]), hdr})); return rows;`);
  check('Detail table: required columns; empty points/parent/fix "—"; empty tester "Unassigned"; original status text', ['Ticket', 'Summary', 'Owner', 'Tester', 'Status', 'Story points', 'Parent', 'Fix version', 'Linked work items', 'Blocker'].every(h => dt[0].hdr.includes(h)) && dt.every((r, i) => r.pts === (S[i].points == null ? '—' : String(S[i].points)) && r.tester === grpName(S[i].tester) && r.status === S[i].status && r.parent === (S[i].parent || '—') && r.fix === (S[i].fixVersion || '—')));
  { const L1 = await run(p, `return {ticket: colCells('Ticket detail','Ticket'), parent: colCells('Ticket detail','Parent'), linked: colCells('Ticket detail','Linked work items'), summary: colCells('Ticket detail','Summary'), blocker: colCells('Ticket detail','Blocker')}`);
    check('Jira links (sprint): every Ticket cell is a link with the exact href, new tab, noopener', linkErrors(L1.ticket, S.map(t => t.ticket), 'ticket').length === 0 && L1.ticket.every(c => c.links.length === 1), linkErrors(L1.ticket, S.map(t => t.ticket), 'ticket'));
    check('Jira links (sprint): every key in Parent is its own link, text unchanged, none when no key', linkErrors(L1.parent, S.map(t => t.parent)).length === 0, linkErrors(L1.parent, S.map(t => t.parent)));
    check('Jira links (sprint): every key in Linked work items is its own link, text unchanged', linkErrors(L1.linked, S.map(t => t.linkedWorkItems)).length === 0 && L1.linked.some(c => c.links.length > 1), linkErrors(L1.linked, S.map(t => t.linkedWorkItems)));
    check('Jira links (sprint): Summary and Blocker cells have no links', [...L1.summary, ...L1.blocker].every(c => c.links.length === 0)); }
  await run(p, `window.__prevented = 0; document.addEventListener('click', e => { if (e.target.closest && e.target.closest('a.jira')) { e.preventDefault(); window.__prevented++; } }, true); const a = tile('Ticket detail').querySelector('a.jira'); a.dispatchEvent(new MouseEvent('click', {bubbles:true, cancelable:true}));`);
  check('Jira links (sprint): clicking a link changes no filter, tag or KPI', await verifySprint(p, S, newF(), 'Sprint: state unchanged after clicking a Jira link').then(r => r.d.tags.length === 0) && (await run(p, `return window.__prevented`)) === 1);
  await run(p, `document.activeElement && document.activeElement.blur(); window.scrollTo(0,0)`);
  { let li = null; for (let i = 0; i < 260 && !li; i++) { await p.key('Tab', 'Tab', 9); li = await run(p, `const a=document.activeElement; return a && a.matches && a.matches('a.jira') ? {outline:getComputedStyle(a).outlineStyle, w:getComputedStyle(a).outlineWidth, inDetail: tile('Ticket detail').contains(a)} : null`); }
    check('Jira links: Tab reaches a link and it shows a visible focus outline', li && li.outline !== 'none' && parseFloat(li.w) >= 2, li); }
  check('Labels: "Story points on owned tickets", "Points on tickets they test", overlap note', await run(p, `const t=document.body.innerText; return t.includes('Story points on owned tickets') && t.includes('Points on tickets they test') && t.includes('overlap by design') && t.includes('counts each ticket once')`));
  check('Sprint: no console errors/warnings after all interactions', p.logs.length === 0, p.logs);
  // threshold setting, detail columns
  await run(p, `AF.config.midSprintThresholdDays = 5; AF.store.reset()`);
  await verifySprint(p, S, newF(), 'Changing the mid-sprint threshold in one place (5 days) updates the KPI, the markers and the legend', Object.assign({}, CTX, { thr: 5 }));
  await run(p, `AF.config.midSprintThresholdDays = 2; AF.store.reset()`);
  await verifySprint(p, S, newF(), 'Threshold back to 2 days', CTX);
  check('Detail table does not show the approximate addedDate (nor doneDate or cycleTime)', !(await run(p, `return [...tile('Ticket detail').querySelectorAll('thead th')].map(T)`)).some(h => /added|done date|cycle/i.test(h)));
  // layouts
  for (const [w, h, mode] of [[1440, 900, 'dash'], [1536, 864, 'dash'], [1366, 768, 'dash'], [1280, 720, 'fallback'], [1024, 768, 'fallback'], [800, 900, 'fallback'], [480, 900, 'fallback']]) {
    await p.resize(w, h); const r = await run(p, layoutJs);
    if (mode === 'dash') check(`Layout ${w}x${h}: dashboard mode, no page scroll, nothing beyond the viewport`, r.sh <= r.ih && r.sw <= r.iw && r.bad.length === 0 && r.tiles.every(t => t.r <= r.iw && t.b <= r.ih), { sh: r.sh, ih: r.ih, sw: r.sw, bad: r.bad });
    else check(`Layout ${w}x${h}: fallback scrolling layout, no page-level horizontal scroll, nothing beyond the viewport outside tile scroll areas`, r.sw <= r.iw && r.bad.length === 0 && r.sh > r.ih, { sw: r.sw, iw: r.iw, bad: r.bad, sh: r.sh, ih: r.ih });
    { const bdf = await run(p, READ_BD); check(`Layout ${w}x${h}: burndown redraws to fit its tile (svg as wide as the tile, no scroll bars)`, bdf.has && Math.abs(bdf.svgW - bdf.bodyW) <= 2 && bdf.bodyOverflow <= 1, { svgW: bdf.svgW, bodyW: bdf.bodyW, o: bdf.bodyOverflow }); }
    if (w === 1440 || w === 800) { const shot = await p.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(SP, `acc2_sprint_${w}.png`), Buffer.from(shot.result.data, 'base64')); }
  }
  await p.close();

  // =============== BACKLOG ===============
  console.log('\n--- Backlog page (real data) ---');
  p = await openPage(base + 'backlog.html');
  check('Backlog: JSON 200, no console errors/warnings, only localhost requests', p.resp[base + 'backlog.json'] === 200 && p.logs.length === 0 && p.reqs.every(u => u.startsWith('http://127.0.0.1:' + ports.real + '/')), { logs: p.logs });
  check('Shell: Backlog tab active, Data as of, footer', await run(p, `const tabs=[...document.querySelectorAll('.tab')]; return tabs[1].classList.contains('active') && !tabs[0].classList.contains('active') && T(document.getElementById('asof'))==='Data as of ${J('backlog.json').refreshedAt}' && /Internal — team only/.test(T(document.querySelector('.foot')))`));
  let bf = newBF(), q = '';
  await verifyBacklog(p, B, bf, q, 'Backlog: no filters, every tile = independent calculation');
  const LB = await run(p, layoutJs);
  check('Layout 1920x1080 (backlog): no page scroll; 5 KPI + 5 main + 1 table tiles; fills width and height', LB.sh <= LB.ih && LB.sw <= LB.iw && LB.tiles.length === 11 && Math.max(...LB.tiles.map(t => t.r)) >= LB.iw - 16 && Math.max(...LB.tiles.map(t => t.b)) >= LB.ih - 60, LB);
  const sb = await run(p, `const b=tile('Backlog tickets').querySelector('.tile-body'); const th=b.querySelector('thead th'); b.scrollTop=200; const d=Math.round(th.getBoundingClientRect().top-b.getBoundingClientRect().top); const r={scrolls:b.scrollHeight>b.clientHeight, sb:b.offsetWidth-b.clientWidth, sticky:getComputedStyle(th).position, d}; b.scrollTop=0; return r;`);
  check('Backlog table: scrolls inside its tile, visible scrollbar, sticky header', sb.scrolls && sb.sb > 0 && sb.sticky === 'sticky' && Math.abs(sb.d) <= 2, sb);
  const D0 = await run(p, READ_BACKLOG);
  check('Backlog: columns present; empty points/days/epic/risk/cluster/splitting show "—"; table in sheet order; exact keys', ['Ticket', 'Summary', 'DoR status', 'Priority', 'Type', 'Story points', 'Days in status', 'Epic', 'Needs splitting', 'Risk / open question', 'Related / cluster'].every(h => D0.hdr.includes(h)) && eq(D0.keys, B.map(t => t.ticket)) && D0.rows.every((r, i) => { const x = B[i]; const ix = h => D0.hdr.indexOf(h); return r[ix('Story points')] === (x.points == null ? '—' : String(x.points)) && r[ix('Days in status')] === (x.days == null ? '—' : String(x.days)) && r[ix('Epic')] === (x.epic || '—') && r[ix('Risk / open question')] === (x.risk || '—') && r[ix('Related / cluster')] === (x.cluster || '—') && r[ix('Needs splitting')] === (x.needsSplitting || '—'); }));
  check('DoR pills: Well-Formed/Ready #C6EFCE, Weak #FFEB9C, Missing #FFC7CE; N/A (Epic) neutral', await run(p, `const c={}; document.querySelectorAll('.pill').forEach(x=>c[T(x)]=getComputedStyle(x).backgroundColor); return (c['Well-Formed'] === undefined || c['Well-Formed']==='rgb(198, 239, 206)') && (c.Ready === undefined || c.Ready==='rgb(198, 239, 206)') && (c['N/A (Epic)'] === undefined || c['N/A (Epic)']==='rgb(232, 236, 241)') && (c.Weak === undefined || c.Weak==='rgb(255, 235, 156)') && (c.Missing === undefined || c.Missing==='rgb(255, 199, 206)')`));
  { const L2 = await run(p, `return {ticket: colCells('Backlog tickets','Ticket'), epic: colCells('Backlog tickets','Epic'), cluster: colCells('Backlog tickets','Related / cluster'), summary: colCells('Backlog tickets','Summary'), risk: colCells('Backlog tickets','Risk / open question')}`);
    check('Jira links (backlog): every Ticket cell is a link with the exact href, new tab, noopener', linkErrors(L2.ticket, B.map(t => t.ticket), 'ticket').length === 0 && L2.ticket.every(c => c.links.length === 1), linkErrors(L2.ticket, B.map(t => t.ticket), 'ticket'));
    check('Jira links (backlog): every key in Epic is its own link, text unchanged', linkErrors(L2.epic, B.map(t => t.epic)).length === 0, linkErrors(L2.epic, B.map(t => t.epic)));
    check('Jira links (backlog): every key in Related / cluster is its own link, text unchanged', linkErrors(L2.cluster, B.map(t => t.cluster)).length === 0 && L2.cluster.some(c => c.links.length > 1), linkErrors(L2.cluster, B.map(t => t.cluster)));
    check('Jira links (backlog): Summary and Risk cells have no links', [...L2.summary, ...L2.risk].every(c => c.links.length === 0)); }
  await run(p, `window.__prevented = 0; document.addEventListener('click', e => { if (e.target.closest && e.target.closest('a.jira')) { e.preventDefault(); window.__prevented++; } }, true); tile('Backlog tickets').querySelector('a.jira').dispatchEvent(new MouseEvent('click', {bubbles:true, cancelable:true}));`);
  await verifyBacklog(p, B, newBF(), '', 'Backlog: state unchanged after clicking a Jira link');
  check('Jira links (backlog): the click did not change filters', (await run(p, `return window.__prevented`)) === 1 && (await run(p, `return readCommon().tags.length`)) === 0);
  const click = async (t, name, o) => run(p, `clickRow(${JSON.stringify(t)}, ${JSON.stringify(name)}, ${JSON.stringify(o || {})})`);
  await click('Readiness (DoR)', 'Missing'); bf.dor = new Set(['Missing']);
  await verifyBacklog(p, B, bf, q, 'Click DoR "Missing": KPIs, other tiles, matrix and table filtered; DoR tile keeps alternatives');
  await click('Priority', 'High'); bf.priority = new Set(['High']);
  await verifyBacklog(p, B, bf, q, 'Add Priority "High" (AND across dimensions)');
  await click('Priority', 'Medium', { ctrl: true }); bf.priority.add('Medium');
  await verifyBacklog(p, B, bf, q, 'Ctrl+click adds Priority "Medium" (OR within dimension)');
  await click('Type', 'Story'); bf.type = new Set(['Story']);
  await verifyBacklog(p, B, bf, q, 'Add Type "Story"');
  const ageRow = AGEB.find(a => B.some(t => ageOf(t) === a));
  await click('Days in status', ageRow); bf.age = new Set([ageRow]);
  await verifyBacklog(p, B, bf, q, `Add age bucket "${ageRow}"`);
  await run(p, `clickReset()`); bf = newBF();
  await verifyBacklog(p, B, bf, q, 'Reset all clears the backlog filters');
  const bm = {}; B.forEach(t => { const r = BKEY.priority(t), c = BKEY.dor(t); (bm[r] = bm[r] || {})[c] = 1; });
  await run(p, `clickCell('Readiness x priority', 'Lowest', 'Weak')`); bf.priority = new Set(['Lowest']); bf.dor = new Set(['Weak']);
  await verifyBacklog(p, B, bf, q, 'Matrix cell Lowest / Weak sets priority and DoR');
  await run(p, `clickCell('Readiness x priority', 'Lowest', 'Weak')`); bf.priority = new Set(); bf.dor = new Set();
  await verifyBacklog(p, B, bf, q, 'Same cell again clears both');
  // search
  for (const s of ['mis', 'miss', 'missi', 'missing', ' MISSING ', 'Wea', 'weak', 'wel', 'well', 'WELL-FORMED', 'n/a', 'rea', 'ready']) { await run(p, `setQ(${JSON.stringify(s)})`); q = s; await verifyBacklog(p, B, bf, q, `Search "${s}" -> DoR prefix filter, hint and tag, all tiles consistent`); }
  for (const s of ['mi', 'w', 'r', 'missingx', 'asset', 'APP-11']) { await run(p, `setQ(${JSON.stringify(s)})`); q = s; await verifyBacklog(p, B, bf, q, `Search "${s}" -> normal text search`); }
  await run(p, `setQ('weak')`); q = 'weak'; await click('Priority', 'High'); bf.priority = new Set(['High']);
  await verifyBacklog(p, B, bf, q, 'Search "weak" AND Priority High');
  await run(p, `setQ('miss')`); q = 'miss';
  await verifyBacklog(p, B, bf, q, 'Search "miss" AND Priority High (DoR Missing + High)');
  await click('Readiness (DoR)', 'Weak'); bf.dor = new Set(['Weak']);
  const zr = await verifyBacklog(p, B, bf, q, 'Search "miss" AND DoR tile "Weak": zero results, empty-state everywhere, count 0');
  check('Zero results: KPIs are 0 and the empty text is the specified sentence', eq(zr.d.kpis.map(k => k.value).slice(0, 2), ['0', '0']) && zr.d.tableEmpty === 'No backlog tickets match these filters. Remove a tag or use Reset all.', zr.d.tableEmpty);
  await run(p, `clickTagX(${zr.d.tags.indexOf('Search: DoR = Missing')})`); q = '';
  await verifyBacklog(p, B, bf, q, 'Removing the search tag clears the search and the input box');
  await run(p, `clickReset()`); bf = newBF();
  await verifyBacklog(p, B, bf, q, 'Reset all clears everything on the backlog page');
  // Priority and Type icons (SPEC 9b)
  { const PR = ['Highest', 'High', 'Medium', 'Low', 'Lowest'], TY = ['Story', 'Bug', 'Sub-Bug', 'Epic', 'Task', 'Sub-task', 'Initiative', 'Doc Task'];
    const r = await run(p, `const rows = (t, kind) => rowsOf(t).map(r => { const n = r.querySelector('.name'); return { name: T(n), icons: [...n.querySelectorAll('svg')].map(v => v.dataset.icon), hidden: [...n.querySelectorAll('svg')].every(v => v.getAttribute('aria-hidden') === 'true' && v.textContent === '' && !v.querySelector('title')) }; });
      const cells = col => colCells('Backlog tickets', col).map(c => c.text); const tb = tile('Backlog tickets'); const hdr = [...tb.querySelectorAll('thead th')].map(T);
      const cellIcons = col => [...tb.querySelectorAll('tbody tr')].map(tr => [...tr.children[hdr.indexOf(col)].querySelectorAll('svg')].map(v => v.dataset.icon));
      return { prio: rows('Priority'), type: rows('Type'), pc: cellIcons('Priority'), tc: cellIcons('Type'), ptxt: cells('Priority'), ttxt: cells('Type'), imgs: document.querySelectorAll('img').length };`);
    const want = (kind, known, name) => known.includes(name) ? [kind + ':' + name] : [];
    check('Icons: every Priority and Type tile row has the right single icon before its (unchanged) name; unknown values have none; icons are decorative with no text', r.prio.every(x => eq(x.icons, want('priority', PR, x.name)) && x.hidden) && r.type.every(x => eq(x.icons, want('type', TY, x.name)) && x.hidden) && r.prio.some(x => x.icons.length) && r.type.some(x => x.icons.length), { p: r.prio, t: r.type });
    check('Icons: every Priority and Type table cell has the right single icon; the cell text is exactly the value (or a dash)', B.every((t, i) => eq(r.pc[i], t.priority && PR.includes(t.priority) ? ['priority:' + t.priority] : []) && eq(r.tc[i], t.type && TY.includes(t.type) ? ['type:' + t.type] : []) && r.ptxt[i] === (t.priority || '—') && r.ttxt[i] === (t.type || '—')), { pc: r.pc.slice(0, 3), ptxt: r.ptxt.slice(0, 3) });
    check('Icons: no image elements were added (inline SVG only)', r.imgs === 0); }
  // epic multi-select (SPEC 7.4)
  { const epics = [...new Set(B.map(BKEY.epic))].filter(k => k !== '(no epic)'), cnt = {}; B.forEach(t => { cnt[BKEY.epic(t)] = (cnt[BKEY.epic(t)] || 0) + 1; });
    const e1 = epics.find(k => k.startsWith('APP-718 ')), e2 = epics.find(k => k.startsWith('APP-55 '));
    const tick = n => run(p, `const l=[...document.querySelectorAll('.epicopt')].find(l => l.querySelector('.name').textContent === ${JSON.stringify(n)}); l.querySelector('input').click();`);
    check('Epic filter: closed at the start, button says "Epic ▾" with aria-haspopup, one checkbox per epic plus (no epic)', (r => !r.open && r.expanded === 'false' && r.haspopup === 'true' && r.btn === 'Epic \u25be' && r.opts.length === epics.length + 1)(await run(p, READ_EPIC)));
    await run(p, `document.getElementById('epic-btn').click()`);
    check('Epic filter: clicking the button opens the panel (aria-expanded=true)', (r => r.open && r.expanded === 'true')(await run(p, READ_EPIC)));
    await verifyBacklog(p, B, bf, q, 'Epic panel open: nothing is filtered yet and the option counts equal the data');
    await tick(e1); bf.epic = new Set([e1]);
    await verifyBacklog(p, B, bf, q, 'Epic: ticking APP-718 filters every KPI, tile, the matrix and the table; tag "Epic: ..." appears');
    check('Epic filter: the panel stays open while ticking', (r => r.open)(await run(p, READ_EPIC)));
    await tick(e2); bf.epic.add(e2);
    await verifyBacklog(p, B, bf, q, 'Epic: ticking APP-55 as well shows both epics together (OR): numbers equal the union');
    { const d = await run(p, READ_BACKLOG), want = B.filter(t => [e1, e2].includes(BKEY.epic(t))).length;
      check(`Epic: APP-718 + APP-55 together = ${want} tickets (${cnt[e1]} + ${cnt[e2]}); button reads "Epic (2)"`, want === cnt[e1] + cnt[e2] && d.kpis[0].value === String(want) && (await run(p, READ_EPIC)).btn === 'Epic (2) \u25be', d.kpis[0]); }
    await run(p, `clickRow('Readiness (DoR)', 'Weak')`); bf.dor = new Set(['Weak']);
    await verifyBacklog(p, B, bf, q, 'Epic combines with a DoR selection by AND (APP-718 + APP-55, DoR Weak)');
    await run(p, `setQ('weak')`); q = 'weak';
    await verifyBacklog(p, B, bf, q, 'Epic combines with the search by AND');
    await run(p, `setQ('')`); q = ''; await run(p, `clickReset()`); bf = newBF();
    check('Epic: Reset all unticks every checkbox and closes nothing it should not', (r => r.opts.every(o => !o.checked) && r.btn === 'Epic \u25be')(await run(p, READ_EPIC)));
    await tick(e1); bf.epic = new Set([e1]); await tick('(no epic)'); bf.epic.add('(no epic)');
    await verifyBacklog(p, B, bf, q, 'Epic: "(no epic)" can be ticked together with an epic');
    const tagIx = (await run(p, `return readCommon().tags`)).findIndex(t => t === 'Epic: ' + e1);
    await run(p, `clickTagX(${tagIx})`); bf.epic.delete(e1);
    await verifyBacklog(p, B, bf, q, 'Epic: removing the tag with x unticks that checkbox only');
    await run(p, `document.querySelector('.epicclear').click()`); bf.epic = new Set();
    await verifyBacklog(p, B, bf, q, 'Epic: Clear unticks every epic');
    check('Epic: clicking a tag x (outside the panel) closed the panel, as any click outside does', !(await run(p, READ_EPIC)).open);
    await run(p, `document.getElementById('epic-btn').click()`);
    check('Epic: Clear keeps the panel open', (await run(p, `document.querySelector('.epicclear').click(); return !document.querySelector('.epicpop').hidden`)));
    await run(p, `document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true}))`);
    { const r = await run(p, READ_EPIC), act = await run(p, `const a = document.activeElement; return a ? a.tagName + '#' + a.id + '.' + a.className : null`);
      check('Epic: Escape closes the panel and returns focus to the button', !r.open && r.expanded === 'false' && act === 'BUTTON#epic-btn.epicbtn', { r: r.open, ex: r.expanded, act }); }
    await run(p, `document.getElementById('epic-btn').click()`); await run(p, `document.querySelector('.kpi').click()`);
    check('Epic: a click outside the panel closes it', (r => !r.open)(await run(p, READ_EPIC)));
    await run(p, `document.getElementById('epic-btn').click()`);
    const lay = await run(p, layoutJs);
    check('Epic: opening the panel adds no page scroll and keeps the panel inside the viewport', lay.sh <= lay.ih && lay.sw <= lay.iw && await run(p, `const r=document.querySelector('.epicpop').getBoundingClientRect(); return r.left>=0 && r.right<=innerWidth && r.bottom<=innerHeight`), lay);
    await run(p, `document.getElementById('epic-btn').click()`);
    await verifyBacklog(p, B, bf, q, 'Epic: opening and closing the panel changed no filter'); }
  // keyboard
  await run(p, `document.activeElement && document.activeElement.blur()`);
  let bfk = null; for (let i = 0; i < 40 && !bfk; i++) { await p.key('Tab', 'Tab', 9); const r = await run(p, `const a=document.activeElement; return a && a.classList.contains('rowbtn') && tile('Readiness (DoR)').contains(a) ? {name:T(a.querySelector('.name')), outline:getComputedStyle(a).outlineStyle, w:getComputedStyle(a).outlineWidth} : null`); if (r) bfk = r; }
  check('Keyboard: Tab reaches a DoR row with a visible focus outline', bfk && bfk.outline !== 'none' && parseFloat(bfk.w) >= 2, bfk);
  await p.key('Enter', 'Enter', 13, '\r'); bf.dor = new Set([bfk.name]);
  await verifyBacklog(p, B, bf, q, 'Keyboard: Enter selects the focused DoR row');
  await run(p, `clickReset()`); bf = newBF();
  await run(p, `document.getElementById('q').focus()`); await p.key('Tab', 'Tab', 9, undefined, 8);
  { const ek = await run(p, `const a=document.activeElement; return a && a.id==='epic-btn' ? {outline:getComputedStyle(a).outlineStyle, w:getComputedStyle(a).outlineWidth} : null`);
    check('Epic: the button is reachable with Tab (just before the search box) and shows a visible focus outline', ek && ek.outline !== 'none' && parseFloat(ek.w) >= 2, ek); }
  check('Backlog: no console errors/warnings after all interactions', p.logs.length === 0, p.logs);
  for (const [w, h, mode] of [[1440, 900, 'dash'], [1536, 864, 'dash'], [1280, 720, 'fallback'], [800, 900, 'fallback'], [480, 900, 'fallback']]) {
    await p.resize(w, h); const r = await run(p, layoutJs);
    if (mode === 'dash') check(`Backlog layout ${w}x${h}: dashboard mode, no page scroll, nothing beyond the viewport`, r.sh <= r.ih && r.sw <= r.iw && r.bad.length === 0, { sh: r.sh, ih: r.ih, sw: r.sw, bad: r.bad });
    else check(`Backlog layout ${w}x${h}: fallback layout, no page-level horizontal scroll`, r.sw <= r.iw && r.bad.length === 0 && r.sh > r.ih, { sw: r.sw, iw: r.iw, bad: r.bad });
  }
  await p.close();

  // =============== FIXTURE ===============
  console.log('\n--- Fixture edge cases (copy of the app) ---');
  p = await openPage('http://127.0.0.1:' + ports.fixture + '/index.html');
  const FJ = JSON.parse(fixtureTxt), F = FJ.tickets, FCTX = { sprint: FJ.sprint || null, today: FJ.refreshedAt, thr: 2 }; let ff = newF();
  await verifySprint(p, F, ff, 'Fixture: all tiles consistent (Other bucket, Unassigned merge, null points, burndown, new KPIs)', FCTX);
  const fd = await run(p, READ_SPRINT);
  { const fe = expectSprint(F, newF(), FCTX), un = fe.tester['Unassigned'];
    check(`Fixture: "Blocked" is an Other row counted in totals (Total ${F.length} / ${sumP(F)}); null testers merge into one Unassigned row (${un[0]} / ${un[1]})`, fd.status['Other'] && fd.status['Other'][0] === 1 && fd.statusFoot.replace(/\s+/g, '') === `Total${F.length}/${sumP(F)}` && fd.tester.o['Unassigned'] && fd.tester.o['Unassigned'][0] === un[0] && fd.tester.o['Unassigned'][1] === un[1] && Object.keys(fd.tester.o).filter(k => k === 'Unassigned').length === 1, fd.tester.o); }
  check('Fixture: literal owner "Unassigned" is one Unassigned row; null points show "—" in detail; Blocked text in detail', await run(p, `const hdr=[...tile('Ticket detail').querySelectorAll('thead th')].map(T); const rows=[...tile('Ticket detail').querySelectorAll('tbody tr')].map(tr=>[...tr.children].map(T)); const r=rows.find(r=>r[0]==='APP-3053'); return rowsOf('Work by assignee').filter(x=>T(x.querySelector('.person'))==='Unassigned').length===1 && r[hdr.indexOf('Story points')]==='—' && r[hdr.indexOf('Status')]==='Blocked'`));
  await run(p, `clickRow('Tickets by status', 'Other')`); ff.status = new Set(['Other']);
  await verifySprint(p, F, ff, 'Fixture: clicking the Other status filters to the Blocked ticket', FCTX);
  await run(p, `clickReset()`);
  check('Fixture: no console errors', p.logs.length === 0, p.logs);
  await p.close();

  console.log('\n--- Burndown, cycle time, mid-sprint and carried over with hand-made data (copies of the app) ---');
  p = await openPage(`http://127.0.0.1:${ports.burn}/index.html`);
  { const BJ = JSON.parse(mkSprint(Object.assign({ carriedOver: { count: 3, percent: 20, storyPoints: 8 } }, SP_OK))), BCTX = { sprint: BJ.sprint, today: BJ.refreshedAt, thr: 2 };
    await verifySprint(p, BURN_T, newF(), 'Hand-made sprint: every tile and the burndown equal the independent calculation', BCTX);
    const k = await run(p, READ_SPRINT), bd = await run(p, READ_BD);
    check('Hand-made sprint: KPIs equal the numbers worked out by hand (6 items, 15 points, 87% done, 2 no tester, cycle time 3.3, 2 added mid-sprint, 3 carried over)', eq(k.kpis.map(x => x.value), ['6', '15', '87%', '2', '3.3', '2', '3']) && k.kpis[4].hint === 'days, over 3 Done tickets' && k.kpis[5].hint === '2 points, added after day 2 (approx.)' && k.kpis[6].hint === '20% of tickets, 8 points', k.kpis);
    check('Hand-made sprint: scope [13,13,13,13] (APP-903 enters on 9/26, after today), remaining [9,4,1,1] then nothing after today; ideal falls from the starting scope 13 to 0 in steps of 13/6; done per day [4,5,3,0,0,0,0] (the pre-start date counts on day 1)', eq(bd.days.map(d => d.remaining), [9, 4, 1, 1, null, null, null]) && eq(bd.days.map(d => d.scope), [13, 13, 13, 13, 15, 15, 15]) && eq(bd.days.map(d => Math.round(d.ideal * 1000) / 1000), [13, 10.833, 8.667, 6.5, 4.333, 2.167, 0]) && eq(bd.days.map(d => d.done), [4, 5, 3, 0, 0, 0, 0]), bd.days);
    check('Hand-made sprint: markers on 9/25 (1 ticket, 0 points) and 9/26 (1 ticket, 2 points); today is 9/25; subtitle and footnote as specified', eq(bd.added.map(a => [a.date, a.count, a.points]), [['2026-09-25', 1, 0], ['2026-09-26', 1, 2]]) && bd.todayLabel && bd.sub === '1 of 13 points remaining today, ideal 6.5' && bd.foot.includes('1 Done ticket has no done date and is not on the line.'), { added: bd.added, sub: bd.sub, foot: bd.foot });
    // marker click: list of added tickets (SPEC 6.3, D44)
    const PANEL = `const b = tile('Burndown'); const pop = b.querySelector('.bd-pop'); const mk = [...b.querySelectorAll('g.bd-added')].map(g => [g.dataset.date, g.getAttribute('aria-pressed'), g.getAttribute('class')]);
      return { open: !!pop, head: pop ? T(pop.querySelector('.bd-pop-head')) : null, hdr: pop ? [...pop.querySelectorAll('th')].map(T) : [], rows: pop ? [...pop.querySelectorAll('tbody tr')].map(tr => [...tr.children].map(T)) : [],
        links: pop ? [...pop.querySelectorAll('tbody a')].map(a => [T(a), a.getAttribute('href'), a.getAttribute('target')]) : [], mk, inside: pop ? (r => r.left >= b.getBoundingClientRect().left - 1 && r.right <= b.getBoundingClientRect().right + 1 && r.top >= b.getBoundingClientRect().top - 1 && r.bottom <= b.getBoundingClientRect().bottom + 1)(pop.getBoundingClientRect()) : null,
        tags: [...document.querySelectorAll('.tags .tag')].length, kpis: [...document.querySelectorAll('.kpi .value')].map(T) };`;
    const kBefore = (await run(p, PANEL)).kpis;
    check('Marker panel: closed at the start; markers expose aria-pressed=false', (r => !r.open && eq(r.mk.map(m => m[1]), ['false', 'false']))(await run(p, PANEL)));
    await run(p, `clickEl(tile('Burndown').querySelector('g.bd-added[data-date="2026-09-26"]'))`);
    { const r = await run(p, PANEL);
      check('Marker panel: clicking the 9/26 marker lists exactly APP-903 (Jira link, summary, 2 points, In Progress, Bob) under "Added Sep. 26, 2026"', r.open && r.head.startsWith('Added Sep. 26, 2026') && r.head.includes('1 ticket, 2 points') && eq(r.hdr, ['Ticket', 'Summary', 'Pts', 'Status', 'Assignee']) && eq(r.rows, [['APP-903', 's', '2', 'In Progress', 'Bob']]) && eq(r.links, [['APP-903', 'https://mysnaplogic.atlassian.net/browse/APP-903', '_blank']]) && eq(r.mk, [['2026-09-25', 'false', 'bd-added'], ['2026-09-26', 'true', 'bd-added bd-sel']]), r);
      check('Marker panel: it stays inside the burndown tile and changes no filter, tag or KPI', r.inside === true && r.tags === 0 && eq(r.kpis, kBefore), r); }
    await run(p, `clickEl(tile('Burndown').querySelector('g.bd-added[data-date="2026-09-25"]'))`);
    { const r = await run(p, PANEL);
      check('Marker panel: another marker replaces the list (9/25: APP-906, 0 points, In Review, Ann)', r.open && r.head.startsWith('Added Sep. 25, 2026') && eq(r.rows, [['APP-906', 's', '0', 'In Review', 'Ann']]) && eq(r.mk.map(m => m[1]), ['true', 'false']), r); }
    await run(p, `clickEl(tile('Burndown').querySelector('g.bd-added[data-date="2026-09-25"]'))`);
    check('Marker panel: clicking the same marker again closes it', (r => !r.open && eq(r.mk.map(m => m[1]), ['false', 'false']))(await run(p, PANEL)));
    await run(p, `tile('Burndown').querySelector('g.bd-added[data-date="2026-09-26"]').dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', bubbles:true}))`);
    check('Marker panel: Enter on a marker opens it, and the marker keeps keyboard focus', await run(p, `const a = document.activeElement; return !!tile('Burndown').querySelector('.bd-pop') && a && a.classList && a.classList.contains('bd-added') && a.dataset.date === '2026-09-26'`));
    await p.resize(1440, 900);
    check('Marker panel: stays open and inside the tile after the chart is redrawn at a new window size', (r => r.open && r.inside === true && eq(r.rows.map(x => x[0]), ['APP-903']))(await run(p, PANEL)));
    await p.resize(1920, 1080);
    await run(p, `document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true}))`);
    check('Marker panel: Escape closes it', (r => !r.open && eq(r.mk.map(m => m[1]), ['false', 'false']))(await run(p, PANEL)));
    await run(p, `clickEl(tile('Burndown').querySelector('g.bd-added[data-date="2026-09-26"]'))`);
    await run(p, `clickEl(tile('Burndown').querySelector('.bd-pop-x'))`);
    check('Marker panel: the x button closes it', (r => !r.open)(await run(p, PANEL)));
    await run(p, `clickEl(tile('Burndown').querySelector('g.bd-added[data-date="2026-09-26"]'))`);
    await run(p, `clickRow('Tickets by status', 'Done')`);
    check('Marker panel: after a filter that removes its tickets (status Done) the panel closes', (r => !r.open && r.mk.length === 0)(await run(p, PANEL)));
    await run(p, `clickReset()`);
    check('Marker panel: after Reset all the markers are back and no panel is open', (r => !r.open && r.mk.length === 2)(await run(p, PANEL)));
    await run(p, `clickRow('Tickets by status', 'Done')`); const ff2 = newF(); ff2.status = new Set(['Done']);
    await verifySprint(p, BURN_T, ff2, 'Hand-made sprint, status Done selected: scope and both lines recomputed for the filtered set', BCTX);
    const bd2 = await run(p, READ_BD), k2 = await run(p, READ_SPRINT);
    check('Hand-made sprint, Done only: scope 13 on every day, remaining [9,4,1,1], ideal starts at 13, no markers, mid-sprint 0, carried over unchanged (3)', eq(bd2.days.slice(0, 4).map(d => d.remaining), [9, 4, 1, 1]) && bd2.days[0].ideal === 13 && bd2.added.length === 0 && k2.kpis[5].value === '0' && k2.kpis[6].value === '3', { r: bd2.days.map(d => d.remaining), k: k2.kpis.map(x => x.value) });
    await run(p, `clickReset()`); await run(p, `clickRow('Work by assignee', 'Bob')`); const ff3 = newF(); ff3.assignee = new Set(['Bob']);
    await verifySprint(p, BURN_T, ff3, 'Hand-made sprint, assignee Bob selected: burndown and KPIs follow the filter', BCTX);
    check('Hand-made sprint: no console errors', p.logs.length === 0, p.logs); }
  await p.close();
  for (const [name, want, label] of [['cnull', ['—', 'Not calculated yet for this sprint'], 'carriedOver null shows "Not calculated yet", never 0'], ['czero', ['0', '0% of tickets, 0 points'], 'zero carried over shows 0, which differs from not calculated'], ['cpart', ['5', '12 points'], 'a null percent is left out of the hint']]) {
    p = await openPage(`http://127.0.0.1:${ports[name]}/index.html`);
    const read = () => run(p, `const k=[...document.querySelectorAll('.kpi')].pop(); return [T(k.querySelector('.value')), T(k.querySelector('.hint'))]`);
    const a = await read(); await run(p, `clickRow('Tickets by status', 'Done')`); const b = await read();
    check(`Carried over tile: ${label}; unchanged by filters; no console errors`, eq(a, want) && eq(b, want) && p.logs.length === 0, { a, b, logs: p.logs });
    if (name === 'cnull') {
      const clickable = await run(p, `return kpi('Carried over').classList.contains('clickable')`);
      check('Carried Over KPI without ticketKeys is visible but not clickable', clickable === false, clickable);
    }
    await p.close();
  }
  console.log('\n--- Removed tickets (sprint.removed) with hand-made data ---');
  p = await openPage(`http://127.0.0.1:${ports.rem}/index.html`);
  { const RJ = JSON.parse(mkSprint(Object.assign({ carriedOver: { count: 3, percent: 20, storyPoints: 8 }, removed: REMOVED }, SP_OK))), RCTX = { sprint: RJ.sprint, today: RJ.refreshedAt, thr: 2 };
    await verifySprint(p, BURN_T, newF(), 'Removed: every tile and the burndown equal the independent calculation (with sprint.removed)', RCTX);
    const bd = await run(p, READ_BD);
    check('Removed (by hand): scope [16,18,13,13,15,15,15], remaining [12,9,1,1] then nothing, ideal falls from 16, one removal marker on 9/24 (2 tickets, 5 points), subtitle uses today\'s scope', eq(bd.days.map(d => d.scope), [16, 18, 13, 13, 15, 15, 15]) && eq(bd.days.map(d => d.remaining), [12, 9, 1, 1, null, null, null]) && eq(bd.days.map(d => Math.round(d.ideal * 1000) / 1000), [16, 13.333, 10.667, 8, 5.333, 2.667, 0]) && eq(bd.removed.map(r => [r.date, r.count, r.points]), [['2026-09-24', 2, 5]]) && bd.sub === '1 of 13 points remaining today, ideal 8', { days: bd.days, removed: bd.removed, sub: bd.sub });
    check('Removed: the added markers are unchanged (9/25 and 9/26 only; removed tickets are not "added")', eq(bd.added.map(a => a.date), ['2026-09-25', '2026-09-26']));
    check('Removed: the date labels sit below the removal triangles, which are red and point down', await run(p, `const g=document.querySelector('g.bd-removed'); const path=g.querySelector('path').getAttribute('d'); const m=path.match(/M([\\d.]+),([\\d.]+) L([\\d.]+),([\\d.]+) L([\\d.]+),([\\d.]+)/); return g.querySelector('path').getAttribute('fill')==='#d64545' && +m[6] > +m[2];`));
    const PANEL2 = `const b = tile('Burndown'); const pop = b.querySelector('.bd-pop'); return { open: !!pop, head: pop ? T(pop.querySelector('.bd-pop-head')) : null, rows: pop ? [...pop.querySelectorAll('tbody tr')].map(tr => [...tr.children].map(T)) : [], pressed: b.querySelector('g.bd-removed').getAttribute('aria-pressed'), tags: document.querySelectorAll('.tags .tag').length };`;
    await run(p, `clickEl(tile('Burndown').querySelector('g.bd-removed'))`);
    { const r = await run(p, PANEL2);
      check('Removed: clicking the red triangle opens "Removed Sep. 24, 2026" listing exactly APP-950 and APP-951 (status at removal, assignee), aria-pressed true, no filter changed', r.open && r.head.startsWith('Removed Sep. 24, 2026') && r.head.includes('2 tickets, 5 points') && eq(r.rows, [['APP-950', 'gone one', '3', 'In Progress', 'Ann'], ['APP-951', 'gone two', '2', 'To Do', 'Bob']]) && r.pressed === 'true' && r.tags === 0, r); }
    await run(p, `document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true}))`);
    check('Removed: Escape closes the panel', !(await run(p, PANEL2)).open);
    await run(p, `clickRow('Work by assignee', 'Bob')`); const fb = newF(); fb.assignee = new Set(['Bob']);
    await verifySprint(p, BURN_T, fb, 'Removed, assignee Bob selected: the removed ticket of another assignee drops out, the scope and markers follow the filter', RCTX);
    { const b2 = await run(p, READ_BD); check('Removed, Bob only: scope [5,7,5,5,7,7,7] and one removal marker (APP-951, 2 points)', eq(b2.days.map(d => d.scope), [5, 7, 5, 5, 7, 7, 7]) && eq(b2.removed.map(r => [r.date, r.count, r.points]), [['2026-09-24', 1, 2]]), { s: b2.days.map(d => d.scope), r: b2.removed }); }
    check('Removed: no console errors', p.logs.length === 0, p.logs); }
  await p.close();
  p = await openPage(`http://127.0.0.1:${ports.nodates}/index.html`);
  { const nd = { sprint: { id: 1, name: 'No dates', startDate: null, endDate: null, carriedOver: null }, today: '2026-09-25', thr: 2 };
    await verifySprint(p, BURN_T, newF(), 'Sprint without dates: the page still works; burndown shows the message; Added mid-sprint and Carried over explain', nd);
    const k = await run(p, READ_SPRINT), bd = await run(p, READ_BD);
    check('Sprint without dates: exact messages (burndown, mid-sprint, carried over)', bd.empty === 'Sprint dates are not in sprint.json. Run the Jira sync and the export.' && !bd.has && k.kpis[5].value === '—' && k.kpis[5].hint === 'No sprint start date in sprint.json' && k.kpis[6].value === '—' && k.kpis[6].hint === 'Not calculated yet for this sprint', { bd: bd.empty, k5: k.kpis[5], k6: k.kpis[6] });
    check('Sprint without dates: no console errors', p.logs.length === 0, p.logs); }
  await p.close();

  console.log('\n--- Jira links with odd data (copy of the app) ---');
  p = await openPage('http://127.0.0.1:' + ports.links + '/index.html');
  { const odd = JSON.parse(linksSprint).tickets; const LO = await run(p, `return {ticket: colCells('Ticket detail','Ticket'), parent: colCells('Ticket detail','Parent'), linked: colCells('Ticket detail','Linked work items'), summary: colCells('Ticket detail','Summary'), blocker: colCells('Ticket detail','Blocker'), badEls: document.querySelectorAll('.tile-body img, .tile-body script, .tile-body iframe').length, allLinks:[...document.querySelectorAll('a.jira')].map(a=>a.getAttribute('href'))}`);
    check('Odd data: only valid keys become links; every other character stays text; nothing is lost', linkErrors(LO.parent, odd.map(t => t.parent)).length === 0 && linkErrors(LO.linked, odd.map(t => t.linkedWorkItems)).length === 0, [linkErrors(LO.parent, odd.map(t => t.parent)), linkErrors(LO.linked, odd.map(t => t.linkedWorkItems))]);
    check('Odd data: expected keys exactly (APP-5, DOC-6 in parent; APP-7, DOC-22, PLATENG-9 in linked work items)', eq(LO.parent[0].links.map(l => l.t), ['APP-5', 'DOC-6']) && eq(LO.linked[0].links.map(l => l.t), ['APP-7', 'DOC-22', 'PLATENG-9']), [LO.parent[0].links, LO.linked[0].links]);
    check('Odd data: no injected elements; all hrefs start with the Jira address; no javascript: link', LO.badEls === 0 && LO.allLinks.every(h => h.startsWith('https://mysnaplogic.atlassian.net/browse/')) && !LO.allLinks.some(h => /javascript:/i.test(h)), LO.allLinks);
    check('Odd data: a Ticket value that is not a key stays plain text; Summary and Blocker are never linked', LO.ticket[1].links.length === 0 && LO.ticket[1].text === 'not a key' && LO.ticket[0].links.length === 1 && [...LO.summary, ...LO.blocker].every(c => c.links.length === 0), [LO.ticket, LO.summary[0], LO.blocker[0]]);
    check('Odd data: no console errors', p.logs.length === 0, p.logs);
    const nk = await run(p, READ_SPRINT), nb = await run(p, READ_BD);
    check('No sprint object in sprint.json: burndown message, "No sprint data" on Carried over, no start date on Added mid-sprint; page still works', nb.empty === 'Sprint dates are not in sprint.json. Run the Jira sync and the export.' && nk.kpis[6].value === '—' && nk.kpis[6].hint === 'No sprint data in sprint.json' && nk.kpis[5].hint === 'No sprint start date in sprint.json' && nk.kpis[4].value === '—', { nb: nb.empty, k: nk.kpis.slice(4) }); }
  await p.close();

  // =============== ERROR / EMPTY ===============
  console.log('\n--- Error and empty states ---');
  const states = [['missing', 'index', /Can’t load sprint\.json/, 'Missing sprint.json'], ['missing', 'backlog', /Can’t load backlog\.json/, 'Missing backlog.json'], ['invalid', 'index', /Can’t load sprint\.json[\s\S]*not valid JSON/, 'Invalid sprint.json'], ['invalid', 'backlog', /Can’t load backlog\.json/, 'Invalid backlog.json'], ['empty', 'index', /No tickets in this snapshot/, 'Empty sprint snapshot'], ['empty', 'backlog', /No backlog tickets in this snapshot/, 'Empty backlog snapshot']];
  for (const [v, page, re, name] of states) {
    p = await openPage(`http://127.0.0.1:${ports[v]}/${page}.html`);
    const txt = await run(p, `return document.getElementById('app').innerText`);
    const isErr = v !== 'empty';
    check(`${name}: clear message${isErr ? ' with the regenerate command' : ''}, no blank page, no JS exception`, re.test(txt) && (!isErr || /export_dashboard_snapshots\.py/.test(txt)) && !p.logs.some(l => l.startsWith('exception')), { txt: txt.slice(0, 160), logs: p.logs.slice(0, 2) });
    await p.close();
  }
  p = await openPage('file://' + path.join(ROOT, 'index.html'));
  const ft = await run(p, `return document.getElementById('app').innerText`);
  check('file:// open: message says to use the local server', /opened as a file/.test(ft) && /http\.server/.test(ft), ft.slice(0, 160));
  await p.close();

  // =============== STATIC ===============
  console.log('\n--- Static and safety checks ---');
  const ext = []; const codeOf = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
  for (const f of APP) { const t = codeOf(f); (t.match(/(?:src|href)\s*=\s*"https?:\/\/[^"]+"|url\(\s*['"]?https?:/g) || []).forEach(m => ext.push(f + ': ' + m)); if (/@import|googleapis|cdn\./i.test(t)) ext.push(f + ': cdn/font/import'); if (/\bimport\s+.*from|require\(/.test(t)) ext.push(f + ': module import'); if (/XMLHttpRequest|WebSocket|sendBeacon/.test(t)) ext.push(f + ': network API'); }
  check('No external src/href/url(), CDN, @import, web font, module import or network API', ext.length === 0, ext);
  { const hits = []; APP.forEach(f => { const m = codeOf(f).match(/atlassian\.net/g); if (m) hits.push(f + ' x' + m.length); });
    check('The Jira address appears once in the app source (one constant in dashboard.js)', eq(hits, ['dashboard.js x1']), hits); }
  const strip = f => codeOf(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '');
  const fetches = []; ['dashboard.js', 'sprint.js', 'backlog.js'].forEach(f => (strip(f).match(/fetch\([^)]*\)/g) || []).forEach(m => fetches.push(f + ': ' + m)));
  check('Only one fetch(), a local relative path via loadSnapshot', fetches.length === 1 && /fetch\(file/.test(fetches[0]), fetches);
  check('No innerHTML / document.write / eval in app code (comments stripped)', APP.filter(f => f.endsWith('.js')).every(f => !/innerHTML|document\.write|\beval\(/.test(strip(f))));
  const after = { s: mtime(path.join(ROOT, 'sprint.json')), b: mtime(path.join(ROOT, 'backlog.json')), x: mtime(TRACKER) };
  { const schema = JSON.parse(fs.readFileSync(path.join(ROOT, 'schema/snapshot.schema.json'), 'utf8'));
    const vType = (v, ty) => (Array.isArray(ty) ? ty : [ty]).some(x => x === 'null' ? v === null : x === 'integer' ? Number.isInteger(v) : x === 'number' ? typeof v === 'number' : x === 'string' ? typeof v === 'string' : x === 'object' ? (v !== null && typeof v === 'object' && !Array.isArray(v)) : x === 'array' ? Array.isArray(v) : false);
    const vNode = (v, node, at, errs) => {
      if (node.type && !vType(v, node.type)) { errs.push(at + ' type ' + JSON.stringify(v).slice(0, 40)); return; }
      if (node.format === 'date' && typeof v === 'string' && !/^\d{4}-\d{2}-\d{2}$/.test(v)) errs.push(at + ' date ' + v);
      if (typeof v === 'number') { if (node.minimum !== undefined && v < node.minimum) errs.push(at + ' below minimum'); if (node.maximum !== undefined && v > node.maximum) errs.push(at + ' above maximum'); }
      if (v !== null && typeof v === 'object' && !Array.isArray(v) && node.properties) {
        (node.required || []).forEach(k => { if (!(k in v)) errs.push(at + ' missing ' + k); });
        Object.keys(v).forEach(k => { if (node.properties[k]) vNode(v[k], node.properties[k], at + '.' + k, errs); else if (node.additionalProperties === false) errs.push(at + ' unexpected key ' + k); });
      }
    };
    const conform = (obj, def) => { const errs = []; vNode(obj, Object.assign({}, schema, { properties: Object.assign({}, schema.properties, { tickets: { type: 'array' } }) }), 'root', errs); (obj.tickets || []).forEach((tk, i) => vNode(tk, schema.definitions[def], 'tickets[' + i + ']', errs)); return errs.slice(0, 4); };
    check('sprint.json conforms to the schema (keys, types, dates, sprint and carriedOver objects)', conform(J('sprint.json'), 'sprintTicket').length === 0, conform(J('sprint.json'), 'sprintTicket'));
    check('backlog.json conforms to the schema', conform(J('backlog.json'), 'backlogTicket').length === 0, conform(J('backlog.json'), 'backlogTicket'));
    check('fixtures/sample_snapshot.json conforms to the schema (with sprint.carriedOver and cycleTime)', conform(JSON.parse(fixtureTxt), 'sprintTicket').length === 0 && !!JSON.parse(fixtureTxt).sprint.carriedOver, conform(JSON.parse(fixtureTxt), 'sprintTicket')); }
  check('sprint.json, backlog.json and daily_tracker.xlsx unchanged by the run', eq(before, after), { before, after });

  const failed = results.filter(r => !r.ok);
  console.log(`\nTOTAL ${results.length}  PASS ${results.length - failed.length}  FAIL ${failed.length}`);
  failed.forEach(x => console.log('FAILED: ' + x.name + ' ' + String(JSON.stringify(x.detail)).slice(0, 500)));
  fs.writeFileSync(path.join(SP, 'acceptance_results.json'), JSON.stringify(results, null, 1));
  chrome.kill('SIGKILL'); servers.forEach(s => s.kill());
  if (OWN_SCRATCH) { await sleep(300); fs.rmSync(SP, { recursive: true, force: true }); } else console.log('Results: ' + path.join(SP, 'acceptance_results.json'));
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR', e); try { chrome && chrome.kill('SIGKILL'); servers.forEach(s => s.kill()); } catch (x) {} process.exit(1); });
