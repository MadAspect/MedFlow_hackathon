/* Head Nurse command centre: overview + disruption console. Pure render functions (data -> HTML). */

function modeBanner(st) {
  var em = st.emergency;
  if (em.state === 'EMERGENCY') return '<div class="banner">EMERGENCY MODE ACTIVE since ' + clockOf(em.since) + ' (' + em.duration + ' min)<small>Trigger: ' + esc(em.trigger) + '</small></div>';
  if (em.state === 'WARNING') return '<div class="banner warn">WARNING<small>' + esc(em.trigger) + '</small></div>';
  if (em.state === 'RECOVERY') return '<div class="banner" style="background:var(--accent)">RECOVERY - emergency indicators have eased; holding before returning to NORMAL</div>';
  return '';
}

function indicatorTable(em) {
  var rows = Object.keys(em.indicators).map(function (k) {
    var r = em.indicators[k], c = r.level === 2 ? 'var(--crit)' : r.level === 1 ? 'var(--warn)' : 'var(--ok)';
    return '<tr><td><span style="color:' + c + '">&#9679;</span> ' + esc(r.label) + '</td><td class="mono">' + r.value + '</td><td class="muted small">' + (r.low ? '&le;' : '&ge;') + r.warn + ' / ' + (r.low ? '&le;' : '&ge;') + r.emergency + '</td></tr>';
  });
  return table(['Indicator', 'Now', 'Warn / Emergency'], rows);
}

function recoHtml(recs) {
  if (!recs || !recs.length) return '<div class="muted small">No intervention with a positive projected effect right now.</div>';
  return recs.map(function (r) {
    var i = r.impact;
    return '<div class="reco"><div class="spread"><b>#' + r.rank + ' ' + esc(r.title) + '</b><button class="btn primary sm" onclick="A.applyReco(' + r.rank + ')">Apply</button></div>' +
      '<div class="small muted">WHY</div><ul>' + r.why.map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('') + '</ul>' +
      '<div class="impact">Projected impact (planner re-run on a copy of the hospital): average wait of the queue ' + f1(i.avg_wait_before) + ' &rarr; ' + f1(i.avg_wait_after) + ' min (' + (i.avg_wait_gain >= 0 ? '-' : '+') + f1(Math.abs(i.avg_wait_gain)) +
      '); high-urgency wait ' + f1(i.critical_wait_before) + ' &rarr; ' + f1(i.critical_wait_after) + ' min; unscheduled ' + i.unscheduled_before + ' &rarr; ' + i.unscheduled_after + '</div></div>';
  }).join('');
}

function bottleneckPanel(st) {
  var b = st.bottlenecks, p = b.primary, s = b.secondary, h = '<h3>Bottleneck analysis</h3>';
  if (!p) h += '<div class="muted">No resource class is currently blocking patients. Peak pressure score: ' + f1(b.peak_score) + '</div>';
  else {
    h += '<div><span class="tag" style="background:#fdecec;color:var(--bad)">PRIMARY</span> <b>' + esc(p.label) + '</b> <span class="muted small">(' + esc(p.key) + ')</span></div>' +
      '<div class="row small" style="margin:4px 0"><span>Utilization <b>' + pct(p.utilization) + '</b></span><span>Demand/capacity <b>' + f1(p.demand_pressure) + '</b></span><span>Queue growth <b>' + (p.queue_delta >= 0 ? '+' : '') + p.queue_delta + '</b></span><span>Score B <b>' + f1(p.score) + '</b></span><span>Affected patients <b>' + p.n_blocked + '</b></span><span>Delay <b>' + f1(p.delay_minutes) + ' patient-min</b></span></div>' +
      '<div class="small muted">' + esc(p.cause || '') + '</div>';
    if (s) h += '<div style="margin-top:8px"><span class="tag">SECONDARY</span> ' + esc(s.label) + ' - score ' + f1(s.score) + ', ' + s.n_blocked + ' patients affected</div>';
  }
  h += '<h3 style="margin-top:14px">Recommended interventions</h3>' + recoHtml(st.recommendations);
  return '<div class="panel">' + h + '</div>';
}

function emergencyPanel(st) {
  var em = st.emergency, o = st.overview, icu = o.beds.icu || {available: 0, operational: 0};
  var h = '<div class="spread"><h3>Operating mode</h3><span class="pill ' + em.state + '">' + em.state + '</span></div>';
  if (em.state === 'EMERGENCY' || em.state === 'RECOVERY') {
    h += '<div class="kv small"><div>Activated</div><div>' + clockOf(em.since) + ' (' + em.duration + ' min ago)</div><div>Trigger</div><div>' + esc(em.trigger) + '</div>' +
      '<div>Critical patients waiting</div><div>' + o.critical_waiting + ' (longest wait ' + f1(o.critical_wait_max) + ' min)</div><div>ICU beds free</div><div>' + icu.available + ' of ' + icu.operational + '</div>' +
      '<div>Staff available</div><div>doctors ' + o.staff.doctors_active + '/' + o.staff.doctors_total + ', nurses ' + o.staff.nurses_active + '/' + o.staff.nurses_total + '</div>' +
      '<div>Resources under pressure</div><div>' + esc(st.bottlenecks.classes.filter(function (c) { return c.score >= 1; }).slice(0, 3).map(function (c) { return c.key + ' (' + f1(c.score) + ')'; }).join(', ') || '-') + '</div></div>';
  }
  if (st.actions.length) {
    h += '<h3 style="margin-top:12px">Optimizer actions</h3>' + st.actions.map(function (a) {
      return '<div class="reco" style="border-left-color:var(--crit)"><b>' + esc(a.clock) + ' - ' + esc(a.title) + '</b><ul>' + a.why.map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('') + '</ul>' +
        '<div class="impact">Predicted: average wait ' + f1(a.predicted_impact.avg_wait_before) + ' &rarr; ' + f1(a.predicted_impact.avg_wait_after) + ' min</div></div>';
    }).join('');
  }
  h += '<details style="margin-top:10px"><summary class="small muted">Emergency-mode indicators (configurable thresholds)</summary>' + indicatorTable(em) + '</details>';
  return '<div class="panel">' + h + '</div>';
}

function impactsPanel(st) {
  if (!st.impacts.length) return '';
  return '<div class="panel"><h3>Resource changes and what the system did</h3>' + st.impacts.map(function (i) {
    return '<div class="reco"><b>' + esc(i.clock) + ' - ' + esc(i.change) + '</b> <span class="muted small">(' + esc(i.source) + ')</span>' +
      (i.affected.length ? '<ul>' + i.affected.map(function (a) { return '<li><b>' + esc(a.patient) + '</b> ' + esc(a.action) + ': ' + esc(a.detail) + '<br><span class="muted">' + esc(a.explanation) + '</span></li>'; }).join('') + '</ul>' : '<div class="small muted">No active assignment was affected.</div>') +
      '<div class="small">Mode: ' + i.mode + (i.bottleneck ? ' - current bottleneck: ' + esc(i.bottleneck) : '') + (i.notified.length ? ' - notified: ' + esc(i.notified.join(', ')) : '') + '</div>' +
      (i.conflicts.length ? '<div class="small" style="color:var(--bad)">' + i.conflicts.map(esc).join('<br>') + '</div>' : '') + '</div>';
  }).join('') + '</div>';
}

function queueTable(waiting) {
  return table(['Patient', 'Urg', 'Presentation', 'Wait', 'Priority S', 'U / W / D / R / C', 'Planned start', 'Blocked on'],
    waiting.slice(0, 10).map(function (p) {
      var c = p.priority || {};
      return '<tr class="click" onclick="A.patient(\'' + p.id + '\')"><td>' + esc(p.id) + ' ' + esc(p.name) + '</td><td>' + uBadge(p.urgency) + '</td><td>' + esc(p.initial_diagnosis) + '</td><td>' + f1(p.wait_now) + ' min</td><td><b>' + f1(c.S) + '</b></td>' +
        '<td class="mono small">' + [c.U, c.W, c.D, c.R, c.C].map(function (x) { return x == null ? '-' : x.toFixed(2); }).join(' / ') + '</td>' +
        '<td>' + (p.planned_start_in != null ? 'in ' + p.planned_start_in + ' min (' + p.planned_start_clock + ')' : '<span class="muted">not scheduled</span>') + '</td><td class="small">' + esc(p.conflict || p.binding_class || '') + '</td></tr>';
    }));
}

function pgOverview(st, waiting) {
  var o = st.overview, u = o.utilization;
  var kpis = '<div class="grid g4">' + kpi('Patients today', o.patients_total, o.completed + ' completed') + kpi('Waiting', o.waiting, 'avg wait now ' + f1(o.avg_wait_waiting_now) + ' min') +
    kpi('Critical', o.critical_total, o.critical_waiting + ' waiting, longest ' + f1(o.critical_wait_max) + ' min', o.critical_waiting ? 'crit' : '') + kpi('In treatment', o.in_treatment, 'transferred ' + o.transferred) +
    kpi('Average wait', f1(o.avg_wait) + ' min', 'arrival to treatment start') + kpi('Bed utilization', pct(u.bed), 'ICU ' + pct(u.icu) + ' - ER ' + pct(u.emergency)) +
    kpi('Doctor utilization', pct(u.doctor), o.staff.doctors_active + '/' + o.staff.doctors_total + ' active') + kpi('Nurse utilization', pct(u.nurse), o.staff.nurses_active + '/' + o.staff.nurses_total + ' active') + '</div>';
  var alerts = '<div class="panel"><h3>Alerts</h3>' + alertsHtml(o.alerts) + '</div>';
  var log = '<div class="panel"><h3>Live event log</h3>' + table(['Time', 'Event'], st.events.slice(0, 14).map(function (e) { return '<tr><td class="mono">' + esc(e.clock) + '</td><td' + (e.severity === 'critical' ? ' style="color:var(--bad)"' : '') + '>' + esc(e.message) + '</td></tr>'; })) + '</div>';
  var re = st.reopts[0];
  var reopt = '<div class="panel"><h3>Rolling re-optimization</h3><div class="small muted">Latest epoch ' + (re ? esc(re.clock) : '-') + ': ' + (re ? esc(re.reason) : '') + '</div>' +
    (re ? '<div class="small">Objective J = ' + f1(re.J.total) + ' (wait ' + f1(re.J.wait) + ', critical ' + f1(re.J.critical_wait) + ', travel ' + f1(re.J.travel) + ', unserved ' + f1(re.J.unserved) + ') - ' + re.evaluations + ' plan evaluations, ' + re.committed.length + ' assignments committed' + (re.n_changes ? ', ' + re.n_changes + ' downstream plan changes' : '') + '</div>' +
      (re.plan_changes.length ? table(['Patient', 'Planned start', 'Change'], re.plan_changes.slice(0, 5).map(function (c) { return '<tr><td>' + esc(c.patient) + '</td><td>' + clockOf(c.was) + ' &rarr; ' + clockOf(c.now) + '</td><td>' + (c.delta ? (c.delta > 0 ? '+' : '') + c.delta + ' min' : esc(c.note || '')) + '</td></tr>'; })) : '') : '') + '</div>';
  return modeBanner(st) + '<div class="page"><h2>Live hospital overview <span class="muted small">' + esc(o.scenario) + ' - strategy: ' + esc(o.strategy) + '</span></h2>' + kpis +
    '<div class="grid g2" style="margin-top:12px">' + emergencyPanel(st) + bottleneckPanel(st) + '</div>' +
    '<div class="grid g2" style="margin-top:12px">' + alerts + reopt + '</div>' + (st.impacts.length ? '<div style="margin-top:12px">' + impactsPanel(st) + '</div>' : '') +
    '<div class="panel" style="margin-top:12px"><h3>Waiting queue by priority</h3>' + queueTable(waiting) + '</div>' +
    '<div class="grid g2" style="margin-top:12px">' + log + '<div data-keep="console"></div></div></div>';
}

function consoleHtml(roster, inTreatment) {
  var staff = roster.doctors.map(function (d) { return '<option value="' + d.id + '">' + esc(d.name) + ' (' + d.id + ')</option>'; }).join('') + roster.nurses.map(function (n) { return '<option value="' + n.id + '">' + esc(n.name) + ' (' + n.id + ', ' + zoneName(n.zone) + ')</option>'; }).join('');
  return '<div class="panel" data-keep="console"><h3>Disruption console (demo)</h3><div class="form">' +
    '<div class="row"><b class="small">Emergency surge</b><input id="sg_n" type="number" value="14" style="width:60px"> patients over <input id="sg_w" type="number" value="20" style="width:60px"> min, <input id="sg_c" type="number" value="40" style="width:60px">% critical <button class="btn danger sm" onclick="A.surge()">Inject surge</button></div>' +
    '<div class="row"><b class="small">Staff shortage</b><select id="ss_id">' + staff + '</select><button class="btn danger sm" onclick="A.staffOut()">Mark unavailable</button></div>' +
    '<div class="row"><b class="small">Resource failure</b><select id="rf_id">' + '<option value="bed:I01">ICU bed I01</option><option value="bed:I02">ICU bed I02</option><option value="bed:E01">Emergency bed E01</option><option value="bed:OR1">Theatre OR1</option><option value="equipment:VEN1">Ventilator VEN1</option><option value="equipment:DEF1">Defibrillator DEF1</option></select><button class="btn danger sm" onclick="A.fail()">Report failure</button></div>' +
    '<div class="row"><b class="small">Unexpected duration</b><select id="ov_id">' + inTreatment.map(function (p) { return '<option value="' + p.id + '">' + esc(p.id) + ' expected ' + (p.treatment_time_expected || '?') + ' min</option>'; }).join('') + '</select>x<input id="ov_f" type="number" value="1.8" step="0.1" style="width:60px"><button class="btn danger sm" onclick="A.overrun()">Make treatment run long</button></div>' +
    '<div class="small muted">Overrun changes ground truth silently; MedFlow only notices when the predicted end passes, then re-optimizes downstream. Reopen this page to refresh the patient list.</div></div></div>';
}
