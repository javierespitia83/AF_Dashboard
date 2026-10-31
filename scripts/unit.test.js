'use strict';
/*
 * unit.test.js — unit tests for the pure parts of dashboard.js and for the harness's JSON Schema validator.
 * Run: node --test scripts/unit.test.js   (built into Node 22+, no npm). The acceptance harness runs it too.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const AF = require('../dashboard.js');
const { validate, unsupportedKeywords, isDate, isDateTime } = require('./lib/schema');

const T = o => Object.assign({ ticket: 'APP-1', owner: 'Ann', tester: 'Tim', status: 'Done', points: 1 }, o);

test('dashboard.js loads in Node without a DOM and exports AF', () => {
  assert.equal(typeof AF.createStore, 'function');
  assert.equal(typeof AF.burndown, 'function');
});

test('bucketOf maps statuses to buckets; unknown and null go to Other', () => {
  assert.deepEqual(['To Do', 'Open', 'In Progress', 'In Review', 'Done', 'Blocked', null].map(AF.bucketOf), [0, 0, 1, 2, 3, 4, 4]);
});

test('value helpers follow DATA_CONTRACT §4', () => {
  assert.equal(AF.isBlank(' '), true); assert.equal(AF.isBlank(0), false);
  assert.equal(AF.pts(null), 0); assert.equal(AF.pts('3'), 0); assert.equal(AF.pts(2.5), 2.5); assert.equal(AF.pts(NaN), 0);
  assert.equal(AF.fmtNum(3), '3'); assert.equal(AF.fmtNum(1 / 3), '0.33');
  assert.equal(AF.show(null), '—'); assert.equal(AF.showPoints(null), '—'); assert.equal(AF.showPoints(0), '0');
  assert.equal(AF.personName(null), 'Unassigned'); assert.equal(AF.personName(' Unassigned '), 'Unassigned'); assert.equal(AF.personName('Bo'), 'Bo');
  assert.equal(AF.oneDecimal(3.333), '3.3');
});

test('naturalCompare puts 4.9 before 4.10 and APP-9 before APP-10', () => {
  assert.deepEqual(['4.10', '4.9', '4.46'].sort(AF.naturalCompare), ['4.9', '4.10', '4.46']);
  assert.deepEqual(['APP-10', 'APP-9'].sort(AF.naturalCompare), ['APP-9', 'APP-10']);
});

test('statusTotals, sum, countBy, median', () => {
  const rows = [T({ status: 'Open', points: 2 }), T({ status: 'Done', points: null }), T({ status: 'Weird', points: 3 })];
  assert.deepEqual(AF.statusTotals(rows).map(x => [x.items, x.points]), [[1, 2], [0, 0], [0, 0], [1, 0], [1, 3]]);
  assert.equal(AF.sum(rows, 'points'), 5);
  assert.deepEqual(AF.countBy(rows, t => t.status), { Open: 1, Done: 1, Weird: 1 });
  assert.equal(AF.median([]), null); assert.equal(AF.median([3, 1, 2]), 2); assert.equal(AF.median([4, 1, 2, 3]), 2.5);
});

test('aggregateBy sorts by points then name and totals every group', () => {
  const r = AF.aggregateBy([T({ owner: 'B', points: 1 }), T({ owner: 'A', points: 1 }), T({ owner: 'C', points: 5 })], t => t.owner);
  assert.deepEqual(r.rows.map(x => x.name), ['C', 'A', 'B']);
  assert.deepEqual(r.totals, { itemsTotal: 3, pointsTotal: 7 });
});

test('crossTab orders by totals, pushes lastCol last, honours given orders and reports the max', () => {
  const rows = [T({ owner: 'A', tester: 'Unassigned' }), T({ owner: 'A', tester: 'Unassigned' }), T({ owner: 'A', tester: 'X' }), T({ owner: 'B', tester: 'X' })];
  const ct = AF.crossTab(rows, t => t.owner, t => t.tester, { lastCol: 'Unassigned' });
  assert.deepEqual(ct.rows, ['A', 'B']); assert.deepEqual(ct.cols, ['X', 'Unassigned']); assert.equal(ct.max, 2);
  const given = AF.crossTab(rows, t => t.owner, t => t.tester, { rowOrder: ['B', 'A', 'Z'], colOrder: ['Unassigned', 'X'] });
  assert.deepEqual(given.rows, ['B', 'A']); assert.deepEqual(given.cols, ['Unassigned', 'X']);
});

test('crossTab lastCols pushes several columns last in the given order (Self-tested, then Unassigned)', () => {
  const rows = [T({ tester: 'Self-tested' }), T({ tester: 'Self-tested' }), T({ tester: 'Self-tested' }), T({ tester: 'Unassigned' }), T({ tester: 'X' })];
  const ct = AF.crossTab(rows, t => t.owner, t => t.tester, { lastCols: ['Self-tested', 'Unassigned'] });
  assert.deepEqual(ct.cols, ['X', 'Self-tested', 'Unassigned']);
});

test('createStore: plain click selects only, second click clears, multi toggles, OR within and AND across', () => {
  const s = AF.createStore({ status: { label: 'Status', get: t => t.status }, owner: { label: 'Owner', get: t => t.owner } });
  const rows = [T({ ticket: 'a', status: 'Done', owner: 'A' }), T({ ticket: 'b', status: 'Open', owner: 'A' }), T({ ticket: 'c', status: 'Done', owner: 'B' })];
  s.click('status', 'Done'); assert.deepEqual(s.apply(rows).map(t => t.ticket), ['a', 'c']);
  s.click('status', 'Open'); assert.deepEqual([...s.sel.status], ['Open']);
  s.click('status', 'Done', true); assert.deepEqual(s.apply(rows).map(t => t.ticket), ['a', 'b', 'c']);
  s.click('owner', 'A'); assert.deepEqual(s.apply(rows).map(t => t.ticket), ['a', 'b']);
  assert.deepEqual(s.apply(rows, 'owner').map(t => t.ticket), ['a', 'b', 'c']); // a tile ignores its own dimension
  s.click('owner', 'A'); assert.equal(s.sel.owner.size, 0);
  s.clickPair('status', 'Done', 'owner', 'B'); assert.deepEqual(s.apply(rows).map(t => t.ticket), ['c']);
  s.clickPair('status', 'Done', 'owner', 'B'); assert.equal(s.isActive(), false);
});

test('createStore: matches() dimensions, search and tags', () => {
  const s = AF.createStore({ member: { label: 'Team member', matches: (t, sel) => sel.has(t.owner) || sel.has(t.tester) } });
  const rows = [T({ ticket: 'a', owner: 'A', tester: 'X' }), T({ ticket: 'b', owner: 'B', tester: 'A' }), T({ ticket: 'c', owner: 'C', tester: 'C' })];
  s.click('member', 'A'); assert.deepEqual(s.apply(rows).map(t => t.ticket), ['a', 'b']);
  s.setSearch('b', t => t.ticket === 'b', 'Search: b'); assert.deepEqual(s.apply(rows).map(t => t.ticket), ['b']);
  assert.deepEqual(s.tags(), [{ dim: 'member', label: 'Team member', value: 'A' }]);
  s.reset(); assert.equal(s.isActive(), false); assert.equal(s.search.pred, null);
});

test('createStore extra filter slot (sprint KPI filters, C10): scoped, tagged, removable, reset, with an "extra" emit reason', () => {
  const s = AF.createStore({ status: { label: 'Status', get: t => t.status } });
  const rows = [T({ ticket: 'a', status: 'Done' }), T({ ticket: 'b', status: 'Open' })];
  const reasons = []; s.subscribe(r => reasons.push(r));
  s.setExtra({ id: 'x', label: 'KPI', value: 'Only a', pred: t => t.ticket === 'a' });
  assert.deepEqual(reasons, ['extra']);
  assert.equal(s.apply(rows).length, 2, 'not applied unless asked');
  assert.deepEqual(s.apply(rows, null, { withExtra: true }).map(t => t.ticket), ['a']);
  assert.equal(s.isActive(), true); assert.equal(s.isActive({ extra: false }), false);
  assert.deepEqual(s.tags(), [{ dim: s.EXTRA_DIM, label: 'KPI', value: 'Only a' }]);
  s.click('status', 'Open'); // a regular filter is independent of the extra one
  assert.deepEqual(s.apply(rows, null, { withExtra: true }).map(t => t.ticket), []);
  s.remove(s.EXTRA_DIM, 'Only a'); assert.equal(s.extra(), null); assert.deepEqual([...s.sel.status], ['Open']);
  s.setExtra({ id: 'x', label: 'KPI', value: 'v', pred: () => true }); s.reset();
  assert.equal(s.extra(), null); assert.equal(s.isActive(), false); assert.equal(reasons[reasons.length - 1], undefined);
});

test('dates: dayNum, isoOf, shortDate, longDate', () => {
  assert.equal(AF.isoOf(AF.dayNum('2026-09-28')), '2026-09-28');
  assert.ok(Number.isNaN(AF.dayNum('2026-9-28'))); assert.ok(Number.isNaN(AF.dayNum(null)));
  assert.equal(AF.shortDate('2026-09-08'), '9/8'); assert.equal(AF.longDate('2026-09-28'), 'Sep. 28, 2026');
});

test('midSprintAdded compares real dates and ignores values that are not YYYY-MM-DD (C13)', () => {
  const sprint = { startDate: '2026-09-22', endDate: '2026-09-28' };
  const rows = [T({ addedDate: '2026-09-23', points: 1 }), T({ addedDate: '2026-09-24', points: 2 }), T({ addedDate: '24/09/2026', points: 4 }), T({ addedDate: '2026-9-30', points: 8 }), T({ addedDate: null, points: 16 })];
  const m = AF.midSprintAdded(rows, sprint, 1);
  assert.equal(m.thresholdDate, '2026-09-23'); assert.equal(m.count, 1); assert.equal(m.points, 2);
  assert.equal(AF.midSprintAdded(rows, { startDate: null }, 1), null);
});

test('burndown: the hand-made sprint of the acceptance harness (threshold 2)', () => {
  const sprint = { startDate: '2026-09-22', endDate: '2026-09-28' };
  const K = o => T(Object.assign({ addedDate: '2026-09-22', doneDate: null }, o));
  const rows = [K({ ticket: 'APP-901', points: 5, doneDate: '2026-09-23' }), K({ ticket: 'APP-902', points: 3, doneDate: '2026-09-24' }),
    K({ ticket: 'APP-903', status: 'In Progress', points: 2, addedDate: '2026-09-26' }), K({ ticket: 'APP-904', points: 4, doneDate: '2026-09-20' }),
    K({ ticket: 'APP-905', points: 1 }), K({ ticket: 'APP-906', status: 'In Review', points: null, addedDate: '2026-09-25' })];
  const m = AF.burndown(rows, sprint, '2026-09-25', 2, []);
  assert.deepEqual(m.days.map(d => d.remaining), [9, 4, 1, 1, null, null, null]);
  assert.deepEqual(m.days.map(d => d.scope), [13, 13, 13, 13, 15, 15, 15]);
  assert.equal(m.unplacedDone, 1); assert.equal(m.todayInside, true); assert.equal(m.total, 15);
  assert.deepEqual(Object.keys(m.addedByDate).sort(), ['2026-09-25', '2026-09-26']);
  assert.deepEqual(Object.keys(m.midByDate).sort(), ['2026-09-25', '2026-09-26']); // both after start + 2 days
  const closed = AF.burndown(rows, sprint, '2026-09-25', 2, [], { closed: true });
  assert.equal(closed.todayIndex, 6); assert.equal(closed.todayInside, false);
  assert.equal(AF.burndown(rows, { startDate: '2026-09-28', endDate: '2026-09-22' }, '2026-09-25', 2, []), null);
});

test('burndown: removed tickets step the scope up on entry and down on removal; invalid removal dates are ignored', () => {
  const sprint = { startDate: '2026-09-22', endDate: '2026-09-24' };
  const m = AF.burndown([], sprint, '2026-09-24', 1, [
    { ticket: 'R1', points: 3, removedDate: '2026-09-23' }, { ticket: 'R2', points: 5, removedDate: 'soon' }]);
  assert.deepEqual(m.days.map(d => d.scope), [3, 0, 0]);
  assert.deepEqual(Object.keys(m.removedByDate), ['2026-09-23']);
});

test('niceScale and heatColor (ramp capped so ink keeps 4.5:1; dimmed cells lighter)', () => {
  assert.deepEqual(AF.niceScale(0), { top: 1, step: 1 }); assert.deepEqual(AF.niceScale(173), { top: 200, step: 50 });
  assert.equal(AF.heatColor(0, 5), '');
  assert.equal(AF.heatColor(5, 5), 'rgba(42, 157, 143, 0.80)');
  assert.equal(AF.heatColor(5, 5, true), 'rgba(42, 157, 143, 0.20)');
  assert.equal(AF.heatColor(1, 10), 'rgba(42, 157, 143, 0.19)');
});

test('avgCycleTime counts only Done tickets with a numeric cycle time', () => {
  assert.deepEqual(AF.avgCycleTime([T({ cycleTime: 2 }), T({ cycleTime: 4 }), T({ status: 'Open', cycleTime: 9 }), T({ cycleTime: null })]), { avg: 3, n: 2 });
  assert.deepEqual(AF.avgCycleTime([]), { avg: null, n: 0 });
});

// ---------- the harness validator ----------
const schemaDir = path.join(__dirname, '..', 'schema');
const S = f => JSON.parse(fs.readFileSync(path.join(schemaDir, f), 'utf8'));

test('validator: types, required, additionalProperties, enum, const, pattern, formats, ranges', () => {
  const sch = { type: 'object', required: ['a'], additionalProperties: false, properties: {
    a: { type: 'integer', minimum: 1 }, b: { type: ['string', 'null'], format: 'date' }, c: { enum: ['x', 'y'] }, d: { const: 3 },
    e: { type: 'string', pattern: '^A-[0-9]+$', minLength: 3 }, f: { type: 'number', maximum: 100 }, g: { type: 'string', format: 'date-time' } } };
  assert.deepEqual(validate(sch, { a: 1, b: null, c: 'x', d: 3, e: 'A-12', f: 100, g: '2026-10-29T10:00:00-07:00' }), []);
  const errs = validate(sch, { a: 0, b: '2026-02-30', c: 'z', d: 4, e: 'B', f: 101, g: '2026-10-29 10:00', z: 1 });
  ['below minimum', 'not a YYYY-MM-DD date', 'not one of', 'must be 3', 'does not match', 'shorter than', 'above maximum', 'RFC 3339', 'unexpected key z'].forEach(w => assert.ok(errs.some(e => e.includes(w)), w));
  assert.ok(validate(sch, {}).some(e => e.includes('missing a')));
  assert.ok(validate({ type: 'number' }, NaN).length === 1, 'non-finite numbers are not JSON numbers');
  assert.ok(validate({ type: 'integer' }, 1.5).length === 1);
});

test('validator: $ref to $defs and definitions, items, uniqueItems, contains with min/max, anyOf', () => {
  const sch = { $defs: { s: { type: 'object', required: ['state'], properties: { state: { enum: ['active', 'closed'] } } } }, definitions: { n: { type: 'integer' } },
    type: 'object', properties: { list: { type: 'array', minItems: 1, uniqueItems: true, items: { $ref: '#/$defs/s' }, contains: { properties: { state: { const: 'active' } }, required: ['state'] }, minContains: 1, maxContains: 1 },
      n: { $ref: '#/definitions/n' }, either: { anyOf: [{ type: 'string' }, { type: 'integer' }] } } };
  assert.deepEqual(validate(sch, { list: [{ state: 'active' }, { state: 'closed' }], n: 2, either: 'x' }), []);
  assert.ok(validate(sch, { list: [{ state: 'closed' }] }).some(e => e.includes('contains')));
  assert.ok(validate(sch, { list: [{ state: 'active' }, { state: 'active' }] }).some(e => e.includes('not unique') || e.includes('contains')));
  assert.ok(validate(sch, { list: [{ state: 'open' }] }).some(e => e.includes('not one of')));
  assert.ok(validate(sch, { n: 'x' }).length > 0);
  assert.ok(validate(sch, { either: true }).some(e => e.includes('anyOf')));
  assert.throws(() => validate({ $ref: '#/$defs/missing' }, 1));
});

test('validator: implements every keyword used by the three schemas, and reports unknown ones', () => {
  ['snapshot.schema.json', 'sprints.schema.json', 'quality-intake.schema.json'].forEach(f => assert.deepEqual(unsupportedKeywords(S(f)), [], f));
  assert.deepEqual(unsupportedKeywords({ type: 'object', properties: { a: { type: 'string', multipleOf: 2 } } }), ['#/properties/a/multipleOf']);
});

test('schemas: snapshot strict shapes, removed[].note allowed, manifest file pattern (D74)', () => {
  const snap = S('snapshot.schema.json'), man = S('sprints.schema.json');
  const sprintTicket = { $ref: '#/$defs/sprintTicket' };
  assert.deepEqual(validate(snap, { ticket: 'APP-1', owner: null, points: 2, statusAging: 3 }, 't', sprintTicket), []);
  assert.ok(validate(snap, { ticket: 'APP-1', days: 2 }, 't', sprintTicket).some(e => e.includes('unexpected key days')));
  const base = { refreshedAt: '2026-10-01', source: 'x', tickets: [], sprint: { id: 1, removed: [{ ticket: 'APP-1', removedDate: '2026-10-01', note: 'reconstructed' }] } };
  assert.deepEqual(validate(snap, base), []);
  base.sprint.removed[0].other = 1;
  assert.ok(validate(snap, base).some(e => e.includes('unexpected key other')));
  const entry = file => ({ current: 1, sprints: [{ id: 1, name: 'S', startDate: '2026-10-01', endDate: '2026-10-02', state: 'active', file }] });
  assert.deepEqual(validate(man, entry('snapshots/sprint-1.json')), []);
  ['sprint.json', 'snapshots/../backlog.json', 'snapshots/sprint-x.json', '/snapshots/sprint-1.json'].forEach(f => assert.ok(validate(man, entry(f)).length > 0, f));
});

test('isDate and isDateTime reject impossible values', () => {
  assert.equal(isDate('2026-02-29'), false); assert.equal(isDate('2028-02-29'), true);
  assert.equal(isDateTime('2026-10-29T10:00:00Z'), true); assert.equal(isDateTime('2026-10-29T10:00:00'), false);
});

test('compileSearch (R001-19): partial keys, word starts, whole phrases on their own field, accents, AND, exact key first', () => {
  const spec = {
    fields: [{ kind: 'key', get: t => t.ticket }, { kind: 'text', get: t => t.summary }, { kind: 'text', get: t => t.status }, { kind: 'linked', get: t => t.parent }, { kind: 'text', get: t => t.fixVersion }],
    phrases: [{ text: 'in review', test: t => t.status === 'In Review' }]
  };
  const rows = [
    T({ ticket: 'APP-2970', summary: 'Fix the Pipeline. Review notes', status: 'In Progress', parent: 'APP-55 - Café work', fixVersion: '4.46.1.0' }),
    T({ ticket: 'APP-29', summary: 'Small fix', status: 'In Review', parent: null, fixVersion: null })];
  const hits = q => rows.filter(AF.compileSearch(q, spec).pred).map(t => t.ticket);
  assert.equal(AF.compileSearch('   ', spec), null);
  assert.deepEqual(hits('2970'), ['APP-2970']);
  assert.deepEqual(hits('app-29'), ['APP-2970', 'APP-29']);
  assert.deepEqual(hits('pipe'), ['APP-2970']);       // start of a word
  assert.deepEqual(hits('ipeline'), []);              // not the middle of a word
  assert.deepEqual(hits('in review'), ['APP-29']);    // whole phrase on the status field only
  assert.deepEqual(hits('review in'), ['APP-2970', 'APP-29']); // other order: plain words, each in any field
  assert.deepEqual(hits('ÏN RÉVIEW'), ['APP-29']);
  assert.deepEqual(hits('cafe 55'), ['APP-2970']);    // parent title word AND parent key part
  assert.deepEqual(hits('4.46'), ['APP-2970']);
  assert.deepEqual(hits('fix 4.46'), ['APP-2970']);   // AND
  assert.deepEqual(AF.exactFirst(rows, AF.compileSearch('APP-29', spec)).map(t => t.ticket), ['APP-29', 'APP-2970']);
});
