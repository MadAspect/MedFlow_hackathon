"use client";

import { Activity, BedDouble, Clock, Gauge, HeartPulse, Hourglass, Siren, Stethoscope, Timer, Users, type LucideIcon } from "lucide-react";
import { Badge, EmptyState, cx, fmt1, pct0 } from "./ui";

const KPI_ICONS: Record<string, LucideIcon> = {
  "Patients treated": Users,
  "Actual completion time": Clock,
  "Average waiting time": Timer,
  "Maximum waiting time": Hourglass,
  "Critical-patient waiting": HeartPulse,
  "Doctor utilization": Stethoscope,
  "Nurse utilization": Stethoscope,
  "Bed utilization": BedDouble,
  "ICU utilization": BedDouble,
  "Operating-room utilization": Activity,
  "Bottleneck resource": Gauge,
  "Patients still waiting": Siren,
};
import { PLACEHOLDER_NOTICE, RESOURCE_LABELS, statusCounts, type SimulationOutput } from "@/lib/simulation";

export function CompletionBadge({ output }: { output: SimulationOutput }) {
  return output.completed ? (
    <Badge tone="green">Completed — all patients treated</Badge>
  ) : (
    <Badge tone="red">Simulation error — not all patients were treated</Badge>
  );
}

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
  const top = m.bottlenecks[0];
  return [
    { label: "Patients treated", value: String(m.patients_treated), sub: `of ${m.total_patients}` },
    {
      label: "Actual completion time",
      value: `${m.actual_completion_time} min`,
      sub: `planned duration ${m.configured_duration} min`,
      alert: !output.completed,
    },
    { label: "Average waiting time", value: `${fmt1(m.average_wait)} min` },
    { label: "Maximum waiting time", value: `${m.maximum_wait} min`, alert: m.maximum_wait > output.params.safetyThreshold },
    { label: "Critical-patient waiting", value: `${fmt1(m.critical_wait)} min`, sub: `urgency ≥ ${output.params.criticalUrgency}` },
    { label: "Doctor utilization", value: pct0(u.doctor), alert: u.doctor >= 0.9 },
    { label: "Nurse utilization", value: pct0(u.nurse), alert: u.nurse >= 0.9 },
    { label: "Bed utilization", value: pct0(u.bed), alert: u.bed >= 0.9 },
    { label: "ICU utilization", value: pct0(u.icu_bed), alert: u.icu_bed >= 0.9 },
    { label: "Operating-room utilization", value: pct0(u.operating_room), alert: u.operating_room >= 0.9 },
    {
      label: "Bottleneck resource",
      value: top ? RESOURCE_LABELS[top.resource] : "None",
      sub: top
        ? `${top.blocked_patients ?? 0} patients blocked · ${top.blocked_patient_minutes} patient-min waiting · ${pct0(u[top.resource])} utilized`
        : "no patient waited for a resource",
    },
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
      {!output.isPlaceholder && (
        <p className="mb-3 flex flex-wrap items-center gap-2 text-sm" role="status">
          <CompletionBadge output={output} />
          {!output.completed && output.error && <span className="text-red-800">{output.error}</span>}
        </p>
      )}
      <div className="stagger grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {kpisFor(output).map((k, i) => {
          const Icon = KPI_ICONS[k.label] ?? Activity;
          return (
          <div
            key={k.label}
            style={{ ["--i" as string]: i }}
            className={cx(
              "lift relative overflow-hidden rounded-xl border bg-white/90 p-3 pl-4 shadow-sm shadow-slate-900/5",
              k.alert ? "border-amber-400" : "border-slate-200/80",
            )}
          >
            <span aria-hidden className={cx("absolute inset-y-0 left-0 w-1", k.alert ? "bg-amber-500" : "bg-gradient-to-b from-blue-600 to-sky-400")} />
            <p className="flex items-center justify-between gap-1 text-xs font-medium text-slate-600">
              <span className="flex items-center gap-1.5">
                <Icon size={14} aria-hidden className={k.alert ? "text-amber-600" : "text-blue-600"} />
                {k.label}
              </span>
              {output.isPlaceholder && <Badge tone="yellow">Placeholder</Badge>}
            </p>
            {/* key forces a short "pop" animation whenever the value changes */}
            <p key={k.value} className="mt-1 animate-pop text-2xl font-bold tabular-nums text-slate-900">
              {k.value}
            </p>
            {k.sub && <p className="text-xs text-slate-500">{k.sub}</p>}
          </div>
          );
        })}
      </div>
    </div>
  );
}
