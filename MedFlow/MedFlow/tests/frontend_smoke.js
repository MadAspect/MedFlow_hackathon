// Node smoke test: loads the SPA scripts in a stub DOM and renders every page against the live API.
const vm = require('vm'), fs = require('fs');
const base = process.argv[2] || 'http://localhost:8766';
const ctx = {console, fetch: (p, o) => fetch(p.startsWith('/') ? base + p : p, o), setInterval: () => 0, clearInterval() {}, setTimeout,
  document: {getElementById: () => null, querySelectorAll: () => [], createElement: () => ({}), body: {appendChild() {}}, activeElement: null}, localStorage: {getItem: () => null, setItem() {}, removeItem() {}}};
vm.createContext(ctx);
for (const f of ['util', 'charts', 'map', 'head', 'head2', 'staff', 'algo', 'app']) vm.runInContext(fs.readFileSync(`frontend/js/${f}.js`, 'utf8'), ctx, {filename: f + '.js'});
const run = (code) => vm.runInContext(code, ctx);
const g = async (p) => (await fetch(base + '/api' + p)).json();
let bad = 0;
const check = (name, html) => {
  const issues = [];
  if (!html || html.length < 200) issues.push('too short');
  for (const w of ['undefined', 'NaN', '[object', 'null min', 'Infinity']) if (html.includes(w)) issues.push('contains ' + w + ' near: ' + html.slice(Math.max(0, html.indexOf(w) - 60), html.indexOf(w) + 40).replace(/\s+/g, ' '));
  console.log((issues.length ? 'FAIL ' : 'ok   ') + name + ' (' + (html || '').length + ' chars)' + (issues.length ? ' -> ' + issues.join(' | ') : ''));
  if (issues.length) bad++;
};
(async () => {
  ctx.__d = {};
  const st = await g('/state'), roster = await g('/roster');
  ctx.__st = st; ctx.__w = await g('/patients?status=waiting'); ctx.__it = await g('/patients?status=in_treatment'); ctx.__r = roster;
  check('overview', run('pgOverview(__st, __w)'));
  check('console', run('consoleHtml(__r, __it)'));
  ctx.__m = await g('/map'); check('map', run('mapHtml(__m)'));
  const bed = ctx.__m.zones.flatMap(z => z.beds).find(b => b.patient) || ctx.__m.zones.flatMap(z => z.beds)[0]; ctx.__b = bed; check('bed drawer', run('bedDrawer(__b)') + ' '.repeat(200));
  ctx.__p = await g('/patients'); check('patients', run('pgPatients(__p)'));
  ctx.__dc = await g('/doctors'); check('doctors', run("pgStaff(__dc,'doctor')"));
  ctx.__nu = await g('/nurses'); check('nurses', run("pgStaff(__nu,'nurse')"));
  ctx.__rs = await g('/resources'); check('resources', run('pgResources(__rs, __r)'));
  ctx.__pl = await g('/plan'); ctx.__as = await g('/assignments'); check('optimization', run('pgOptimization(__st, __pl, __as, null)'));
  ctx.__an = await g('/analytics'); check('analytics', run('pgAnalytics(__an)'));
  ctx.__rp = await g('/report'); check('report', run('pgReport(__rp)'));
  ctx.__cf = await g('/config'); check('algorithm', run('pgAlgorithm(__cf)'));
  const cmp = await (await fetch(base + '/api/compare', {method: 'POST', body: JSON.stringify({scenario: 'normal_day'})})).json(); ctx.__cmp = cmp;
  check('optimization+comparison', run('pgOptimization(__st, __pl, __as, __cmp)'));
  const ev = await (await fetch(base + '/api/diagnosis/evaluate', {method: 'POST', body: JSON.stringify({symptoms: ['chest pain', 'shortness of breath', 'high heart rate'], age: 58})})).json(); ctx.__ev = ev; check('diagnosis', run('dxHtml(__ev)') + ' '.repeat(200));
  for (const role of ['nurse', 'doctor']) {
    const ids = (role === 'nurse' ? roster.nurses : roster.doctors).map(x => x.id);
    let seen = {busy: 0, idle: 0};
    for (const id of ids) {
      const v = await g('/' + role + '/' + id); ctx.__v = v;
      const h = run('pgStaffDash(__v)') + run('pgStaffPatients(__v)') + run("pgStaffTasks(__v,'x')") + run('pgStaffAlerts(__v)');
      v.current ? seen.busy++ : seen.idle++;
      const issues = ['undefined', 'NaN', '[object'].filter(w => h.includes(w));
      if (issues.length) { bad++; console.log('FAIL ' + role + ' ' + id + ' ' + issues + ' ' + h.slice(h.indexOf(issues[0]) - 60, h.indexOf(issues[0]) + 40)); }
    }
    console.log('ok   ' + role + ' dashboards for ' + ids.length + ' staff (' + seen.busy + ' with current task, ' + seen.idle + ' without)');
  }
  console.log(bad ? bad + ' FAILURES' : 'ALL FRONTEND RENDERS OK'); process.exit(bad ? 1 : 0);
})();
