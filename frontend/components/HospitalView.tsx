"use client";

import { AlertTriangle, Ambulance, ArrowRight, CalendarClock, Clock, Info, Siren } from "lucide-react";
import { useMemo, useState } from "react";
import { PatientTimeline } from "./PatientTimeline";
import { ResourceCards } from "./ResourceCards";
import { Badge, Card, EmptyState, InfoTip, cx, fmt1, type Tone } from "./ui";
import {
  RESOURCE_KEYS,
  RESOURCE_LABELS,
  AMBULANCE_GRACE,
  APPOINTMENT_GRACE,
  STRATEGY_LABELS,
  isInbound,
  slotLabel,
  stageAt,
  type FlowStage,
  type PatientOutcome,
  type ResourceSet,
  type SimulationOutput,
  type SimWarning,
} from "@/lib/simulation";
import type { StaffMember } from "@/lib/staff";
import { doctorWorkloads, type StockLine } from "@/lib/workload";

export function WarningsList({ warnings }: { warnings: SimWarning[] }) {
  if (warnings.length === 0) return <p className="text-sm text-slate-500">No warnings or bottlenecks in this run.</p>;
  return (
    <ul className="space-y-2">
      {warnings.map((w) => (
        <li
          key={w.code + (w.time ?? "")}
          className={cx(
            "flex items-start gap-2.5 rounded-lg border px-3.5 py-2.5 text-sm",
            w.level === "critical" && "border-red-200 bg-red-50 text-red-900",
            w.level === "warning" && "border-amber-200 bg-amber-50 text-amber-900",
            w.level === "info" && "border-blue-200 bg-blue-50 text-blue-900",
          )}
        >
          {w.level === "critical" ? <Siren size={16} aria-hidden className="mt-0.5 shrink-0" /> : w.level === "warning" ? <AlertTriangle size={16} aria-hidden className="mt-0.5 shrink-0" /> : <Info size={16} aria-hidden className="mt-0.5 shrink-0" />}
          <span>
            <span className="sr-only">{w.level}: </span>
            {w.message}
          </span>
        </li>
      ))}
    </ul>
  );
}

function resourceText(p: PatientOutcome) {
  return RESOURCE_KEYS.filter((k) => p.required_resources[k])
    .map((k) => `${RESOURCE_LABELS[k]} ×${p.required_resources[k]}`)
    .join(", ");
}

function StockChip({ line }: { line: StockLine }) {
  const equipment = line.item_type === "equipment";
  return (
    <Badge tone={line.left === 0 ? "red" : "grey"}>
      {line.name} ×{line.quantity} · {equipment ? `${line.left} of ${line.total} free` : `${line.left} of ${line.total} left`}
    </Badge>
  );
}

function DoctorsAtWork({
  output,
  staff,
  resources,
  t,
  onSelect,
}: {
  output: SimulationOutput;
  staff: StaffMember[];
  resources?: ResourceSet;
  t: number;
  onSelect: (id: string) => void;
}) {
  const doctors = doctorWorkloads(output, staff, t, resources);
  const tracked = output.params.stock !== undefined;
  const busy = doctors.filter((d) => d.state === "treating").length;
  return (
    <Card
      title="Doctors at work"
      actions={
        <span className="flex items-center gap-2 text-xs text-slate-500">
          <Badge tone={busy > 0 ? "yellow" : "grey"}>
            {busy} of {doctors.length} treating
          </Badge>
          <span className="tabular-nums">{slotLabel(t)}</span>
        </span>
      }
    >
      {doctors.length === 0 ? (
        <EmptyState>No doctors are on duty at this minute.</EmptyState>
      ) : (
        <ul className="grid gap-2 md:grid-cols-2" aria-label="What each doctor is doing">
          {doctors.map((d) => (
            <li key={d.id} className="rounded-lg border border-slate-200 bg-surface px-3 py-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-slate-900">
                  {d.name}
                  {d.detail && <span className="ml-1 font-normal text-slate-500">{d.detail}</span>}
                </span>
                <Badge tone={d.state === "treating" ? "yellow" : d.state === "free" ? "green" : "grey"}>
                  {d.state === "treating" ? "Treating" : d.state === "free" ? "Free" : "Off duty"}
                </Badge>
              </div>
              {d.tasks.map((task) => (
                <div key={task.patient.id} className="mt-2 border-t border-slate-100 pt-2">
                  <button type="button" onClick={() => onSelect(task.patient.id)} className="flex w-full items-center justify-between gap-2 text-left">
                    <span className="font-semibold text-slate-900">
                      {task.patient.id} <span className="font-normal text-slate-600">{task.patient.condition}</span>
                    </span>
                    <span className="flex items-center gap-1.5">
                      <Badge tone={task.patient.urgency >= 4 ? "red" : task.patient.urgency === 3 ? "yellow" : "grey"}>U{task.patient.urgency}</Badge>
                      <span className="tabular-nums text-slate-500">{task.minutes_left} min left</span>
                    </span>
                  </button>
                  <p className="mt-1 text-slate-500">Using: {resourceText(task.patient)}</p>
                  {!tracked ? (
                    <p className="mt-1 text-slate-400">Stock is not tracked in this run.</p>
                  ) : task.stock.length === 0 ? (
                    <p className="mt-1 text-slate-400">No medicines or equipment requested.</p>
                  ) : (
                    <ul className="mt-1.5 flex flex-wrap gap-1.5" aria-label={`Stock used for ${task.patient.id}`}>
                      {task.stock.map((line) => (
                        <li key={`${line.item_type}:${line.item_id}`}>
                          <StockChip line={line} />
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-xs text-slate-500">
        Medicine counts drop when a treatment starts and stay down; equipment is held until the treatment ends. Which doctor has which patient is a display assignment: the engine schedules doctors as a pool.
      </p>
    </Card>
  );
}

export function HospitalView({
  output,
  viewTime,
  setViewTime,
  staff = [],
  resources,
}: {
  output: SimulationOutput | null;
  viewTime: number;
  setViewTime: (t: number) => void;
  staff?: StaffMember[];
  /** Headcount from the Resources page; the run's own resources already have unavailable staff taken off. */
  resources?: ResourceSet;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // The timeline covers the whole run: the planned duration or, if patients were
  // still waiting then, every minute up to the actual completion time.
  const lastT = output ? Math.max(0, output.timeline.length - 1) : 0;
  const t = Math.max(0, Math.min(lastT, viewTime));
  const point = output?.timeline[t];

  const flow = useMemo(() => {
    const columns: Record<FlowStage, PatientOutcome[]> = { not_arrived: [], waiting: [], in_treatment: [], treated: [] };
    if (!output) return columns;
    for (const p of output.patients) columns[stageAt(p, t)].push(p);
    columns.waiting.sort((a, b) => a.arrival_time - b.arrival_time);
    columns.in_treatment.sort((a, b) => (a.start_time ?? 0) - (b.start_time ?? 0));
    columns.treated.sort((a, b) => (b.end_time ?? 0) - (a.end_time ?? 0));
    return columns;
  }, [output, t]);

  if (!output || !point) return <EmptyState>Run a simulation to see the hospital.</EmptyState>;

  const { params } = output;
  const hasAmbulances = output.patients.some((p) => p.ambulance);
  const inbound = output.patients.filter((p) => isInbound(p, t)).sort((a, b) => a.arrival_time - b.arrival_time || a.id.localeCompare(b.id));
  const selected =
    output.patients.find((p) => p.id === selectedId) ?? flow.in_treatment[0] ?? flow.waiting[0] ?? output.patients[0] ?? null;

  const saturated = RESOURCE_KEYS.filter((k) => point.capacity[k] > 0 && point.in_use[k] / point.capacity[k] >= 0.9);
  const isCritical = (p: PatientOutcome) => p.urgency >= params.criticalUrgency;

  const chip = (p: PatientOutcome, stage: FlowStage) => {
    const waited = stage === "waiting" ? t - p.arrival_time : p.wait_time;
    const critical = stage === "waiting" && isCritical(p);
    const overdue = stage === "waiting" && waited > params.safetyThreshold;
    const apptLate = p.appointment && stage === "waiting" && waited > APPOINTMENT_GRACE;
    const ambLate = p.ambulance === true && stage === "waiting" && waited > AMBULANCE_GRACE;
    return (
      <li key={p.id}>
        <button
          type="button"
          onClick={() => setSelectedId(p.id)}
          aria-pressed={selected?.id === p.id}
          className={cx(
            "flex w-full items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-left text-xs transition-colors",
            critical ? "border-red-200 bg-red-50" : overdue || apptLate || ambLate ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-surface hover:bg-slate-50",
            selected?.id === p.id && "ring-2 ring-blue-500/60",
          )}
        >
          <span className="font-semibold text-slate-900">
            {p.id}
            {p.emergency && <span className="ml-1 font-normal text-amber-700">surge</span>}
          </span>
          <span className="flex flex-wrap items-center justify-end gap-1">
            {p.appointment && (
              <Badge tone={apptLate ? "yellow" : "blue"}>
                <CalendarClock size={10} aria-hidden /> {apptLate ? "Late" : "Appt"}
              </Badge>
            )}
            {p.ambulance && (
              <Badge tone={ambLate ? "yellow" : "red"}>
                <Ambulance size={10} aria-hidden /> {ambLate ? "Late" : "Amb"}
              </Badge>
            )}
            {overdue && (
              <Badge tone="yellow">
                <Clock size={10} aria-hidden /> &gt;{params.safetyThreshold}m
              </Badge>
            )}
            <Badge tone={p.urgency >= 4 ? "red" : p.urgency === 3 ? "yellow" : "grey"}>U{p.urgency}</Badge>
            <span className="w-8 text-right tabular-nums text-slate-500">{waited}m</span>
          </span>
        </button>
      </li>
    );
  };

  const columns: { stage: FlowStage; title: string; tone: Tone }[] = [
    { stage: "waiting", title: "Waiting", tone: "red" },
    { stage: "in_treatment", title: "In treatment", tone: "yellow" },
    { stage: "treated", title: "Treated", tone: "green" },
  ];

  const d = selected?.decision ?? null;
  const hz = d?.score.hazard;
  const fmtPart = (v: number) => (hz ? v.toFixed(2) : fmt1(v));
  const parts = hz
    ? [
        { label: "Base harm rate", detail: `2^(urgency${selected!.emergency ? " + emergency" : ""} − 1)`, value: hz.base_rate },
        { label: "Waiting acceleration", detail: `× (1 + ${d!.score.waiting_time}/30)²`, value: hz.wait_factor },
        { label: "Resource footprint", detail: "÷ priced resource-hours", value: hz.footprint },
      ]
    : d
    ? [
        { label: "Urgency", detail: `${params.weights.alpha} × ${selected!.urgency}`, value: d.score.urgency },
        { label: "Waiting time", detail: `${params.weights.beta} × ${d.score.waiting_time} min`, value: d.score.waiting },
        { label: "Deterioration risk", detail: `${params.weights.gamma} × ${d.score.risk_value.toFixed(2)}`, value: d.score.risk },
        { label: "Emergency", detail: `${params.weights.delta} × ${selected!.emergency ? 1 : 0}`, value: d.score.emergency },
      ]
    : [];
  const maxPart = Math.max(1, ...parts.map((p) => p.value));

  return (
    <div className="space-y-4">
      <ResourceCards total={point.capacity} inUse={point.in_use} />

      {saturated.length > 0 && (
        <div role="alert" className="animate-warn flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-900">
          <Siren size={16} aria-hidden className="mt-0.5 shrink-0" />
          <span>
            <strong>Bottleneck at {slotLabel(t)}:</strong> {saturated.map((k) => `${RESOURCE_LABELS[k]} ${point.in_use[k]}/${point.capacity[k]}`).join(", ")} in use, {flow.waiting.length} waiting.
          </span>
        </div>
      )}

      {hasAmbulances && (
        <Card
          title="Inbound ambulances"
          actions={
            <span className="flex items-center gap-2 text-xs text-slate-500">
              {params.preAlert === false ? <Badge tone="grey">Pre-alerts off</Badge> : <Badge tone="blue">Resources held for arrival</Badge>}
              <span className="tabular-nums">{slotLabel(t)}</span>
            </span>
          }
        >
          {inbound.length === 0 ? (
            <p className="text-sm text-slate-500">No ambulance is on its way at this minute.</p>
          ) : (
            <ul className="grid gap-2 md:grid-cols-2" aria-label="Ambulances on their way">
              {inbound.map((p) => {
                const alert = p.alert_time ?? p.arrival_time;
                const journey = Math.max(1, p.arrival_time - alert);
                const progress = Math.min(1, Math.max(0, (t - alert) / journey));
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(p.id)}
                      aria-pressed={selected?.id === p.id}
                      className={cx("w-full rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-left text-xs", selected?.id === p.id && "ring-2 ring-blue-500/60")}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-1.5 font-semibold text-slate-900">
                          <Ambulance size={14} aria-hidden className="text-red-600" /> {p.id}
                          <span className="font-normal text-slate-600">{p.condition}</span>
                        </span>
                        <span className="flex items-center gap-1.5">
                          <Badge tone={p.urgency >= 4 ? "red" : p.urgency === 3 ? "yellow" : "grey"}>U{p.urgency}</Badge>
                          <span className="font-semibold tabular-nums text-red-800">arrives in {p.arrival_time - t} min</span>
                        </span>
                      </span>
                      <span className="mt-1.5 block h-1.5 rounded-full bg-red-100" aria-hidden>
                        <span className="block h-full rounded-full bg-red-500 transition-[width] duration-300" style={{ width: `${progress * 100}%` }} />
                      </span>
                      <span className="mt-1 block text-slate-600">
                        Warned at {slotLabel(alert)}, due {slotLabel(p.arrival_time)}
                        {params.preAlert === false ? "" : ` · holding ${resourceText(p)}`}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      )}

      <Card
        title="Patient flow"
        actions={
          <span className="flex items-center gap-2 text-xs text-slate-500">
            {STRATEGY_LABELS[output.strategy]}
            {params.emergencySurge && t >= params.surgeStart && <Badge tone="yellow">Surge active</Badge>}
            {params.resourceFailure && t >= params.failureStart && <Badge tone="red">{RESOURCE_LABELS[params.failedResource]} failure</Badge>}
            {flow.not_arrived.length > 0 && <span>{flow.not_arrived.length} not yet arrived</span>}
          </span>
        }
      >
        <div className="grid gap-4 md:grid-cols-3">
          {columns.map(({ stage, title, tone }, i) => (
            <div key={stage} className="min-w-0">
              <h3 className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-slate-700">
                {i > 0 && <ArrowRight size={13} aria-hidden className="text-slate-300" />}
                {title} <Badge tone={tone}>{flow[stage].length}</Badge>
              </h3>
              <ul className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
                {flow[stage].length === 0 ? <li className="text-xs text-slate-400">None</li> : flow[stage].map((p) => chip(p, stage))}
              </ul>
            </div>
          ))}
        </div>
      </Card>

      <PatientTimeline output={output} viewTime={t} setViewTime={setViewTime} selectedId={selected?.id ?? null} onSelect={setSelectedId} />

      <DoctorsAtWork output={output} staff={staff} resources={resources} t={t} onSelect={setSelectedId} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Being treated now" actions={<span className="text-xs text-slate-500 tabular-nums">{slotLabel(t)}</span>}>
          {flow.in_treatment.length === 0 ? (
            <EmptyState>Nobody is in treatment at this minute.</EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[480px] text-left text-xs">
                <thead className="border-b border-slate-200 text-slate-500">
                  <tr>
                    {["Patient", "Condition", "Urg.", "Resources", "Start", "Done"].map((h) => (
                      <th key={h} scope="col" className="px-1.5 py-1.5 font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {flow.in_treatment.map((p) => (
                    <tr key={p.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setSelectedId(p.id)}>
                      <th scope="row" className="px-1.5 py-1.5 font-semibold">{p.id}</th>
                      <td className="px-1.5 py-1.5">{p.condition}</td>
                      <td className="px-1.5 py-1.5">{p.urgency}</td>
                      <td className="px-1.5 py-1.5">{resourceText(p)}</td>
                      <td className="px-1.5 py-1.5 tabular-nums">{p.start_time}</td>
                      <td className="px-1.5 py-1.5 tabular-nums">{p.end_time}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card
          title={selected ? `Why ${selected.id}?` : "Decision"}
          actions={<InfoTip align="right">Computed by the scheduling engine from the numbers below. No AI model is involved.</InfoTip>}
        >
          {!selected ? (
            <EmptyState>Select a patient to see the decision.</EmptyState>
          ) : d ? (
            <div className="space-y-3 text-sm">
              <p className="text-slate-600">
                Chosen at <strong className="text-slate-900">{slotLabel(d.time)}</strong> from {d.queue_length} queued patient{d.queue_length === 1 ? "" : "s"}.
              </p>
              {selected.appointment && (
                <p
                  className={cx(
                    "rounded-lg border px-3 py-2 text-xs",
                    selected.wait_time <= APPOINTMENT_GRACE ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-amber-200 bg-amber-50 text-amber-900",
                  )}
                >
                  <strong>Appointment at {slotLabel(selected.arrival_time)}.</strong>{" "}
                  {selected.wait_time === 0
                    ? "Started on time."
                    : selected.wait_time <= APPOINTMENT_GRACE
                      ? `Started ${selected.wait_time} min after its slot, within the ${APPOINTMENT_GRACE}-minute limit.`
                      : `Started ${selected.wait_time} min after its slot: the resources were held by patients who could not be interrupted.`}
                </p>
              )}
              {selected.ambulance && selected.alert_time != null && (
                <p
                  className={cx(
                    "rounded-lg border px-3 py-2 text-xs",
                    selected.wait_time <= AMBULANCE_GRACE ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-amber-200 bg-amber-50 text-amber-900",
                  )}
                >
                  <strong>
                    Ambulance: warned at {slotLabel(selected.alert_time)}, arrived {slotLabel(selected.arrival_time)}.
                  </strong>{" "}
                  {selected.wait_time === 0
                    ? "Received on arrival."
                    : selected.wait_time <= AMBULANCE_GRACE
                      ? `Started ${selected.wait_time} min after arriving, within the ${AMBULANCE_GRACE}-minute limit.`
                      : `Started ${selected.wait_time} min after arriving: the resources it needed were held by patients who could not be interrupted.`}
                </p>
              )}
              {d.appointment_hold && (
                <p className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900">
                  Held back {d.appointment_hold.minutes} min so{" "}
                  {d.appointment_hold.kind === "ambulance" ? "the inbound ambulance patient" : "appointment"} <strong>{d.appointment_hold.appointment_id}</strong>{" "}
                  could {d.appointment_hold.kind === "ambulance" ? "be received on arrival" : "start on time"}.
                </p>
              )}
              {output.strategy !== "dynamic" && output.strategy !== "hazard" && (
                <p className="text-xs text-slate-500">
                  This run orders the queue by {output.strategy === "fcfs" ? "arrival time" : "urgency"}. The score below is for reference.
                </p>
              )}
              <ul className="space-y-2">
                {parts.map((p) => (
                  <li key={p.label}>
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-700">
                        {p.label} <span className="text-slate-400">{p.detail}</span>
                      </span>
                      <span className="font-semibold tabular-nums">{fmtPart(p.value)}</span>
                    </div>
                    <div className="mt-1 h-1.5 rounded-full bg-slate-100">
                      <div className="h-full rounded-full bg-blue-500 transition-[width] duration-300" style={{ width: `${(p.value / maxPart) * 100}%` }} />
                    </div>
                  </li>
                ))}
                <li className="flex justify-between border-t border-slate-100 pt-2 font-semibold">
                  <span>{hz ? "Harm-density index" : "Priority score"}</span>
                  <span className="tabular-nums">{fmtPart(d.score.total)}</span>
                </li>
              </ul>
              <ul className="flex flex-wrap gap-1.5">
                {RESOURCE_KEYS.filter((k) => d.required[k]).map((k) => (
                  <li key={k}>
                    <Badge tone="green">
                      {RESOURCE_LABELS[k]}: needed {d.required[k]}, {d.available_before[k]} free
                    </Badge>
                  </li>
                ))}
              </ul>
              {(d.blocked_minutes ?? 0) > 0 && d.binding_resource && (
                <p className="text-xs text-slate-500">
                  Waited {d.blocked_minutes} min for {RESOURCE_LABELS[d.binding_resource].toLowerCase()}.
                </p>
              )}
              {d.stock_used && d.stock_used.length > 0 && (
                <p className="text-xs text-slate-500">
                  Took from stock:{" "}
                  {d.stock_used
                    .map((r) => `${output?.params.stock?.[r.item_type === "medicine" ? "medicines" : "equipment"][r.item_id]?.name ?? r.item_id} ×${r.quantity}`)
                    .join(", ")}
                  .
                </p>
              )}
              {d.stock_blocked?.map((b) => (
                <p key={`${b.item_type}:${b.item_id}`} className="text-xs text-amber-700">
                  Waited {b.minutes} min for {b.name} to be in stock.
                </p>
              ))}
              {d.skipped.length > 0 && (
                <p className="text-xs text-slate-500">
                  Skipped because resources or stock were short:{" "}
                  {d.skipped
                    .map((s) => `${s.id} (${[...s.blocked_by.map((k) => RESOURCE_LABELS[k]), ...(s.stock_blocked_by ?? [])].join(", ")})`)
                    .join("; ")}
                  .
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-slate-600">
              <strong className="text-slate-900">{selected.id}</strong> was never started in this run
              {selected.status === "not_arrived" ? " (arrives after the simulation ends)." : `: the resources it needs (${resourceText(selected)}) were not available. It had waited ${selected.wait_time} min when the run ended.`}
            </p>
          )}
        </Card>
      </div>
    </div>
  );
}
