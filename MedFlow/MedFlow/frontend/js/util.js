/* Shared helpers. Render functions elsewhere are pure (data -> HTML string) so they can be tested in Node. */
var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]; }); };
var api = {
  get: function (p) { return fetch('/api' + p).then(function (r) { return r.json(); }); },
  post: function (p, b) { return fetch('/api' + p, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(b || {})}).then(function (r) { return r.json(); }); }
};
var f1 = function (x) { return x == null ? '-' : (Math.round(x * 10) / 10).toString(); };
var pct = function (x) { return x == null ? '-' : Math.round(x * 100) + '%'; };
var cat = function (u) { return u >= 8 ? 'CRITICAL' : u >= 6 ? 'HIGH' : u >= 4 ? 'MEDIUM' : 'LOW'; };
var uBadge = function (u) { return '<span class="u ' + cat(u) + '">' + u + '</span>'; };
var tag = function (s) { return '<span class="tag ' + esc(s) + '">' + esc(String(s).replace(/_/g, ' ')) + '</span>'; };
var zoneName = function (z) { return {EMERGENCY: 'Emergency', ICU: 'ICU', WARD_A: 'Ward A', WARD_B: 'Ward B', WARD_C: 'Ward C', OR: 'Theatres', HUB: 'Corridor'}[z] || z; };
var bar = function (v, warnAt) { var c = v >= 0.9 ? 'hot' : v >= (warnAt || 0.75) ? 'mid' : ''; return '<div class="bar"><i class="' + c + '" style="width:' + Math.min(100, Math.round(v * 100)) + '%"></i></div>'; };
var kpi = function (label, value, sub, cls) { return '<div class="panel kpi ' + (cls || '') + '"><div class="l">' + label + '</div><div class="v">' + value + '</div><div class="s">' + (sub || '') + '</div></div>'; };
var table = function (heads, rows, cls) {
  return '<div class="scroll ' + (cls || '') + '"><table><thead><tr>' + heads.map(function (h) { return '<th>' + h + '</th>'; }).join('') + '</tr></thead><tbody>' +
    (rows.length ? rows.join('') : '<tr><td colspan="' + heads.length + '" class="muted">None</td></tr>') + '</tbody></table></div>';
};
var alertsHtml = function (list) { return (list || []).map(function (a) { return '<div class="alert ' + esc(a.level || 'warning') + '">' + esc(a.text) + '</div>'; }).join('') || '<div class="muted small">No active alerts</div>'; };
var clockOf = function (t) { var m = 480 + Math.round(t); return ('0' + (Math.floor(m / 60) % 24)).slice(-2) + ':' + ('0' + (m % 60)).slice(-2); };
