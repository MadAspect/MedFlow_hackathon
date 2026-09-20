/* Head Nurse pages (part 2). Pure render functions. */

function pgPatients(list) {
  var rows = list.slice(0, 150).map(function (p) {
    return '<tr class="click" onclick="A.patient(\'' + p.id + '\')"><td>' + esc(p.id) + '</td><td>' + esc(p.name) + '</td><td>' + uBadge(p.urgency) + '</td><td>' + tag(p.status) + '</td><td>' + esc(p.initial_diagnosis) + '</td><td>' + esc(p.department) + '</td>' +
      '<td>' + esc(p.location) + '</td><td>' + esc(p.doctor_name || '-') + '</td><td>' + esc((p.nurse_names || []).join(', ') || '-') + '</td><td>' + f1(p.status === 'waiting' ? p.wait_now : p.time_to_treatment) + '</td>' +
      '<td>' + (p.treatment_time_actual != null ? f1(p.treatment_time_actual) + ' (exp ' + (p.treatment_time_expected || '-') + ')' : (p.treatment_time_expected ? 'exp ' + p.treatment_time_expected : '-')) + '</td></tr>';
  });
  var form = '<div class="panel" data-keep="addpatient"><h3>Admit patient / initial triage assistance</h3><div class="form">' +
    '<label>Name<input id="np_name" placeholder="Walk-in"></label><label>Age<input id="np_age" type="number" value="55"></label>' +
    '<label>Symptoms (comma separated: chest pain, shortness of breath, high heart rate, fracture, fever ...)<input id="np_sym" value="chest pain, shortness of breath"></label>' +
    '<div class="row"><label>Heart rate<input id="np_hr" type="number" style="width:80px"></label><label>SpO2<input id="np_spo2" type="number" style="width:80px"></label><label>Systolic BP<input id="np_sbp" type="number" style="width:80px"></label></div>' +
    '<div class="row"><button class="btn" onclick="A.evalDx()">Evaluate (decision support)</button><button class="btn primary" onclick="A.addPatient()">Admit to queue</button></div><div id="np_out" class="small"></div></div></div>';
  return '<div class="page"><h2>Patients <span class="muted small">(' + list.length + ')</span></h2><div class="grid g2" style="grid-template-columns:2fr 1fr">' +
    '<div class="panel">' + table(['ID', 'Name', 'Urg', 'Status', 'Presentation', 'Dept', 'Location', 'Doctor', 'Nurses', 'Wait', 'Treatment min'], rows) + '</div>' + form + '</div></div>';
}

function dxHtml(ev) {
  return '<div class="reco"><b>Risk: ' + tag(ev.risk_category).replace('tag', 'tag') + ' ' + ev.risk_score + '</b> - suggested urgency ' + uBadge(ev.urgency) +
    '<div class="small">Suggested department: <b>' + esc(ev.suggested_department) + '</b> - specialty: ' + esc(ev.suggested_specialty) + '</div>' +
    '<div class="small">Pathway: ' + esc(ev.bed_type.replace('_', ' ')) + ' bed, ' + esc(ev.required_specialty) + ' doctor, ' + ev.nurses_required + ' nurse(s) [' + esc(ev.nurse_skills.join(', ')) + ']' + (Object.keys(ev.equipment).length ? ', equipment ' + esc(Object.keys(ev.equipment).join(', ')) : '') + '</div>' +
    '<div class="small">Priority uplift: +' + ev.priority_uplift_points + ' points (of 100)</div>' +
    '<div class="small muted">' + esc(ev.rationale.join('; ')) + '</div>' +
    '<div class="small"><b>Qualified doctors now:</b> ' + esc((ev.recommended_doctors || []).map(function (d) { return d.name + ' (' + (d.free_in == null ? 'unavailable' : d.free_in === 0 ? 'free' : 'free in ' + d.free_in + ' min') + ')'; }).join('; ') || 'none') + '</div>' +
    '<div class="small muted">' + esc(ev.disclaimer) + '</div></div>';
}

function pgStaff(list, role) {
  var rows = list.map(function (s) {
    var act = s.status === 'unavailable' ? '<button class="btn sm" onclick="A.staffBack(\'' + s.id + '\')">Mark available</button>' : (s.status === 'off_shift' ? '<button class="btn sm" onclick="A.activate(\'' + s.id + '\')">Call in</button>' : '<button class="btn danger sm" onclick="A.staffOutId(\'' + s.id + '\')">Mark unavailable</button>');
    return '<tr><td>' + esc(s.id) + '</td><td>' + esc(s.name) + '</td><td>' + esc(role === 'doctor' ? s.specialty : s.skills.join(', ')) + '</td><td class="small">' + esc(s.shift_label) + '</td><td>' + tag(s.status) + (s.unavailable_reason ? '<div class="small muted">' + esc(s.unavailable_reason) + '</div>' : '') + '</td>' +
      '<td>' + esc(zoneName(s.location)) + (s.covered_zones && s.covered_zones.length ? '<div class="small muted">covers ' + esc(s.covered_zones.map(zoneName).join(', ')) + '</div>' : '') + '</td><td>' + esc(s.current_patient ? s.current_patient + ' ' + (s.current_patient_name || '') : '-') + '</td>' +
      '<td class="small">' + s.assignments + ' assign, ' + Math.round(s.treat_minutes) + ' treat, ' + Math.round(s.travel_minutes) + ' travel min</td><td>' + act + '</td></tr>';
  });
  return '<div class="page"><h2>' + (role === 'doctor' ? 'Doctors' : 'Nurses') + '</h2><div class="panel">' + table(['ID', 'Name', role === 'doctor' ? 'Specialty' : 'Skills', 'Shift', 'Status', 'Location', 'Current patient', 'Workload', ''], rows) + '</div></div>';
}

function pgResources(r, roster) {
  var beds = table(['Bed type', 'Total', 'Operational', 'Occupied', 'Available', 'Cleaning', 'Unavailable'], Object.keys(r.beds).map(function (k) {
    var b = r.beds[k]; return '<tr><td>' + esc(k.replace('_', ' ')) + '</td><td>' + b.total + '</td><td>' + b.operational + '</td><td>' + b.occupied + ' / ' + b.operational + ' ' + bar(b.operational ? b.occupied / b.operational : 0) + '</td><td>' + b.available + '</td><td>' + b.cleaning + '</td><td>' + b.unavailable + '</td></tr>'; }));
  var staff = table(['Staff', 'Active', 'Busy', 'Total'], [['Doctors', r.staff.doctors], ['Nurses', r.staff.nurses]].map(function (x) { return '<tr><td>' + x[0] + '</td><td>' + x[1].active + '</td><td>' + x[1].busy + '</td><td>' + x[1].total + '</td></tr>'; }));
  var eq = table(['Equipment', 'Total', 'Available', 'In use', 'Failed'], r.equipment.map(function (k) { return '<tr><td>' + esc(k.kind.replace('_', ' ')) + '</td><td>' + k.total + '</td><td>' + k.available + '</td><td>' + k.in_use + '</td><td>' + k.unavailable + '</td></tr>'; }));
  var fc = {}; r.forecast.forEach(function (f) { fc[f.item] = f; });
  var cons = table(['Item', 'Stock', 'Allocated', 'Safety min', 'Max', 'Usage/h', 'Projected 24h', 'Status', 'Recommendation'], r.consumables.map(function (c) {
    var f = fc[c.item], lvl = f.level;
    return '<tr><td>' + esc(c.item.replace('_', ' ')) + '</td><td><b>' + Math.round(c.quantity) + '</b></td><td>' + Math.round(c.allocated) + '</td><td>' + c.min_threshold + '</td><td>' + c.max_capacity + '</td><td>' + f.usage_per_hour + '</td><td>' + f.projected + '</td><td>' +
      (lvl === 'ok' ? tag('completed').replace('completed', 'ok') : '<span class="tag unavailable">' + esc(lvl.replace('_', ' ')) + '</span>') + '</td><td class="small">' + (f.restock ? 'Restock about ' + f.restock + ' ' + esc(f.unit) + (f.restock_note ? ' (' + esc(f.restock_note) + ')' : '') : '-') + '</td></tr>';
  }));
  var bedOpts = r.bed_list.map(function (b) { return '<option value="' + b.id + '">' + b.id + ' (' + b.type.replace('_', ' ') + ', ' + b.status + ')</option>'; }).join('');
  var staffOpts = roster.doctors.map(function (d) { return '<option value="' + d.id + '">' + esc(d.name) + '</option>'; }).join('') + roster.nurses.map(function (n) { return '<option value="' + n.id + '">' + esc(n.name) + ' (' + n.id + ')</option>'; }).join('');
  var kinds = r.equipment.map(function (k) { return '<option value="' + k.kind + '">' + k.kind.replace('_', ' ') + '</option>'; }).join('');
  var items = r.consumables.map(function (c) { return '<option value="' + c.item + '">' + c.item.replace('_', ' ') + '</option>'; }).join('');
  var modify = '<div class="panel" data-keep="modify"><h3>Modify resources</h3><div class="warnbox">&#9888; Verification required in production. In this prototype the change is applied immediately, but it flows through the same hospital state and optimizer: affected assignments are found, re-optimized, staff notified, and the reasons shown on the Overview.</div>' +
    '<div class="form" style="margin-top:10px"><div class="row"><b class="small">Bed</b><select id="m_bed">' + bedOpts + '</select><button class="btn sm danger" onclick="A.mod({type:\'bed_unavailable\',id:V(\'m_bed\'),reason:\'marked by head nurse\'})">Mark unavailable</button><button class="btn sm" onclick="A.mod({type:\'bed_available\',id:V(\'m_bed\')})">Restore</button></div>' +
    '<div class="row"><b class="small">Add temporary bed</b><select id="m_bt"><option>emergency</option><option>icu</option><option>monitored</option><option>general</option></select><select id="m_bz"><option value="EMERGENCY">Emergency</option><option value="ICU">ICU</option><option value="WARD_A">Ward A</option><option value="WARD_B">Ward B</option><option value="WARD_C">Ward C</option></select><button class="btn sm" onclick="A.mod({type:\'add_bed\',bed_type:V(\'m_bt\'),zone:V(\'m_bz\')})">Add</button></div>' +
    '<div class="row"><b class="small">Staff</b><select id="m_st">' + staffOpts + '</select><button class="btn sm danger" onclick="A.mod({type:\'staff_unavailable\',id:V(\'m_st\'),reason:\'marked by head nurse\'})">Mark unavailable</button><button class="btn sm" onclick="A.mod({type:\'staff_available\',id:V(\'m_st\')})">Available</button><button class="btn sm" onclick="A.mod({type:\'activate_staff\',id:V(\'m_st\')})">Call in</button></div>' +
    '<div class="row"><b class="small">Equipment</b><select id="m_eq">' + kinds + '</select><button class="btn sm danger" onclick="A.mod({type:\'equipment_unavailable\',kind:V(\'m_eq\'),reason:\'failure\'})">Report failure</button><button class="btn sm" onclick="A.mod({type:\'add_equipment\',kind:V(\'m_eq\')})">Add unit</button><button class="btn sm" onclick="A.mod({type:\'remove_equipment\',kind:V(\'m_eq\'),qty:1})">Remove unit</button></div>' +
    '<div class="row"><b class="small">Consumable</b><select id="m_it">' + items + '</select><input id="m_dl" type="number" value="50" style="width:80px"><button class="btn sm" onclick="A.mod({type:\'adjust_consumable\',item:V(\'m_it\'),delta:+V(\'m_dl\')})">Adjust by</button></div>' +
    '<div class="row"><label class="small"><input type="checkbox" disabled checked> Authorization (prototype: auto-approved, placeholder for production verification)</label></div></div></div>';
  return '<div class="page"><h2>Resource inventory</h2><div class="grid g2"><div class="panel"><h3>Beds</h3>' + beds + '</div><div class="grid"><div class="panel"><h3>Staff</h3>' + staff + '</div><div class="panel"><h3>Equipment</h3>' + eq + '</div></div></div>' +
    '<div class="panel" style="margin-top:12px"><h3>Consumables and forecast</h3>' + cons + '<div class="small muted">Projected = stock minus observed usage rate over the next 24 h with no resupply; recommendation restores the safety minimum plus a buffer (configurable).</div></div><div style="margin-top:12px">' + modify + '</div></div>';
}

function pgOptimization(st, plan, asg, cmp) {
  var J = plan.J || {};
  var jt = Object.keys(J).filter(function (k) { return k !== 'total'; }).map(function (k) { return '<tr><td>' + esc(k.replace('_', ' ')) + '</td><td class="mono">' + f1(J[k]) + '</td></tr>'; }).join('');
  var items = table(['Patient', 'Dispatch', 'Treatment start', 'Bed', 'Doctor', 'Nurses', 'Travel', 'Blocked on', 'Cost'], (plan.items || []).slice(0, 25).map(function (i) {
    return '<tr><td>' + esc(i.patient_id) + '</td><td>+' + (i.dispatch_time - plan.time) + ' min</td><td>' + clockOf(i.start_time) + '</td><td>' + esc(i.bed_id) + '</td><td>' + esc(i.doctor_id) + '</td><td>' + esc(i.nurse_ids.join(', ')) + '</td><td>' + i.travel + '</td><td class="small">' + esc(i.binding) + '</td><td>' + f1(i.cost) + '</td></tr>'; }));
  var un = table(['Patient', 'Reason', 'Blocked on'], (plan.unscheduled || []).slice(0, 15).map(function (u) { return '<tr><td>' + esc(u.patient_id) + '</td><td class="small">' + esc(u.reason) + '</td><td class="small">' + esc(u.binding) + '</td></tr>'; }));
  var log = table(['Time', 'Trigger', 'Mode', 'Waiting', 'J', 'Plan changes'], st.reopts.map(function (r) { return '<tr><td class="mono">' + esc(r.clock) + '</td><td class="small">' + esc(r.reason) + '</td><td>' + r.mode + '</td><td>' + r.waiting + '</td><td>' + f1(r.J.total) + '</td><td>' + r.n_changes + '</td></tr>'; }));
  var conf = (plan.conflicts || []).map(function (c) { return '<div class="alert ' + c.severity + '">' + esc(c.text) + '</div>'; }).join('');
  var cmpH = '<div class="panel" style="margin-top:12px"><div class="spread"><h3>Strategy comparison (measured)</h3><button class="btn primary sm" onclick="A.compare()">Run comparison on current scenario</button></div>' +
    (cmp && cmp.rows ? '<div class="small muted">' + esc(cmp.note) + ' Scenario: ' + esc(cmp.scenario) + ', seed ' + cmp.seed + '.</div>' + table(['Strategy', 'Avg wait', 'Median', 'Max', 'Critical avg', 'Critical max', 'High+ avg', 'Done', 'Left waiting', 'Doctor util', 'Nurse util', 'Travel min', 'Emerg. min', 'Realized J'],
      cmp.rows.map(function (r) { return '<tr><td><b>' + esc(r.label) + '</b></td><td>' + f1(r.avg_wait) + '</td><td>' + f1(r.median_wait) + '</td><td>' + f1(r.max_wait) + '</td><td>' + f1(r.critical_avg_wait) + '</td><td>' + f1(r.critical_max_wait) + '</td><td>' + f1(r.high_avg_wait) + '</td><td>' + r.completed + '</td><td>' + r.waiting_at_end + '</td><td>' + pct(r.doctor_util) + '</td><td>' + pct(r.nurse_util) + '</td><td>' + r.travel_minutes + '</td><td>' + r.emergency_minutes + '</td><td>' + r.realized_J + '</td></tr>'; })) : '<div class="muted small">Runs the whole scenario (same arrivals, same hidden durations) under each strategy - takes a few seconds.</div>') + '</div>';
  return '<div class="page"><h2>Optimization engine</h2><div class="row" style="margin-bottom:10px"><button class="btn primary" onclick="A.optimize()">Run optimization now</button><span class="muted small">Mode: ' + plan.mode + ' - ' + (plan.evaluations || 0) + ' plan evaluations in last epoch</span></div>' + conf +
    '<div class="grid g2"><div class="panel"><h3>Tentative plan (next assignments)</h3>' + items + '</div><div class="grid"><div class="panel"><h3>Plan objective J = ' + f1(J.total) + '</h3><table><tbody>' + jt + '</tbody></table></div><div class="panel"><h3>Unscheduled / conflicts</h3>' + un + '</div></div></div>' +
    '<div class="grid g2" style="margin-top:12px"><div class="panel"><h3>Recommendations</h3>' + recoHtml(st.recommendations) + '<button class="btn sm" onclick="A.refreshReco()">Recompute recommendations</button></div><div class="panel"><h3>Re-optimization log</h3>' + log + '</div></div>' + cmpH + '</div>';
}

function pgAnalytics(c) {
  var modeBands = [], last = 0;
  for (var i = 1; i <= c.mode.length; i++) if (i === c.mode.length || c.mode[i] !== c.mode[last]) { if (c.mode[last] === 'EMERGENCY') modeBands.push([last, i - 1, '#c62828']); else if (c.mode[last] === 'WARNING') modeBands.push([last, i - 1, '#e07b00']); last = i; }
  var N = c.clock;
  var bn = {}; c.bottleneck.forEach(function (b) { if (b.key) bn[b.key] = 1; });
  var stockSeries = Object.keys(c.stock).map(function (k, i) { var th = c.stock_thresholds[k]; return {name: k.replace('_', ' '), values: c.stock[k].map(function (v) { return v / Math.max(1, th); })}; });
  var occ = Object.keys(c.bed_occupancy).map(function (k) { return {name: k.replace('_', ' '), values: c.bed_occupancy[k]}; });
  var dep = Object.keys(c.wait_by_dept).map(function (d) { return {label: d + ' (n=' + c.wait_by_dept[d].n + ')', value: c.wait_by_dept[d].avg}; });
  var P = function (title, body, note) { return '<div class="panel"><h3>' + title + '</h3>' + body + (note ? '<div class="small muted">' + note + '</div>' : '') + '</div>'; };
  var fc = c.forecast || {}, pa = c.predictor || {};
  return '<div class="page"><h2>Analytics <span class="muted small">(all series come from the running simulation; shaded = warning / emergency mode)</span></h2><div class="grid g2">' +
    P('Patient arrivals (per 30 min)', colBars({values: c.arrivals_bins.values, labels: c.arrivals_bins.labels}), 'EWMA demand forecast: ' + f1(fc.rate_per_hour) + ' patients/hour (trend ' + f1(fc.trend) + ')') +
    P('Queue length over time', lineChart({x: c.t, labels: N, series: [{name: 'waiting', values: c.queue.queue}, {name: 'critical waiting', values: c.queue.critical, color: '#c62828'}], bands: modeBands})) +
    P('Average waiting time (min)', lineChart({x: c.t, labels: N, series: [{name: 'avg time-to-treatment (started patients)', values: c.avg_wait.cumulative}, {name: 'avg wait of current queue', values: c.avg_wait.queue_now, color: '#e07b00'}], bands: modeBands})) +
    P('Waiting time by department (avg min)', barChart({items: dep, left: 190})) +
    P('Resource utilization over time', lineChart({x: c.t, labels: N, pct: true, max: 1, series: [{name: 'doctors', values: c.utilization.doctor}, {name: 'nurses', values: c.utilization.nurse}, {name: 'beds', values: c.utilization.bed}, {name: 'ICU', values: c.utilization.icu}, {name: 'emergency beds', values: c.utilization.emergency}], bands: modeBands})) +
    P('Bed occupancy (beds in use)', lineChart({x: c.t, labels: N, series: occ})) +
    P('Doctor workload (minutes)', barChart({items: c.doctor_workload.map(function (d) { return {label: d.name, values: [d.treat, d.travel, d.idle]}; }), colors: ['#1f5fbf', '#e07b00', '#cfd6e2'], legend: ['treating', 'travelling', 'idle'], left: 130, fmt: function (v) { return Math.round(v); }})) +
    P('Nurse workload (minutes)', barChart({items: c.nurse_workload.map(function (d) { return {label: d.name, values: [d.treat, d.travel, d.idle]}; }), colors: ['#1f5fbf', '#e07b00', '#cfd6e2'], legend: ['treating', 'travelling', 'idle'], left: 130, fmt: function (v) { return Math.round(v); }})) +
    P('Expected vs actual treatment duration', scatterChart({points: c.expected_vs_actual.map(function (r) { return {x: r.expected, y: r.actual, id: r.id, department: r.department}; })}), 'Predictor: ' + esc(pa.predictor || 'rule_based') + (pa.n ? ' - MAE ' + pa.mae + ' min vs ' + pa.mae_nominal + ' min for the nominal pathway time (n=' + pa.n + ')' : '')) +
    P('Bottleneck timeline (primary bottleneck)', timelineChart({t: c.t, labels: N, keys: c.bottleneck.map(function (b) { return b.key; })})) +
    P('Operating mode timeline', timelineChart({t: c.t, labels: N, keys: c.mode.map(function (m) { return m === 'NORMAL' ? null : m; }), colorMap: {WARNING: '#e07b00', EMERGENCY: '#c62828', RECOVERY: '#1f5fbf'}})) +
    P('Consumable stock vs safety threshold (1.0 = threshold)', lineChart({x: c.t, labels: N, series: stockSeries, hline: 1, min: 0}), 'Values below the red line are under the safety minimum.') +
    '</div></div>';
}

function kv(rows) { return '<div class="kv">' + rows.map(function (r) { return '<div>' + r[0] + '</div><div>' + r[1] + '</div>'; }).join('') + '</div>'; }
function pgReport(r) {
  var k = r.kpis, pf = r.patient_flow, u = r.utilization;
  var dept = table(['Department', 'Patients', 'Completed', 'Avg wait', 'Median', 'Max'], Object.keys(pf.by_department).map(function (d) { var x = pf.by_department[d]; return '<tr><td>' + esc(d) + '</td><td>' + x.patients + '</td><td>' + x.completed + '</td><td>' + x.avg + '</td><td>' + x.median + '</td><td>' + x.max + '</td></tr>'; }));
  var wl = function (rows) { return table(['Name', 'Assignments', 'Treat min', 'Travel min', 'Idle min', 'Utilization'], rows.map(function (w) { return '<tr><td>' + esc(w.name) + '</td><td>' + w.assignments + '</td><td>' + w.treat_minutes + '</td><td>' + w.travel_minutes + '</td><td>' + w.idle_minutes + '</td><td>' + pct(w.utilization) + '</td></tr>'; })); };
  var bn = table(['Resource', 'From', 'Duration', 'Peak score', 'Patients affected', 'Cause', 'Intervention'], r.bottlenecks.map(function (b) { return '<tr><td>' + esc(b.key) + '</td><td>' + b.start_clock + '</td><td>' + b.duration + ' min</td><td>' + f1(b.peak) + '</td><td>' + b.peak_blocked + '</td><td class="small">' + esc(b.cause) + '</td><td class="small">' + esc(b.intervention || '-') + '</td></tr>'; }));
  var inv = table(['Item', 'Current', 'Consumed', 'Projected 24h', 'Safety', 'Alert', 'Recommendation'], r.inventory.items.map(function (i) { return '<tr><td>' + esc(i.item.replace('_', ' ')) + '</td><td>' + i.current + '</td><td>' + i.consumed + '</td><td>' + i.projected + '</td><td>' + i.safety_threshold + '</td><td>' + (i.level === 'ok' ? 'ok' : esc(i.level.replace('_', ' '))) + '</td><td class="small">' + (i.restock ? 'Restock about ' + i.restock + ' ' + esc(i.unit) : '-') + '</td></tr>'; }));
  var em = r.emergency, tr = table(['Time', 'Transition', 'Trigger'], em.transitions.map(function (t) { return '<tr><td>' + clockOf(t.t) + '</td><td>' + t.from_state + ' &rarr; ' + t.to_state + '</td><td class="small">' + esc(t.trigger) + '</td></tr>'; }));
  var du = r.duration_uncertainty;
  return '<div class="page"><h2>Operational report <span class="muted small">as of ' + r.clock + (r.finished ? ' (end of day)' : ' (day in progress)') + ' - ' + esc(r.scenario) + ' - ' + esc(r.strategy) + '</span></h2>' +
    '<div class="grid g3">' + kpi('Patients', pf.total, pf.completed + ' completed, ' + pf.waiting_at_end + ' waiting, ' + pf.in_treatment + ' in treatment, ' + pf.transferred + ' transferred') +
    kpi('Wait (min)', pf.wait.avg, 'median ' + pf.wait.median + ', p90 ' + pf.wait.p90 + ', max ' + pf.wait.max) + kpi('Critical wait (min)', pf.critical_wait.avg, 'median ' + pf.critical_wait.median + ', max ' + pf.critical_wait.max + ' (n=' + pf.critical_wait.n + ')') + '</div>' +
    '<div class="grid g2" style="margin-top:12px"><div class="panel"><h3>Waiting by department</h3>' + dept + '</div><div class="panel"><h3>Resource utilization</h3>' + kv(Object.keys(u).map(function (x) { return [x.replace('_', ' '), pct(u[x])]; })) + '</div></div>' +
    '<div class="panel" style="margin-top:12px"><h3>Bottlenecks (' + r.bottlenecks.length + ')</h3>' + bn + '</div>' +
    '<div class="panel" style="margin-top:12px"><h3>Recommended improvements (generated from this run)</h3>' + (r.recommendations.length ? '<ul>' + r.recommendations.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>' : '<div class="muted">None</div>') + '</div>' +
    '<div class="grid g2" style="margin-top:12px"><div class="panel"><h3>Doctor workload</h3>' + wl(r.workload.doctors) + '</div><div class="panel"><h3>Nurse workload</h3>' + wl(r.workload.nurses) + '</div></div>' +
    '<div class="grid g2" style="margin-top:12px"><div class="panel"><h3>Inventory and replenishment</h3>' + inv + '</div><div class="panel"><h3>Emergency mode (' + em.minutes.EMERGENCY + ' min in EMERGENCY, ' + em.minutes.WARNING + ' in WARNING)</h3>' + tr + '</div></div>' +
    '<div class="grid g2" style="margin-top:12px"><div class="panel"><h3>Treatment-duration uncertainty</h3>' + kv([['Completed treatments', du.n], ['Mean (actual - expected)', du.mean_error + ' min'], ['Overran by >25%', du.overruns_over_25pct], ['Predictor', esc(du.predictor.predictor || 'rule_based') + (du.predictor.mae != null ? ', MAE ' + du.predictor.mae + ' min' : '')]]) + '</div>' +
    '<div class="panel"><h3>Optimization activity</h3>' + kv([['Re-optimizations', r.optimization.reoptimizations], ['Triggers', esc(Object.keys(r.optimization.triggers).map(function (t) { return t + ' x' + r.optimization.triggers[t]; }).join(', '))], ['Interruptions / requeues', k.interruptions], ['Deteriorations while waiting', k.deteriorations], ['Realized objective J', k.realized_J], ['Staff travel', k.travel_minutes + ' min']]) + '</div></div></div>';
}
