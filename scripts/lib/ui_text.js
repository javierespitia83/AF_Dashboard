'use strict';
/*
 * ui_text.js — every UI string the acceptance harness expects, in one block (C49).
 * The wording comes from SPEC.md; when a label changes there, change it here (and in the app) once.
 */
const THR_TIME = 7; // AF.config.timeInStatusThresholdDays default (SPEC §6.2)

const UI = {
  shell: {
    tabs: ['Current sprint', 'Backlog', 'Quality Intake'],
    badge: 'SNAPSHOT · NOT LIVE',
    footer: /Internal — team only/,
    liveText: /LIVE/,
    liveDashboardPath: '/jira/dashboards/18635',
    h1: { sprint: 'App Foundation · Current sprint', backlog: 'App Foundation · Backlog', quality: 'Quality Intake' },
    sprintSelectLabel: 'Sprint'
  },
  jiraBrowse: 'https://mysnaplogic.atlassian.net/browse/',
  sprint: {
    tiles: { burndown: 'Burndown', status: 'Tickets by status', type: 'Tickets by type', contribution: 'Team Contribution', matrix: 'Assignee x tester', detail: 'Ticket detail' },
    mainRow: ['Burndown', 'Tickets by status', 'Tickets by type', 'Team Contribution'],
    lowerRow: ['Ticket detail', 'Assignee x tester'],
    kpis: ['Work items', 'Story points', 'Done', 'Added mid-sprint', 'Carried over', 'No tester & Not Dev to Test', 'Long-running work · ' + THR_TIME + '+ days', 'Avg cycle time'],
    kpi: { items: 'Work items', mid: 'Added mid-sprint', carried: 'Carried over', noTester: 'No tester & Not Dev to Test', time: 'Long-running work · ' + THR_TIME + '+ days', cycle: 'Avg cycle time' },
    hints: {
      itemsUnfiltered: 'tickets in the sprint',
      timeWithData: 'In Progress / In Review tickets', timeNoData: 'Days in status not available yet',
      cycle: n => n ? `days, over ${n} Done ticket${n === 1 ? '' : 's'}` : 'no Done tickets with a cycle time',
      mid: (points, thr) => `${points} points, added after day ${thr}`,
      carriedNull: 'Not calculated yet for this sprint', carriedNoFigures: 'No figures in the sprint snapshot',
      noTesterPrefix: 'no tester, excluding Dev to Test'
    },
    empty: 'No work items match these filters. Remove a tag or use Reset all.',
    tagLabels: { status: 'Status', type: 'Type', assignee: 'Assignee', tester: 'Tester', contributor: 'Team member', fix: 'Fix version', parent: 'Parent' },
    kpiTag: name => 'KPI: ' + name,
    contribution: {
      sub: 'Work Items (W.I) by Jira role',
      headers: ['Name', 'Assignee W.I', 'Tester W.I', 'Total W.I | SP'],
      note: 'Assignee and Tester work item counts can overlap. Story points are shared and count once.',
      removedWording: 'Total W.I counts each ticket once'
    },
    detailHeaders: ['Ticket', 'Summary', 'Owner', 'Tester', 'Dev to Test', 'Status', 'Days in status', 'Story points', 'Parent', 'Fix version', 'Linked work items', 'Last sync update'],
    sortableHeaders: ['Ticket', 'Owner', 'Tester', 'Status', 'Days in status', 'Story points', 'Parent', 'Fix version'],
    statusHeader: 'Work items | Story points',
    burndown: {
      footNoRemoved: 'Tickets removed from the sprint and re-estimates are not reflected',
      footRemoved: 'shrinks on the date a ticket left the sprint',
      footStart: 'Scope grows on each ticket',
      unplaced: n => `${n} Done ticket${n === 1 ? ' has' : 's have'} no done date`,
      notStarted: 'The sprint has not started yet',
      legend: { scope: 'Scope', earlier: 'Earlier', removed: 'Removed', added: thr => 'Added after day ' + thr },
      legendNames: thr => ['Remaining', 'Ideal', 'Scope', 'Added after day ' + thr, 'Earlier', 'Removed'],
      today: 'Today',
      panelHeaders: ['Ticket', 'Summary', 'Pts', 'Status', 'Assignee'],
      dataTableHeaders: ['Date', 'Scope', 'Remaining', 'Ideal', 'Done that day']
    },
    closed: { banner: 'HISTORICAL VIEW · CLOSED SPRINT', asOf: 'Snapshot as of ' },
    sprintNotFound: 'Sprint not found',
    noTickets: /No tickets in this snapshot/
  },
  backlog: {
    tiles: { dor: 'Readiness (DoR)', priority: 'Priority', type: 'Type', age: 'Days in status', matrix: 'Readiness x priority', table: 'Backlog tickets' },
    headers: ['Ticket', 'Summary', 'DoR status', 'Priority', 'Type', 'Story points', 'Days in status', 'Epic', 'Needs splitting', 'Risk / open question', 'Related / cluster'],
    empty: 'No backlog tickets match these filters. Remove a tag or use Reset all.',
    tagLabels: { dor: 'DoR', priority: 'Priority', type: 'Type', age: 'Age', epic: 'Epic' },
    sub: (n, total) => `Showing ${n} of ${total} tickets`,
    dorTag: dor => 'Search: DoR = ' + dor,
    textTag: q => 'Search: “' + q + '”',
    dorHint: dor => `Searching by readiness: DoR = ${dor}.`,
    epicButton: n => 'Epic' + (n ? ' (' + n + ')' : '') + ' ▾',
    noEpic: '(no epic)',
    noTickets: /No backlog tickets in this snapshot/
  },
  quality: {
    title: 'Quality Intake',
    partial: 'ACTIVE WINDOW · PARTIAL', complete: 'COMPLETE WINDOW', na: 'n/a',
    sources: [['PSWAT', 'pswat'], ['APP Bugs', 'appBugs']],
    caveat: /intake signal, not a defect rate/i, pswatDefinition: /PSWAT includes all/i,
    scrollHint: n => `Scroll within this list to see all ${n} tickets.`,
    scrollAria: n => `scroll to view all ${n} tickets`,
    detailHead: (source, n) => `${source} ticket detail · ${n}`
  },
  errors: {
    cantLoad: file => new RegExp('Can’t load ' + file.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')),
    cantDraw: /Can’t draw this page/,
    regenerate: /export_dashboard_snapshots\.py/,
    mismatch: /does not match its sprints\.json entry/,
    invalidManifest: /not a valid sprint manifest/,
    openedAsFile: /opened as a file/, useServer: /http\.server/
  }
};

module.exports = { UI, THR_TIME };
