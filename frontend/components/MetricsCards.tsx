"use client";

import { Badge, EmptyState, cx, fmt1, pct0 } from "./ui";
import { PLACEHOLDER_NOTICE, statusCounts, type SimulationOutput } from "@/lib/simulation";

interface Kpi {
  label: string;
  value: string;
  sub?: string;
  alert?: boolean;
}

export function kpisFor(output: SimulationOutput): Kpi[] {
  const m = output.metrics;
  const counts = statusCounts(output.patients);
  const waiting = counts.waiting + counts.critical_waiting;
  const u = m.resource_utilization;
  return [
    { label: "Patients treated", value: String(m.patients_treated), sub: `of ${m.total_patients}` },
    { label: "Average waiting time", value: `${fmt1(m.average_wait)} min` },
    { label: "Maximum waiting time", value: `${m.maximum_wait} min`, alert: m.maximum_wait > output.params.safetyThreshold },
    { label: "Critical-patient waiting", value: `${fmt1(m.critical_wait)} min`, sub: `urgency ≥ ${output.params.criticalUrgency}` },
    { label: "Doctor utilization", value: pct0(u.doctor), alert: u.doctor >= 0.9 },
    { label: "Nurse utilization", value: pct0(u.nurse), alert: u.nurse >= 0.9 },
    { label: "Bed utilization", value: pct0(u.bed), alert: u.bed >= 0.9 },
    { label: "ICU utilization", value: pct0(u.icu_bed), alert: u.icu_bed >= 0.9 },
    { label: "Patients still waiting", value: String(waiting), sub: `${counts.critical_waiting} critical · ${m.patients_remaining} not treated`, alert: counts.critical_waiting > 0 },
  ];
}

export function MetricsCards({ output }: { output: SimulationOutput | null }) {
  if (!output) return <EmptyState>No simulation results available.</EmptyState>;
  return (
    <div>
      {output.isPlaceholder && (
        <p className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900" role="status">
          {PLACEHOLDER_NOTICE}
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {kpisFor(output).map((k) => (
          <div key={k.label} className={cx("rounded-lg border bg-white p-3 shadow-sm", k.alert ? "border-amber-400" : "border-slate-200")}>
            <p className="flex items-center justify-between gap-1 text-xs font-medium text-slate-600">
              {k.label}
              {output.isPlaceholder && <Badge tone="yellow">Placeholder</Badge>}
            </p>
            {/* key forces a short "pop" animation whenever the value changes */}
            <p key={k.value} className="mt-1 animate-pop text-2xl font-bold tabular-nums text-slate-900">
              {k.value}
            </p>
            {k.sub && <p className="text-xs text-slate-500">{k.sub}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}
