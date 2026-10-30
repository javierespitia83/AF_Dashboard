'use strict';
/*
 * page.js — JavaScript snippets the harness evaluates inside the page (as strings, over the DevTools protocol).
 * They read the DOM contract documented in IMPLEMENTATION.md (class names, data-* attributes); if the app
 * renames one, change it here in the same pass. Tile names come from ui_text.js.
 */
const { UI } = require('./ui_text');
const q = JSON.stringify;
const ST = UI.sprint.tiles, BT = UI.backlog.tiles;

// Helpers defined at the start of every snippet.
const H = `
const T = n => { const c=n.cloneNode(true); c.querySelectorAll('.detail-sort-arrow').forEach(x=>x.remove()); return c.textContent.replace(/\\s+/g,' ').trim(); };
const tile = t => [...document.querySelectorAll('section.tile')].find(s => { const h = s.querySelector('h2'); return h && h.textContent.trim() === t; });
const kpi = t => [...document.querySelectorAll('.kpi')].find(k => T(k.querySelector('.label')) === t);
const rowsOf = t => [...tile(t).querySelectorAll('.tile-body .rowbtn')];
const clickEl = (el, o={}) => el.dispatchEvent(new MouseEvent('click', {bubbles:true, cancelable:true, ctrlKey: !!o.ctrl, metaKey: !!o.meta, shiftKey: !!o.shift}));
const clickRow = (t, name, o) => { const r = rowsOf(t).find(r => T(r.querySelector('.name')) === name); if(!r) throw new Error('row not found: '+t+' / '+name); clickEl(r, o); };
const setDim = (dim, values) => AF.store.set(dim, values); // for dimensions with no clickable row (Assignee, Tester outside a matrix cell)
const clickCell = (t, rowName, colName, o) => { const tl = tile(t); const hdr=[...tl.querySelectorAll('thead th')].map(T); const ci = hdr.indexOf(colName); const tr=[...tl.querySelectorAll('tbody tr')].find(tr => T(tr.querySelector('th'))===rowName); if(!tr) throw new Error('matrix row not found '+rowName); const td = tr.querySelectorAll('td')[ci-1]; const b = td && td.querySelector('button'); if(!b) throw new Error('cell not clickable '+rowName+'/'+colName); clickEl(b, o); };
const clickReset = () => clickEl(document.querySelector('.resetall'));
const clickTagX = i => clickEl(document.querySelectorAll('.tag .tag-x')[i]);
const setSel = (id, v) => { const s=document.getElementById(id); s.value=v; s.dispatchEvent(new Event('change',{bubbles:true})); };
const setQ = v => { const i=document.getElementById('q'); i.value=v; i.dispatchEvent(new Event('input',{bubbles:true})); };
const readCommon = () => ({ kpis: [...document.querySelectorAll('.kpi')].map(k=>({label:T(k.querySelector('.label')),value:T(k.querySelector('.value')),hint:T(k.querySelector('.hint'))})), tags:[...document.querySelectorAll('.tags .tag > span')].map(T), noFilterMsg: !!document.querySelector('.nofilter'), resetDisabled: document.querySelector('.resetall').disabled, asof: T(document.getElementById('asof')) });
const colCells = (t, col) => { const tl = tile(t); const hdr=[...tl.querySelectorAll('thead th')].map(T); const ix=hdr.indexOf(col); return [...tl.querySelectorAll('tbody tr')].map(tr=>{ const td=tr.children[ix]; return { text: T(td), links: [...td.querySelectorAll('a')].map(a=>({ t:T(a), h:a.getAttribute('href'), target:a.getAttribute('target'), rel:a.getAttribute('rel'), cls:a.className })), foreign: td.querySelectorAll('img,script,iframe,style,svg').length }; }); };
const emptyIn = t => { const e = tile(t).querySelector('.tile-body .empty'); return e ? T(e) : null; };
const matrixOf = t => { const tl=tile(t); const hdr=[...tl.querySelectorAll('thead th')].map(T); const titles=[...tl.querySelectorAll('thead th')].map(th=>th.getAttribute('title')); const o={}; const colTotals={}; const sel=[]; const dim=[]; tl.querySelectorAll('tbody tr').forEach(tr=>{const rn=T(tr.querySelector('th')); o[rn]={}; [...tr.querySelectorAll('td')].forEach((td,i)=>{const b=td.querySelector('button'); if(b){o[rn][hdr[i+1]]=+T(b); colTotals[hdr[i+1]]=(colTotals[hdr[i+1]]||0)+(+T(b)); if(b.classList.contains('is-selected')) sel.push(rn+'|'+hdr[i+1]); if(td.classList.contains('is-dimmed')) dim.push(rn+'|'+hdr[i+1]);}});}); return {o, sel, dim, hdr, titles, colTotals}; };
const rgbOf = s => { const m = String(s).match(/[\\d.]+/g) || []; return m.slice(0, 4).map(Number); };
// colour actually painted behind an element: walk up until an opaque background, blending translucent layers
const paintedBg = el => { const layers=[]; for (let n=el; n; n=n.parentElement) { const c=rgbOf(getComputedStyle(n).backgroundColor); const a=c.length===4?c[3]:1; if (a>0) layers.push([c[0],c[1],c[2],a]); if (a>=1) break; } let out=[255,255,255]; for (let i=layers.length-1;i>=0;i--){ const [r,g,b,a]=layers[i]; out=[r*a+out[0]*(1-a), g*a+out[1]*(1-a), b*a+out[2]*(1-a)]; } return out; };
const effOpacity = el => { let o=1; for (let n=el; n; n=n.parentElement) o*=+getComputedStyle(n).opacity; return o; };
`;
const run = (p, body) => p.ev(`(()=>{${H}${body}})()`);

const READ_BD = `
const b = tile(${q(ST.burndown)}); const s = b.querySelector('svg.burndown'); const body = b.querySelector('.tile-body'); const emp = body.querySelector('.empty'); const act = s && s.querySelector('polyline.bd-actual');
const dt = body.querySelector('.bd-data');
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
  actualPoints: act ? act.getAttribute('points').split(' ').length : 0, todayLabel: s ? [...s.querySelectorAll('text')].some(x => x.textContent === ${q(UI.sprint.burndown.today)}) : false,
  legend: s ? [...s.querySelectorAll('text')].map(x => x.textContent).join('|') : '', foot: T(b.querySelector('.tile-foot')), svgW: s ? +s.getAttribute('width') : 0, bodyW: body.clientWidth, bodyOverflow: body.scrollHeight - body.clientHeight, bodyOv: getComputedStyle(body).overflowY,
  dataTable: dt ? { hidden: dt.classList.contains('visually-hidden') && dt.getBoundingClientRect().width <= 1, hdr: [...dt.querySelectorAll('thead th')].map(T), rows: [...dt.querySelectorAll('tbody tr')].map(tr => [...tr.children].map(T)) } : null };
`;

const READ_SPRINT = `
const c = readCommon();
const status = {}, statusRaw = {}, statusSel = [], statusDim = [], types = {}, typeRaw = {}, typeIcons = {}, typeSel = [], typeDim = [];
rowsOf(${q(ST.status)}).forEach(r => { const n=T(r.querySelector('.name')); const raw=T(r.querySelector('.pair')); const [i,pp]=raw.split(' | '); status[n]=[parseInt(i,10),parseInt(pp,10)]; statusRaw[n]=raw; if(r.classList.contains('is-selected')) statusSel.push(n); if(r.classList.contains('is-dimmed')) statusDim.push(n); });
rowsOf(${q(ST.type)}).forEach(r => { const label=r.querySelector('.name'), n=T(label); const raw=T(r.querySelector('.pair')); const [i,pp]=raw.split(' | '); types[n]=[parseInt(i,10),parseFloat(pp)]; typeRaw[n]=raw; typeIcons[n]=label.querySelector('svg.ico')?.getAttribute('data-icon')||null; if(r.classList.contains('is-selected')) typeSel.push(n); if(r.classList.contains('is-dimmed')) typeDim.push(n); });
const at = tile(${q(ST.attention)}); const attention = { sub: T(at.querySelector('.sub')), hdr: [...at.querySelectorAll('thead th')].map(T), rows: [...at.querySelectorAll('tbody tr')].map(tr => ({ key: T(tr.children[0]), status: T(tr.children[1]), days: T(tr.children[2]), reasons: [...tr.children[3].querySelectorAll('.reason')].map(T), links: [...tr.querySelectorAll('a')].map(a => a.getAttribute('href')) })), foot: T(at.querySelector('.tile-foot')), text: T(at), empty: emptyIn(${q(ST.attention)}) };
const det = tile(${q(ST.detail)}); const keys=[...det.querySelectorAll('tbody tr')].map(tr=>T(tr.children[0]));
const statusFoot = T(tile(${q(ST.status)}).querySelector('.tile-foot'));
return Object.assign(c, { status, statusRaw, statusSel, statusDim, types, typeRaw, typeIcons, typeSel, typeDim, typeFoot:T(tile(${q(ST.type)}).querySelector('.tile-foot')), attention, matrix: matrixOf(${q(ST.matrix)}), detailKeys: keys, detailSub: T(det.querySelector('.sub')), detailEmpty: emptyIn(${q(ST.detail)}), empties: {status: emptyIn(${q(ST.status)}), type: emptyIn(${q(ST.type)}), attention: attention.empty, matrix: emptyIn(${q(ST.matrix)})}, statusFoot });
`;


const READ_BACKLOG = `
const c = readCommon();
const dist = t => { const o={}, sel=[], dim=[]; rowsOf(t).forEach(r=>{ const n=T(r.querySelector('.name')); o[n]=+T(r.querySelector('.n')); if(r.classList.contains('is-selected')) sel.push(n); if(r.classList.contains('is-dimmed')) dim.push(n); }); return {o, sel, dim, order:Object.keys(o)}; };
const tb = tile(${q(BT.table)}); const hdr=[...tb.querySelectorAll('thead th')].map(T);
const rows=[...tb.querySelectorAll('tbody tr')].map(tr=>[...tr.children].map(T));
return Object.assign(c, { dor: dist(${q(BT.dor)}), priority: dist(${q(BT.priority)}), type: dist(${q(BT.type)}), age: dist(${q(BT.age)}), matrix: matrixOf(${q(BT.matrix)}), hdr, keys: rows.map(r=>r[0]), rows, sub: T(tb.querySelector('.sub')), tableEmpty: emptyIn(${q(BT.table)}), empties:{dor:emptyIn(${q(BT.dor)}),priority:emptyIn(${q(BT.priority)}),type:emptyIn(${q(BT.type)}),age:emptyIn(${q(BT.age)}),matrix:emptyIn(${q(BT.matrix)})}, q: document.getElementById('q').value });
`;

// Page geometry: scroll size, tile boxes, tile body overflow, elements beyond the viewport.
const LAYOUT = `const d=document.scrollingElement; const bodies=[...document.querySelectorAll('.tile-body')].map(b=>({sh:b.scrollHeight,ch:b.clientHeight,ov:getComputedStyle(b).overflowY})); const tiles=[...document.querySelectorAll('section.tile')].map(t=>{const r=t.getBoundingClientRect(); return {l:Math.round(r.left), r:Math.round(r.right), t:Math.round(r.top), b:Math.round(r.bottom), w:Math.round(r.width), h:Math.round(r.height), title:(t.querySelector('h2')||t.querySelector('.label')).textContent.trim()};}); const bad=[]; document.querySelectorAll('body *').forEach(n=>{ if(n.closest('.tile-body')||n.closest('.visually-hidden')) return; const r=n.getBoundingClientRect(); if(r.width>0 && r.right>innerWidth+1) bad.push(n.tagName+'.'+n.className+':'+Math.round(r.right)); }); return {iw:innerWidth, ih:innerHeight, sw:d.scrollWidth, sh:d.scrollHeight, bodies, tiles, bad:bad.slice(0,5)};`;

// Scroll regions: every scroll box is focusable + labelled exactly when it scrolls (C19).
const SCROLL_REGIONS = `return [...document.querySelectorAll('.tile-body, .qi-ticket-scroll')].map(b => { const cs=getComputedStyle(b); const can=/auto|scroll/.test(cs.overflowY+' '+cs.overflowX); const scrolls = can && (b.scrollHeight > b.clientHeight + 1 || b.scrollWidth > b.clientWidth + 1); return { scrolls, tabindex: b.getAttribute('tabindex'), role: b.getAttribute('role'), label: b.getAttribute('aria-label') }; });`;

// Search state (R001-19): input, clear button, URL parameter q, tags, and the rows of a table tile.
const READ_SEARCH = t => `const i=document.getElementById('q'), c=document.querySelector('.search-clear'), tb=tile(${q(t)});
return { value: i.value, placeholder: i.placeholder, clearHidden: c ? c.hidden : null, url: new URLSearchParams(location.search).get('q'), sprintParam: new URLSearchParams(location.search).get('sprint'),
  tags: readCommon().tags, keys: [...tb.querySelectorAll('tbody tr')].map(tr=>T(tr.children[0])), sub: T(tb.querySelector('.sub')), empty: emptyIn(${q(t)}) };`;

module.exports = { H, run, READ_BD, READ_SPRINT, READ_BACKLOG, READ_SEARCH, LAYOUT, SCROLL_REGIONS };
