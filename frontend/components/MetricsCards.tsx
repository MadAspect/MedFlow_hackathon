"use client";

import { Ambulance, CalendarClock, Gauge } from "lucide-react";
import { Badge, Card, EmptyState, ProgressBar, Stat, fmt1, pct0, type Tone } from "./ui";
import {
  AMBULANCE_GRACE,
  APPOINTMENT_GRACE,
  PLACEHOLDER_NOTICE,
  RESOURCE_KEYS,
  RESOURCE_LABELS,
  resourceStatus,
  statusCounts,
  type SimulationOutput,
} from "@/lib/simulation";

export function CompletionBadge({ output }: { output: SimulationOutput }) {
  return output.completed ? (
    <Badge tone="green">All patients treated</Badge>
  ) : (
    <Badge tone="red">Simulation error: not all patients were treated</Badge>
  );
}

const STATUS_TONE: Record<ReturnType<typeof resourceStatus>, Tone> = { ok: "green", warning: "yellow", critical: "red" };

export function MetricsCards({ output }: { output: SimulationOutput | null }) {
  if (!output) return <EmptyState>Run a simulation to see results.</EmptyState>;

  const m = output.metrics;
  const counts = statusCounts(output.patients);
  const stillWaiting = counts.waiting + counts.critical_waiting;
  const u = m.resource_utilization;
  const top = m.bottlenecks[0];
  const booked = m.appointments_total ?? 0;
  const onTime = m.appointments_on_time ?? 0;

  return (
    <div className="space-y-4">
      {output.isPlaceholder && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-sm font-medium text-amber-900" role="status">
          {PLACEHOLDER_NOTICE}
        </p>
      )}
      {!output.isPlaceholder && (
        <p className="flex flex-wrap items-center gap-2 text-sm" role="status">
          <CompletionBadge output={output} />
          {!output.completed && output.error && <span className="text-red-700">{output.error}</span>}
        </p>
      )}

      <div className="stagger grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          <Stat key="treated" label="Patients treated" value={`${m.patients_treated}`} sub={`of ${m.total_patients} · finished at minute ${m.actual_completion_time}`} tone={output.completed ? undefined : "red"} />,
          <Stat key="avg" label="Average wait" value={`${fmt1(m.average_wait)} min`} sub={stillWaiting > 0 ? `${stillWaiting} still waiting` : "everyone was treated"} />,
          <Stat key="max" label="Longest wait" value={`${m.maximum_wait} min`} sub={`safety limit ${output.params.safetyThreshold} min`} tone={m.maximum_wait > output.params.safetyThreshold ? "yellow" : undefined} />,
          <Stat key="crit" label="Critical patients" value={`${fmt1(m.critical_wait)} min`} sub={`average wait, urgency ≥ ${output.params.criticalUrgency}`} tone={counts.critical_waiting > 0 ? "red" : undefined} />,
        ].map((card, i) => (
          <div key={i} style={{ ["--i" as string]: i }}>
            {card}
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Resource utilization" className="lg:col-span-2" actions={<span className="text-xs text-slate-500">share of capacity used over the run</span>}>
          <ul className="space-y-3">
            {RESOURCE_KEYS.map((k) => (
              <li key={k} className="grid grid-cols-[8.5rem_1fr_3rem] items-center gap-3 text-sm">
                <span className="text-slate-700">{RESOURCE_LABELS[k]}</span>
                <ProgressBar value={u[k]} tone={output.resources[k] > 0 ? STATUS_TONE[resourceStatus(u[k])] : "grey"} label={`${RESOURCE_LABELS[k]} utilization`} />
                <span className="text-right font-medium tabular-nums text-slate-900">{output.resources[k] > 0 ? pct0(u[k]) : "–"}</span>
              </li>
            ))}
          </ul>
        </Card>

        <div className="grid gap-3">
          {booked > 0 && (
            <Stat
              icon={<CalendarClock size={13} aria-hidden />}
              label="Appointments on time"
              value={`${onTime} of ${booked}`}
              tone={onTime < booked ? "yellow" : "green"}
              sub={`started within ${APPOINTMENT_GRACE} min of the slot · worst ${m.appointment_max_delay ?? 0} min · walk-ins waited ${fmt1(m.walk_in_average_wait ?? 0)} min`}
            />
          )}
          {(m.ambulance_total ?? 0) > 0 && (
            <Stat
              icon={<Ambulance size={13} aria-hidden />}
              label="Ambulances received on arrival"
              value={`${m.ambulance_on_arrival ?? 0} of ${m.ambulance_total}`}
              tone={(m.ambulance_on_arrival ?? 0) < (m.ambulance_total ?? 0) ? "yellow" : "green"}
              sub={`started within ${AMBULANCE_GRACE} min of arriving · worst wait ${m.ambulance_max_wait ?? 0} min · ${fmt1(m.ambulance_average_lead ?? 0)} min warning on average`}
            />
          )}
          <Stat
            icon={<Gauge size={13} aria-hidden />}
            label="Bottleneck"
            value={top ? RESOURCE_LABELS[top.resource] : "None"}
            sub={top ? `${top.blocked_patients ?? 0} patients blocked · ${top.blocked_patient_minutes} patient-min waiting` : "no patient waited for a resource"}
          />
        </div>
      </div>
    </div>
  );
}
