/* Nurse and Doctor dashboards (pure render functions) */

function taskCard(label, cls, t, role, empty) {
  if (!t) return '<div class="panel ' + cls + ' task"><h3>' + label + '</h3><div class="muted">' + esc(empty || 'Nothing planned yet - the optimizer re-plans on every event') + '</div></div>';
  if (t.kind === 'relocation') return '<div class="panel ' + cls + ' task"><h3>' + label + '</h3><div class="big">' + esc(t.task) + '</div><div class="small">' + esc(t.action) + '</div></div>';
  var p = t.patient;
  var due = t.due === 'NOW' ? '<span style="color:var(--crit);font-weight:700">NOW</span>' : 'in ' + t.due_in + ' min (' + esc(t.due_clock) + ')';
  var h = '<div class="panel ' + cls + ' task"><h3>' + label + '</h3><div class="loc"><b>' + esc(t.location) + '</b></div><div class="big">' + esc(p.id) + ' - ' + esc(p.name) + ' ' + uBadge(p.urgency) + '</div>' +
    '<div class="kv small" style="margin-top:6px"><div>Task</div><div>' + esc(t.task) + '</div><div>Due</div><div>' + due + '</div>' +
    (t.eta != null ? '<div>Expected completion</div><div>about ' + t.eta + ' min' + (t.expected_completion ? ' (' + esc(t.expected_completion) + ')' : '') + (t.overrun ? ' - <span style="color:var(--bad)">overrunning</span>' : '') + '</div>' : '') +
    (t.start_in != null ? '<div>Treatment starts</div><div>in ' + t.start_in + ' min (patient has waited ' + f1(t.wait_so_far) + ' min)</div>' : '') +
    (t.action ? '<div>Required action</div><div><b>' + esc(t.action) + '</b></div>' : '') + '</div>';
  if (role === 'doctor' && t.assessment) {
    var a = t.assessment;
    h += '<div class="small" style="margin-top:8px"><b>Initial assessment (decision support, unconfirmed):</b> ' + esc(p.diagnosis) + '<br>Reported: ' + esc(a.symptoms.join(', ')) + ' - risk ' + esc(a.risk) + '<br>Requires: ' + esc(a.bed_type.replace('_', ' ')) + ' bed' + (a.equipment.length ? ', ' + esc(a.equipment.join(', ')) : '') + '</div>';
  }
  return h + '</div>';
}

function staffHeader(v) {
  return '<div class="panel" style="margin-bottom:12px"><div class="spread"><div><div style="font-size:20px;font-weight:700">' + (v.role === 'doctor' ? '' : 'NURSE: ') + esc(v.name) + '</div>' +
    '<div class="muted">' + (v.role === 'doctor' ? esc(v.specialty) + ' - ' : '') + esc(v.shift) + ' - ' + esc(v.role === 'doctor' ? v.skills.join(', ') : 'skills: ' + v.skills.join(', ')) + '</div></div>' +
    '<div style="text-align:right">' + tag(v.status) + '<div class="small muted">Location: <b>' + esc(v.location) + '</b>' + (v.role === 'nurse' ? ' - covers ' + esc(v.covered_zones.map(zoneName).join(', ')) : '') + '</div><div class="small muted">Hospital mode <span class="pill ' + v.mode + '">' + v.mode + '</span></div></div></div></div>';
}

function pgStaffDash(v) {
  var d = v.role;
  var h = '<div class="page">' + staffHeader(v);
  if (v.standby) h += '<div class="panel" style="margin-bottom:12px"><b>Standby</b> - ' + esc(v.standby) + '</div>';
  h += '<div class="grid g3">' + taskCard('CURRENT', 'card-now', v.current, d, v.standby ? 'No active assignment' : 'No active assignment') + taskCard('NEXT', 'card-next', v.next, d) + taskCard('THEN', 'card-then', v.then, d) + '</div>';
  h += '<div class="grid g2" style="margin-top:12px"><div class="panel"><h3>Alerts</h3>' + alertsHtml(v.alerts.slice(0, 6)) + '</div><div class="panel"><h3>Shift workload</h3>' +
    kv([['Assignments', v.workload.assignments], ['Treatment time', v.workload.treat_minutes + ' min'], ['Travel time', v.workload.travel_minutes + ' min'], ['Idle time', v.workload.idle_minutes + ' min']]) +
    '<div class="small muted" style="margin-top:8px">Tasks are computed by the optimizer from the live hospital state and change whenever arrivals, overruns, failures or staffing change.</div></div></div></div>';
  return h;
}

function pgStaffPatients(v) {
  return '<div class="page"><h2>My patients</h2><div class="panel">' + table(['Patient', 'Urgency', 'Presentation'], v.patients.map(function (p) { return '<tr class="click" onclick="A.patient(\'' + p.id + '\')"><td>' + esc(p.id) + ' ' + esc(p.name) + '</td><td>' + uBadge(p.urgency) + '</td><td>' + esc(p.diagnosis) + '</td></tr>'; })) + '</div></div>';
}

function pgStaffTasks(v, title) {
  var cur = v.current && v.current.kind === 'patient' ? [v.current] : [];
  var rows = cur.map(function (c) { return '<tr><td><b>NOW</b></td><td>' + esc(c.location) + '</td><td>' + esc(c.patient.id) + ' ' + uBadge(c.patient.urgency) + '</td><td>' + esc(c.task) + '</td><td>' + esc(c.action) + '</td></tr>'; })
    .concat(v.upcoming.map(function (u) { return '<tr><td>in ' + u.due_in + ' min (' + esc(u.due_clock) + ')</td><td>' + esc(u.location) + '</td><td>' + esc(u.patient.id) + ' ' + uBadge(u.patient.urgency) + '</td><td>' + esc(u.task) + '</td><td>treatment starts in ' + u.start_in + ' min, about ' + u.planned_duration + ' min long</td></tr>'; }));
  return '<div class="page"><h2>' + title + '</h2><div class="panel">' + table(['When', 'Where', 'Patient', 'Task', 'Detail'], rows) + '<div class="small muted" style="margin-top:8px">Projected from the current tentative plan; it will be recomputed after the next event.</div></div></div>';
}

function pgStaffAlerts(v) { return '<div class="page"><h2>Alerts</h2><div class="panel">' + alertsHtml(v.alerts) + '</div></div>'; }
