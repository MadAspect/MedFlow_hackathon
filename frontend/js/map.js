/* Hospital map: zones laid out as a floor plan, beds as clickable tiles. */
function bedTile(b) {
  var p = b.patient, cls = b.status + (p ? ' ' + (p.category || '') : '');
  var inner = '<b>' + esc(b.id) + '</b>';
  if (p) inner += esc(p.id) + '<span class="dot ' + (p.category || '') + '"></span>';
  else if (b.status === 'cleaning') inner += 'cleaning';
  else if (b.status === 'unavailable') inner += 'out of service';
  else inner += 'free';
  return '<div class="bed ' + cls + '" title="' + esc(b.type) + '" onclick="A.bed(\'' + b.id + '\')">' + inner + (b.temporary ? '<br><span class="small">temp</span>' : '') + '</div>';
}
function zoneBox(z) {
  var occ = z.beds.filter(function (b) { return b.status === 'occupied' || b.status === 'reserved'; }).length, oper = z.beds.filter(function (b) { return b.status !== 'unavailable'; }).length;
  var staff = z.staff.filter(function (s) { return s.role === 'nurse'; }).length + 'N / ' + z.staff.filter(function (s) { return s.role === 'doctor'; }).length + 'D';
  return '<div class="zone"><h4><span>' + esc(z.label) + '</span><span class="muted small">' + occ + '/' + oper + ' beds - staff here: ' + staff + '</span></h4><div class="beds">' + z.beds.map(bedTile).join('') + '</div></div>';
}
function mapHtml(m) {
  var Z = {}; m.zones.forEach(function (z) { Z[z.id] = z; });
  var legend = '<div class="legend"><span><i style="background:var(--bed-free);border-color:var(--bed-free-b)"></i>available</span><span><i style="background:var(--bed-occ);border-color:var(--bed-occ-b)"></i>occupied</span>' +
    '<span><i style="background:var(--bed-res);border-color:#a58ad6"></i>reserved (staff en route)</span><span><i style="background:var(--bed-clean);border-color:#b8c0cc"></i>cleaning</span><span><i style="background:#cfd3da;border-color:#8b93a1"></i>unavailable</span>' +
    '<span><i style="background:#fff;border-color:var(--crit)"></i>critical patient</span></div>';
  var body = '<div class="hmap">' + zoneBox(Z.ICU) + zoneBox(Z.OR) + zoneBox(Z.EMERGENCY) +
    '<div class="zone hub"><h4 style="justify-content:center">Central corridor - staff in transit: ' + esc(Z.HUB.staff.map(function (s) { return s.id; }).join(', ') || 'none') + '</h4></div>' +
    zoneBox(Z.WARD_A) + zoneBox(Z.WARD_B) + zoneBox(Z.WARD_C) + '</div>';
  var wait = '<div class="panel" style="margin-top:12px"><h3>Waiting for a bed (' + m.waiting.length + ')</h3>' + table(['Patient', 'Urg', 'Needs', 'Waiting', 'Presentation'],
    m.waiting.slice(0, 12).map(function (w) { return '<tr class="click" onclick="A.patient(\'' + w.id + '\')"><td>' + esc(w.id) + ' ' + esc(w.name) + '</td><td>' + uBadge(w.urgency) + '</td><td>' + esc(w.bed_type.replace('_', ' ')) + '</td><td>' + f1(w.wait) + ' min</td><td>' + esc(w.diagnosis) + '</td></tr>'; })) + '</div>';
  return legend + body + wait;
}
function bedDrawer(b) {
  var p = b.patient, h = '<h3>BED ' + esc(b.id) + ' <span class="muted small">' + esc(b.type.replace('_', ' ')) + ' - ' + esc(zoneName(b.zone)) + '</span></h3>' + tag(b.status);
  if (p) {
    h += '<div class="kv" style="margin-top:12px"><div>Patient</div><div>' + esc(p.id) + ' - ' + esc(p.name) + ' (' + p.age + ')</div><div>Urgency</div><div>' + uBadge(p.urgency) + ' ' + esc(p.category) + '</div>' +
      '<div>Doctor</div><div>' + esc(b.doctor || '-') + '</div><div>Nurse(s)</div><div>' + esc((b.nurses || []).join(', ') || '-') + '</div><div>Treatment</div><div>' + esc(p.treatment) + '</div>' +
      '<div>Status</div><div>' + tag(p.status) + '</div><div>Expected completion</div><div>' + esc(p.expected_completion || '-') + '</div></div>';
  } else if (b.status === 'cleaning') h += '<p>Cleaning until ' + esc(b.cleaning_until_clock) + '.</p>';
  else if (b.status === 'unavailable') h += '<p>Out of service: ' + esc(b.unavailable_reason) + '</p>';
  else h += '<p class="muted">Available for a compatible patient.</p>';
  return h;
}
