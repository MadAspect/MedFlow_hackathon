/* MedFlow SPA: login -> role dashboards. Polls the shared simulation once per second. */
var S = {role: null, id: null, page: null, timer: null, cache: {}, sim: null};
var A = {};
var V = function (id) { var e = document.getElementById(id); return e ? e.value : ''; };
var $id = function (id) { return document.getElementById(id); };

var NAV = {
  head: [['overview', 'Overview'], ['map', 'Live Hospital Map'], ['patients', 'Patients'], ['doctors', 'Doctors'], ['nurses', 'Nurses'], ['resources', 'Resources'], ['optimization', 'Optimization'], ['analytics', 'Analytics'], ['report', 'Daily Report'], ['algorithm', 'Algorithm']],
  nurse: [['dashboard', 'My Dashboard'], ['patients', 'My Patients'], ['tasks', 'My Tasks'], ['map', 'Hospital Map'], ['alerts', 'Alerts']],
  doctor: [['dashboard', 'My Dashboard'], ['patients', 'My Patients'], ['tasks', 'Schedule'], ['map', 'Hospital Map'], ['alerts', 'Alerts']]
};

function toast(msg, bad) {
  var t = $id('toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; t.style.cssText = 'position:fixed;left:50%;bottom:20px;transform:translateX(-50%);background:#14213d;color:#fff;padding:10px 16px;border-radius:5px;z-index:50;max-width:80%;font-size:13px'; document.body.appendChild(t); }
  t.style.background = bad ? '#c62828' : '#14213d'; t.textContent = msg; t.style.display = 'block';
  clearTimeout(t._h); t._h = setTimeout(function () { t.style.display = 'none'; }, 4500);
}

/* ---------------- login ---------------- */
function showLogin() {
  clearInterval(S.timer);
  api.get('/roster').then(function (r) {
    S.cache.roster = r;
    var sel = S.loginRole || null;
    var html = '<div class="login"><h1>MEDFLOW</h1><div class="sub">Hospital Operations &amp; Resource Optimization</div>' +
      '<button class="role ' + (sel === 'head' ? 'sel' : '') + '" onclick="A.pickRole(\'head\')"><b>Head Nurse</b><br><small>Command centre - live hospital, resources, optimization, analytics</small></button>' +
      '<button class="role ' + (sel === 'doctor' ? 'sel' : '') + '" onclick="A.pickRole(\'doctor\')"><b>Doctor</b><br><small>Current / next patient, schedule, location</small></button>' +
      '<button class="role ' + (sel === 'nurse' ? 'sel' : '') + '" onclick="A.pickRole(\'nurse\')"><b>Nurse</b><br><small>Current / next task, where to go next</small></button>';
    if (sel === 'doctor' || sel === 'nurse') {
      var list = sel === 'doctor' ? r.doctors : r.nurses;
      html += '<div class="form" style="margin-top:14px"><label>Select ' + sel + '<select id="lg_id">' + list.map(function (p) { return '<option value="' + p.id + '">' + esc(p.name) + (sel === 'doctor' ? ' - ' + esc(p.specialty) : ' - ' + zoneName(p.zone)) + '</option>'; }).join('') + '</select></label></div>';
    }
    if (sel) html += '<button class="btn primary" style="margin-top:14px;width:100%" onclick="A.login()">LOGIN</button>';
    html += '<p class="small muted" style="margin-top:18px">Prototype authentication only (no passwords). Decision-support prototype - not clinically validated software.</p><p class="small"><a href="/legacy/">Legacy MVP simulator</a></p></div>';
    $id('app').innerHTML = html;
  });
}
A.pickRole = function (r) { S.loginRole = r; if (r === 'head') { A.loginAs('head', 'HEAD'); } else showLogin(); };
A.login = function () { A.loginAs(S.loginRole, V('lg_id')); };
A.loginAs = function (role, id) { S.role = role; S.id = id; S.page = NAV[role][0][0]; localStorage.setItem('medflow_session', JSON.stringify({role: role, id: id})); buildShell(); };
A.logout = function () { closeDrawer(); localStorage.removeItem('medflow_session'); S.role = null; S.loginRole = null; showLogin(); };

/* ---------------- shell ---------------- */
function buildShell() {
  var nav = NAV[S.role].map(function (n) { return '<a class="' + (n[0] === S.page ? 'on' : '') + '" onclick="A.go(\'' + n[0] + '\')">' + n[1] + '</a>'; }).join('');
  var who = S.role === 'head' ? 'Head Nurse' : esc(S.cache.who || S.id);
  var top = '<span class="clock" id="clk">--:--</span><span id="modepill"></span><span class="muted small" id="simtxt"></span><span class="grow"></span>';
  if (S.role === 'head') {
    api.get('/config').then(function (c) {
      S.cache.cfg = c;
      var sc = Object.keys(c.scenarios).map(function (k) { return '<option value="' + k + '">' + esc(c.scenarios[k].label) + '</option>'; }).join('');
      var st = Object.keys(c.strategies).map(function (k) { return '<option value="' + k + '">' + esc(c.strategies[k].label) + '</option>'; }).join('');
      $id('simctl').innerHTML = '<button class="btn primary sm" id="btnRun" onclick="A.toggle()">Start</button><select id="spd" onchange="A.speed()"><option value="1">1 min/s</option><option value="5" selected>5 min/s</option><option value="15">15 min/s</option><option value="40">40 min/s</option></select>' +
        '<button class="btn sm" onclick="A.step(5)">+5 min</button><button class="btn sm" onclick="A.step(30)">+30 min</button>' +
        '<select id="scn">' + sc + '</select><select id="stg">' + st + '</select><button class="btn sm" onclick="A.reset()">Reset</button>';
      if (S.sim) { $id('scn').value = S.sim.scenario; $id('stg').value = S.sim.strategy; }
    });
    top += '<span class="ctl" id="simctl"></span>';
  }
  $id('app').innerHTML = '<div class="shell"><nav class="side"><div class="brand">MEDFLOW<small>Hospital operations</small></div>' + nav + '<div class="who">Signed in: ' + who + '<br>Prototype login<br><button class="btn sm" style="margin-top:8px" onclick="A.logout()">Log out</button></div></nav><div class="main"><div class="top">' + top + '</div><div id="view"></div></div></div>';
  clearInterval(S.timer);
  S.first = true;
  refresh();
  S.timer = setInterval(refresh, 1000);
}
A.go = function (p) { closeDrawer(); S.page = p; S.first = true; buildNavOnly(); refresh(); };
function buildNavOnly() { var links = document.querySelectorAll('.side a'); NAV[S.role].forEach(function (n, i) { links[i].className = n[0] === S.page ? 'on' : ''; }); }

function updateTop(sim, mode) {
  if (!sim) return;
  S.sim = sim;
  $id('clk').textContent = sim.clock;
  $id('modepill').innerHTML = '<span class="pill ' + mode + '">' + mode + '</span>';
  $id('simtxt').textContent = sim.finished ? 'Day complete' : (sim.running ? 'running' : 'paused') + ' - ' + Math.round(sim.t) + '/' + sim.duration + ' min';
  var b = $id('btnRun'); if (b) { b.textContent = sim.finished ? 'Finished' : sim.running ? 'Pause' : (sim.t > 0 ? 'Resume' : 'Start'); b.disabled = sim.finished; }
  var sc = $id('scn'); if (sc && document.activeElement !== sc && !sc._set) { sc.value = sim.scenario; $id('stg').value = sim.strategy; sc._set = true; }
}

/* ---------------- data loading per page ---------------- */
function loadPage() {
  var p = S.page;
  if (S.role === 'head') {
    if (p === 'overview') return Promise.all([api.get('/state'), api.get('/patients?status=waiting'), S.first ? api.get('/patients?status=in_treatment') : Promise.resolve(null)]).then(function (r) {
      updateTop(r[0].sim, r[0].emergency.state);
      var html = pgOverview(r[0], r[1]);
      if (!document.querySelector('[data-keep="console"]')) html = html.replace('<div data-keep="console"></div>', consoleHtml(S.cache.roster, (r[2] || []).filter(function (x) { return x.status === 'in_treatment'; })));
      return html;
    });
    var withTop = function (pr) { return Promise.all([pr, api.get('/state')]).then(function (r) { updateTop(r[1].sim, r[1].emergency.state); return r[0]; }); };
    if (p === 'map') return withTop(api.get('/map').then(function (m) { S.cache.map = m; return '<div class="page"><h2>Live hospital map</h2>' + mapHtml(m) + '</div>'; }));
    if (p === 'patients') return withTop(api.get('/patients').then(pgPatients));
    if (p === 'doctors') return withTop(api.get('/doctors').then(function (l) { return pgStaff(l, 'doctor'); }));
    if (p === 'nurses') return withTop(api.get('/nurses').then(function (l) { return pgStaff(l, 'nurse'); }));
    if (p === 'resources') return withTop(api.get('/resources').then(function (r) { return pgResources(r, S.cache.roster); }));
    if (p === 'optimization') return Promise.all([api.get('/state'), api.get('/plan'), api.get('/assignments')]).then(function (r) { updateTop(r[0].sim, r[0].emergency.state); return pgOptimization(r[0], r[1], r[2], S.cache.cmp); });
    if (p === 'analytics') return withTop(api.get('/analytics').then(pgAnalytics));
    if (p === 'report') return withTop(api.get('/report').then(pgReport));
    if (p === 'algorithm') return (S.cache.cfg ? Promise.resolve(S.cache.cfg) : api.get('/config')).then(function (c) { S.cache.cfg = c; return pgAlgorithm(c); });
  } else {
    var ep = '/' + S.role + '/' + S.id;
    return api.get(ep).then(function (v) {
      S.cache.who = v.name; S.cache.view = v; $id('clk').textContent = v.clock; $id('modepill').innerHTML = '<span class="pill ' + v.mode + '">' + v.mode + '</span>';
      if (p === 'dashboard') return pgStaffDash(v);
      if (p === 'patients') return pgStaffPatients(v);
      if (p === 'tasks') return pgStaffTasks(v, S.role === 'doctor' ? 'Schedule' : 'My tasks');
      if (p === 'alerts') return pgStaffAlerts(v);
      if (p === 'map') return api.get('/map').then(function (m) { S.cache.map = m; return '<div class="page"><h2>Hospital map</h2>' + mapHtml(m) + '</div>'; });
    });
  }
  return Promise.resolve('');
}

function inField() { var a = document.activeElement; return a && $id('view') && $id('view').contains(a) && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName); }

function refresh() {
  if (!S.role || inField()) return;
  loadPage().then(function (html) {
    if (html == null || inField()) return;
    var view = $id('view'), tpl = document.createElement('div');
    tpl.innerHTML = html;
    tpl.querySelectorAll('[data-keep]').forEach(function (n) { var old = view.querySelector('[data-keep="' + n.getAttribute('data-keep') + '"]'); if (old && !S.first) n.replaceWith(old); });
    var scrolls = Array.prototype.map.call(view.querySelectorAll('.scroll'), function (s) { return s.scrollTop; });
    view.replaceChildren.apply(view, Array.prototype.slice.call(tpl.childNodes));
    view.querySelectorAll('.scroll').forEach(function (s, i) { if (scrolls[i]) s.scrollTop = scrolls[i]; });
    S.first = false;
  }).catch(function (e) { console.error(e); });
}

/* ---------------- actions ---------------- */
var post = function (path, body, msg) { return api.post(path, body).then(function (r) { if (r && r.error) toast(r.error, true); else if (msg) toast(typeof msg === 'function' ? msg(r) : msg); refresh(); return r; }); };
A.toggle = function () { post('/simulation/' + (S.sim && S.sim.running ? 'pause' : 'start'), {}); };
A.speed = function () { post('/simulation/speed', {speed: +V('spd')}); };
A.step = function (n) { post('/simulation/step', {minutes: n}); };
A.reset = function () { S.first = true; post('/simulation/reset', {scenario: V('scn'), strategy: V('stg')}, 'Scenario reset'); $id('scn')._set = true; };
A.surge = function () { post('/events/inject', {type: 'surge', n: +V('sg_n'), window: +V('sg_w'), critical_frac: +V('sg_c') / 100}, 'Emergency surge injected'); };
A.staffOut = function () { A.mod({type: 'staff_unavailable', id: V('ss_id'), reason: 'reported unavailable'}); };
A.staffOutId = function (id) { A.mod({type: 'staff_unavailable', id: id, reason: 'marked by head nurse'}); };
A.staffBack = function (id) { A.mod({type: 'staff_available', id: id}); };
A.activate = function (id) { A.mod({type: 'activate_staff', id: id}); };
A.fail = function () { var v = V('rf_id').split(':'); A.mod(v[0] === 'bed' ? {type: 'bed_unavailable', id: v[1], reason: 'reported failure'} : {type: 'equipment_unavailable', id: v[1], reason: 'reported failure'}); };
A.overrun = function () { post('/events/inject', {type: 'overrun', patient_id: V('ov_id') || undefined, factor: +V('ov_f')}, 'Treatment will run longer than planned (system not told)'); };
A.mod = function (b) { post('/resources/modify', b, function (r) { return r.change + (r.affected && r.affected.length ? ' - ' + r.affected.length + ' assignment(s) re-planned' : ''); }); };
A.applyReco = function (rank) { post('/interventions/apply', {rank: rank}, function (r) { return 'Applied: ' + r.change; }); };
A.optimize = function () { post('/optimization/run', {}, 'Re-optimized'); };
A.refreshReco = function () { post('/optimization/run', {recommendations: true}, 'Recommendations recomputed'); };
A.compare = function () {
  toast('Running scenario under every strategy...');
  api.post('/compare', {}).then(function (r) { S.cache.cmp = r; toast('Comparison finished'); refresh(); });
};
function dxPayload() {
  var v = {}; [['np_hr', 'heart_rate'], ['np_spo2', 'spo2'], ['np_sbp', 'systolic_bp']].forEach(function (p) { if (V(p[0])) v[p[1]] = +V(p[0]); });
  return {name: V('np_name'), age: +V('np_age'), symptoms: V('np_sym').split(',').map(function (s) { return s.trim(); }).filter(Boolean), vitals: v};
}
A.evalDx = function () { api.post('/diagnosis/evaluate', dxPayload()).then(function (ev) { $id('np_out').innerHTML = dxHtml(ev); }); };
A.addPatient = function () { post('/patients', dxPayload(), function (p) { return 'Admitted ' + p.id + ' (urgency ' + p.urgency + ')'; }); };

A.bed = function (id) {
  var b = null; (S.cache.map ? S.cache.map.zones : []).forEach(function (z) { z.beds.forEach(function (x) { if (x.id === id) b = x; }); });
  if (b) openDrawer(bedDrawer(b));
};
A.patient = function (id) {
  api.get('/patients/' + id).then(function (p) {
    if (p.error) return;
    var c = p.priority || {};
    var h = '<h3>' + esc(p.id) + ' - ' + esc(p.name) + ' ' + uBadge(p.urgency) + '</h3>' + tag(p.status) +
      kv([['Age / sex', p.age + ' / ' + esc(p.sex)], ['Presentation', esc(p.initial_diagnosis)], ['Symptoms', esc(p.symptoms.join(', '))], ['Risk category', esc(p.risk_category) + ' (clinical index ' + p.clinical_score + ')'], ['Department', esc(p.department)],
        ['Needs', esc(p.bed_type_required.replace('_', ' ')) + ' bed, ' + esc(p.required_specialty) + ' doctor, ' + p.nurses_required + ' nurse(s) ' + esc(p.required_nurse_skills.join('/'))], ['Location', esc(p.location)], ['Doctor', esc(p.doctor_name || '-')], ['Nurses', esc((p.nurse_names || []).join(', ') || '-')],
        ['Expected duration', p.treatment_time_expected ? p.treatment_time_expected + ' min' : '-'], ['Actual duration', p.treatment_time_actual != null ? p.treatment_time_actual + ' min' : '-'], ['Deteriorations', p.deteriorations], ['Interruptions', p.interruptions],
        ['Data source', esc(p.source)]]);
    if (p.status === 'waiting' && c.S != null) h += '<h3 style="margin-top:14px">Priority breakdown</h3>' + table(['Component', 'Value'], [['U urgency', c.U], ['W waiting pressure', c.W], ['D deterioration', c.D], ['R resource availability', c.R], ['C clinical index', c.C], ['<b>S total</b>', '<b>' + c.S + '</b>']].map(function (r) { return '<tr><td>' + r[0] + '</td><td class="mono">' + r[1] + '</td></tr>'; })) + (p.conflict ? '<div class="alert critical">' + esc(p.conflict) + '</div>' : '');
    h += '<h3 style="margin-top:14px">Timeline</h3>' + table(['Time', 'Event'], (p.timeline || []).map(function (t) { return '<tr><td class="mono">' + clockOf(t[0]) + '</td><td>' + esc(t[1]) + '</td></tr>'; }));
    openDrawer(h);
  });
};
function openDrawer(html) { var d = $id('drawer'); d.innerHTML = '<div class="spread"><span></span><button class="btn sm" onclick="closeDrawer()">Close</button></div>' + html; d.classList.remove('hidden'); }
function closeDrawer() { $id('drawer').classList.add('hidden'); }

/* ---------------- boot ---------------- */
if (typeof document !== 'undefined' && document.getElementById('app')) {
  var saved = null; try { saved = JSON.parse(localStorage.getItem('medflow_session')); } catch (e) {}
  api.get('/roster').then(function (r) { S.cache.roster = r; if (saved && saved.role) { S.role = saved.role; S.id = saved.id; S.page = NAV[S.role][0][0]; buildShell(); } else showLogin(); });
}
