/* quality-intake.js — sprint-window intake history, from quality-intake.json. */
(function () {
  'use strict';
  var AF = window.AF, el = AF.el, app = document.getElementById('app');
  var expanded = null;
  var SOURCES = [
    { label: 'PSWAT', key: 'pswat' },
    { label: 'APP Bugs', key: 'appBugs' }
  ];

  AF.loadJson('quality-intake.json').then(function (data) {
    if (!data || !Array.isArray(data.sprints)) throw new Error('missing "sprints" array');
    return data;
  }).then(render).catch(function (err) { AF.showError(app, 'quality-intake.json', err); });

  function shown(value) {
    return value === null || value === undefined || value === '' ? 'n/a' : String(value);
  }
  function rate(value) {
    if (typeof value !== 'number' || !isFinite(value)) return 'n/a';
    return (Math.round(value * 10) / 10).toFixed(1);
  }
  function validJiraLink(ticket) {
    return typeof ticket.url === 'string' && typeof ticket.key === 'string' &&
      /^[A-Z][A-Z0-9]+-[0-9]+$/.test(ticket.key) && ticket.url === AF.jira.url(ticket.key);
  }
  function ticketTable(tickets) {
    var header = el('tr', null, ['Ticket', 'Summary', 'Type', 'Status', 'Created'].map(function (x) {
      return el('th', { scope: 'col', text: x });
    }));
    var rows = tickets.map(function (ticket) {
      var key = validJiraLink(ticket) ? AF.jira.link(ticket.key) : el('span', { text: shown(ticket.key) });
      return el('tr', null, [
        el('td', null, [key]),
        el('td', { text: shown(ticket.summary) }),
        el('td', { text: shown(ticket.type) }),
        el('td', { text: shown(ticket.status) }),
        el('td', { text: shown(ticket.created) })
      ]);
    });
    if (!rows.length) return el('p', { class: 'empty', text: 'No ticket details are available for this count.' });
    return el('div', { class: 'qi-ticket-scroll', tabindex: '0', 'aria-label': 'Quality intake tickets' }, [
      el('table', { class: 'data qi-ticket-table' }, [el('thead', null, [header]), el('tbody', null, rows)])
    ]);
  }

  function render(data) {
    AF.clear(app);
    AF.setUpdated(data.refreshedAt, data.exportedAt);
    if (!data.sprints.length) {
      app.appendChild(el('section', { class: 'message neutral' }, [
        el('h2', { text: 'No quality intake data is available' }),
        el('p', { text: 'Run python3 05_Automation/export_dashboard_snapshots.py, then reload.' })
      ]));
      return;
    }

    app.appendChild(el('header', { class: 'qi-intro' }, [
      el('div', null, [
        el('h1', { text: 'Quality Intake' }),
        el('p', { text: 'Tickets created during each sprint’s intake window. Counts are an intake signal, not a defect rate.' })
      ]),
      el('p', { class: 'qi-caveat', text: 'PSWAT includes all PSWAT issue types, including support requests. APP Bugs includes APP issues with Jira issue type = Bug.' })
    ]));

    var cards = data.sprints.map(function (sprint) {
      var title = sprint.name || ('Sprint ' + shown(sprint.sprintId));
      var windowText = 'Window: ' + shown(sprint.windowStart) + ' to ' + shown(sprint.windowEnd) +
        ' · ' + shown(sprint.weekdays) + ' weekdays';
      var card = el('section', { class: 'tile qi-sprint', 'data-sprint-id': String(sprint.sprintId) });
      card.appendChild(el('div', { class: 'tile-head qi-sprint-head' }, [
        el('h2', { text: title }),
        sprint.partial === true ? el('span', { class: 'qi-partial', text: 'ACTIVE WINDOW · PARTIAL' }) : null,
        sprint.partial === false ? el('span', { class: 'qi-complete', text: 'COMPLETE WINDOW' }) : null,
        sprint.partial === null || sprint.partial === undefined ? el('span', { class: 'qi-na', text: 'n/a' }) : null,
        el('p', { class: 'sub', text: 'Sprint ' + shown(sprint.sprintId) + ' · ' + windowText })
      ]));
      var body = el('div', { class: 'tile-body qi-body' });
      var header = el('tr', null, [
        el('th', { scope: 'col', text: 'Source' }),
        el('th', { scope: 'col', text: 'Tickets created' }),
        el('th', { scope: 'col', text: 'Per 10 weekdays' })
      ]);
      var rows = SOURCES.map(function (source) {
        var count = sprint.counts && sprint.counts[source.key];
        var list = Array.isArray(sprint.tickets) ? sprint.tickets.filter(function (ticket) { return ticket.source === source.label; }) : [];
        var key = String(sprint.sprintId) + '|' + source.key;
        var isOpen = expanded === key;
        var countCell = typeof count === 'number' && isFinite(count)
          ? el('button', {
              type: 'button', class: 'qi-count', 'data-key': key, 'aria-expanded': isOpen ? 'true' : 'false',
              'aria-label': source.label + ': ' + count + ' tickets created in sprint ' + sprint.sprintId,
              onclick: function () {
                expanded = isOpen ? null : key;
                render(data);
                Array.prototype.some.call(app.querySelectorAll('[data-key]'), function (button) {
                  if (button.getAttribute('data-key') === key) { button.focus({ preventScroll: true }); return true; }
                  return false;
                });
              }
            }, [String(count)])
          : el('span', { class: 'qi-na', text: 'n/a' });
        return el('tr', null, [
          el('th', { scope: 'row', text: source.label }),
          el('td', { class: 'qi-number' }, [countCell]),
          el('td', { class: 'qi-number', text: rate(sprint.ratesPer10Weekdays && sprint.ratesPer10Weekdays[source.key]) })
        ]);
      });
      body.appendChild(el('table', { class: 'data qi-metrics' }, [el('thead', null, [header]), el('tbody', null, rows)]));

      if (expanded && expanded.indexOf(String(sprint.sprintId) + '|') === 0) {
        var sourceKey = expanded.split('|')[1];
        var source = SOURCES.find(function (candidate) { return candidate.key === sourceKey; });
        var list = (Array.isArray(sprint.tickets) ? sprint.tickets : []).filter(function (ticket) { return source && ticket.source === source.label; });
        body.appendChild(el('section', { class: 'qi-details', 'aria-live': 'polite' }, [
          el('h3', { text: (source ? source.label : 'Tickets') + ' ticket detail · ' + list.length }),
          ticketTable(list)
        ]));
      }
      card.appendChild(body);
      return card;
    });
    app.appendChild(el('div', { class: 'qi-grid' }, cards));
  }
}());
