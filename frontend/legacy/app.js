async function simulate() {
  const error = document.getElementById("error");
  error.textContent = "";
  const scenario = document.getElementById("scenario").value;

  try {
    const response = await fetch("/api/simulate", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({scenario})
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Simulation failed");
    render(data);
  } catch (e) {
    error.textContent = e.message;
  }
}

function render(data) {
  const s = data.statistics;
  document.getElementById("summary").innerHTML = `
    <div class="card"><div class="label">Patients</div><div class="value">${s.patients_total}</div></div>
    <div class="card"><div class="label">Treated</div><div class="value">${s.patients_treated}</div></div>
    <div class="card"><div class="label">Average wait</div><div class="value">${s.average_wait}m</div></div>
    <div class="card"><div class="label">Max wait</div><div class="value">${s.maximum_wait}m</div></div>
  `;

  document.getElementById("resources").innerHTML = Object.entries(s.resource_utilization)
    .map(([name, value]) => `
      <div class="bar">
        <div class="bar-top"><span>${name.replaceAll("_"," ")}</span><b>${Math.round(value*100)}%</b></div>
        <div class="track"><div class="fill" style="width:${value*100}%"></div></div>
      </div>
    `).join("");

  const o = data.optimization;
  document.getElementById("optimization").innerHTML = o.changed
    ? `<div class="recommend">${o.recommendation}</div>
       <div class="muted">Average wait: ${o.baseline.average_wait}m → ${o.optimized.average_wait}m</div>
       <div class="muted">Untreated: ${o.baseline.patients_unable_to_treat} → ${o.optimized.patients_unable_to_treat}</div>`
    : `<div class="recommend">No additional resource required</div>
       <div class="muted">${o.message || ""}</div>`;

  document.getElementById("scenarioInfo").textContent =
    `${data.scenario.name} • ${data.scenario.patient_count} patients`;

  document.getElementById("patients").innerHTML = data.patients.map(p => `
    <tr>
      <td>${p.id}</td>
      <td>${p.arrival_time}m</td>
      <td>${p.urgency}</td>
      <td>${p.start_time ?? "—"}</td>
      <td>${p.end_time ?? "—"}</td>
      <td>${p.wait_time ?? "—"}m</td>
      <td class="${p.status}">${p.status.replaceAll("_"," ")}</td>
    </tr>
  `).join("");
}

simulate();
