import { RESOURCE_KEYS, type SimulationOutput } from "./simulation/types";

function cell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  let s = String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const CSV_COLUMNS = [
  "patient_id",
  "condition",
  "urgency",
  "arrival_time",
  "start_time",
  "end_time",
  "wait_time",
  "treatment_time",
  "status",
  "priority_score",
  "emergency",
  "appointment",
  "ambulance_alert",
  "resources",
  "binding_resource",
  "blocked_minutes",
] as const;

export function outcomesToCsv(output: SimulationOutput): string {
  const lines = [CSV_COLUMNS.join(",")];
  for (const p of output.patients) {
    const resources = RESOURCE_KEYS.filter((k) => p.required_resources[k])
      .map((k) => `${k}:${p.required_resources[k]}`)
      .join(" ");
    lines.push(
      [
        p.id,
        p.condition,
        p.urgency,
        p.arrival_time,
        p.start_time,
        p.end_time,
        p.wait_time,
        p.treatment_time,
        p.status,
        Math.round(p.priority_score * 100) / 100,
        p.emergency,
        p.appointment,
        p.alert_time,
        resources,
        p.decision?.binding_resource ?? "",
        p.decision?.blocked_minutes ?? "",
      ]
        .map(cell)
        .join(","),
    );
  }
  return lines.join("\n") + "\n";
}

export function downloadCsv(filename: string, csv: string): void {
  // The byte-order mark makes Excel read the file as UTF-8.
  const url = URL.createObjectURL(new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
