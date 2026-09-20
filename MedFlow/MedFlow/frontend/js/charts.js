/* Tiny SVG chart library (no dependencies). All functions return SVG/HTML strings. */
var PALETTE = ['#1f5fbf', '#c62828', '#2e7d32', '#e07b00', '#6a4fb3', '#00838f', '#8d6e63', '#546e7a'];
function _scale(vals, lo, hi) { var mn = lo != null ? lo : Math.min.apply(null, vals.concat([0])), mx = hi != null ? hi : Math.max.apply(null, vals.concat([1e-9])); if (mx === mn) mx = mn + 1; return [mn, mx]; }
function legend(items) { return '<div class="legendrow">' + items.map(function (s, i) { return '<span><i style="background:' + (s.color || PALETTE[i % 8]) + '"></i>' + esc(s.name) + '</span>'; }).join('') + '</div>'; }
function lineChart(o) {
  var W = 620, H = o.height || 200, L = 38, R = 8, T = 8, B = 22, n = (o.x || []).length;
  if (!n) return '<div class="muted small">No data yet</div>';
  var all = []; o.series.forEach(function (s) { all = all.concat(s.values); });
  var sc = _scale(all, o.min != null ? o.min : 0, o.max), mn = sc[0], mx = sc[1];
  var X = function (i) { return L + (n === 1 ? 0 : i * (W - L - R) / (n - 1)); }, Y = function (v) { return T + (H - T - B) * (1 - (v - mn) / (mx - mn)); };
  var g = '';
  for (var k = 0; k <= 4; k++) { var v = mn + (mx - mn) * k / 4, y = Y(v); g += '<line class="grid" x1="' + L + '" x2="' + (W - R) + '" y1="' + y + '" y2="' + y + '"/><text x="' + (L - 4) + '" y="' + (y + 3) + '" text-anchor="end">' + (o.pct ? Math.round(v * 100) + '%' : (Math.round(v * 10) / 10)) + '</text>'; }
  var step = Math.max(1, Math.floor(n / 6)); (o.labels || o.x).forEach(function (l, i) { if (i % step === 0) g += '<text x="' + X(i) + '" y="' + (H - 6) + '" text-anchor="middle">' + esc(l) + '</text>'; });
  if (o.bands) o.bands.forEach(function (b) { g = '<rect x="' + X(b[0]) + '" width="' + Math.max(2, X(b[1]) - X(b[0])) + '" y="' + T + '" height="' + (H - T - B) + '" fill="' + b[2] + '" opacity=".13"/>' + g; });
  if (o.hline != null) g += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(o.hline) + '" y2="' + Y(o.hline) + '" stroke="#c62828" stroke-dasharray="4 3"/>';
  var paths = o.series.map(function (s, i) { return '<polyline fill="none" stroke="' + (s.color || PALETTE[i % 8]) + '" stroke-width="1.8" points="' + s.values.map(function (v, j) { return X(j).toFixed(1) + ',' + Y(v).toFixed(1); }).join(' ') + '"/>'; }).join('');
  return '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '">' + g + paths + '</svg>' + (o.series.length > 1 || o.legend ? legend(o.series) : '');
}
function barChart(o) {
  var items = o.items || []; if (!items.length) return '<div class="muted small">No data yet</div>';
  var W = 620, rowH = 18, H = items.length * rowH + 14, L = o.left || 120, mx = Math.max.apply(null, items.map(function (i) { return i.values ? i.values.reduce(function (a, b) { return a + b; }, 0) : i.value; }).concat([1e-9]));
  var out = items.map(function (it, i) {
    var y = 4 + i * rowH, x = L, seg = '';
    var vals = it.values || [it.value], cols = o.colors || [it.color || PALETTE[0]];
    vals.forEach(function (v, k) { var w = (W - L - 50) * v / mx; seg += '<rect x="' + x + '" y="' + y + '" width="' + Math.max(0, w) + '" height="12" fill="' + (cols[k] || PALETTE[k % 8]) + '"/>'; x += w; });
    var tot = vals.reduce(function (a, b) { return a + b; }, 0);
    return '<text x="' + (L - 6) + '" y="' + (y + 10) + '" text-anchor="end">' + esc(it.label) + '</text>' + seg + '<text x="' + (x + 4) + '" y="' + (y + 10) + '">' + (o.fmt ? o.fmt(tot) : f1(tot)) + '</text>';
  }).join('');
  return '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '">' + out + '</svg>' + (o.legend ? legend(o.legend.map(function (n, i) { return {name: n, color: (o.colors || PALETTE)[i]}; })) : '');
}
function colBars(o) {
  var v = o.values || []; if (!v.length) return '<div class="muted small">No data yet</div>';
  var W = 620, H = 170, L = 30, B = 22, T = 8, mx = Math.max.apply(null, v.concat([1])), bw = (W - L - 8) / v.length;
  var out = v.map(function (x, i) { var h = (H - T - B) * x / mx; return '<rect x="' + (L + i * bw + 2) + '" y="' + (H - B - h) + '" width="' + (bw - 4) + '" height="' + h + '" fill="' + PALETTE[0] + '"/>' + (i % 2 === 0 ? '<text x="' + (L + i * bw + bw / 2) + '" y="' + (H - 8) + '" text-anchor="middle">' + esc(o.labels[i]) + '</text>' : ''); }).join('');
  return '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '"><text x="4" y="14">' + mx + '</text>' + out + '</svg>';
}
function scatterChart(o) {
  var pts = o.points || []; if (!pts.length) return '<div class="muted small">No completed treatments yet</div>';
  var W = 620, H = 240, L = 40, B = 24, T = 8, R = 10, mx = Math.max.apply(null, pts.map(function (p) { return Math.max(p.x, p.y); }).concat([10])) * 1.05;
  var X = function (v) { return L + (W - L - R) * v / mx; }, Y = function (v) { return H - B - (H - T - B) * v / mx; };
  var g = '<line x1="' + X(0) + '" y1="' + Y(0) + '" x2="' + X(mx) + '" y2="' + Y(mx) + '" stroke="#9aa7ba" stroke-dasharray="4 3"/><text x="' + (W - 60) + '" y="' + (Y(mx) + 14) + '">actual = expected</text>';
  [0, .25, .5, .75, 1].forEach(function (k) { g += '<text x="' + (L - 4) + '" y="' + (Y(mx * k) + 3) + '" text-anchor="end">' + Math.round(mx * k) + '</text><text x="' + X(mx * k) + '" y="' + (H - 8) + '" text-anchor="middle">' + Math.round(mx * k) + '</text>'; });
  g += '<text x="' + (W / 2) + '" y="' + (H - 0) + '" text-anchor="middle">expected minutes</text><text x="2" y="12">actual min</text>';
  return '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '">' + g + pts.map(function (p) { return '<circle cx="' + X(p.x) + '" cy="' + Y(p.y) + '" r="3.5" fill="' + (p.y > p.x * 1.25 ? '#c62828' : '#1f5fbf') + '" opacity=".75"><title>' + esc(p.id + ' ' + (p.department || '')) + '</title></circle>'; }).join('') + '</svg>' +
    '<div class="legendrow"><span><i style="background:#c62828"></i>overran by &gt;25%</span><span><i style="background:#1f5fbf"></i>within 25%</span></div>';
}
function timelineChart(o) { // o.t[], o.keys[] (string|null) -> colored segments, one row
  var t = o.t || []; if (!t.length) return '<div class="muted small">No data yet</div>';
  var W = 620, H = o.height || 46, L = 8, colors = {}, ci = 0, W2 = W - L - 8, n = t.length, seg = '', labels = '';
  o.keys.forEach(function (k) { if (k && !colors[k]) colors[k] = o.colorMap && o.colorMap[k] || PALETTE[(ci++) % 8]; });
  for (var i = 0; i < n; i++) { var k = o.keys[i]; var x = L + W2 * i / n, w = W2 / n + .5; seg += '<rect x="' + x + '" y="6" width="' + w + '" height="22" fill="' + (k ? colors[k] : '#e8ecf2') + '"><title>' + esc((o.labels ? o.labels[i] : t[i]) + ' ' + (k || 'none')) + '</title></rect>'; }
  var step = Math.max(1, Math.floor(n / 6)); for (var j = 0; j < n; j += step) labels += '<text x="' + (L + W2 * j / n) + '" y="' + (H - 4) + '">' + esc(o.labels ? o.labels[j] : t[j]) + '</text>';
  var lg = Object.keys(colors).map(function (k) { return {name: (o.names && o.names[k]) || k, color: colors[k]}; });
  return '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '">' + seg + labels + '</svg>' + (lg.length ? legend(lg) : '');
}
