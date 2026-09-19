"use client";

import { AlertTriangle, ArrowRight, Clock, Info, Pause, Play, Siren } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { CompletionBadge } from "./MetricsCards";
import { PatientTimeline } from "./PatientTimeline";
import { ResourceCards } from "./ResourceCards";
import { Badge, Button, Card, EmptyState, cx, fmt1, type Tone } from "./ui";
import {
  RESOURCE_KEYS,
  RESOURCE_LABELS,
  STRATEGY_LABELS,
  stageAt,
  type FlowStage,
  type PatientOutcome,
  type SimulationOutput,
  type SimWarning,
} from "@/lib/simulation";

export function WarningsList({ warnings }: { warnings: SimWarning[] }) {
  if (warnings.length === 0) return <p className="text-sm text-slate-600">No warnings or bottlenecks were detected in this run.</p>;
  return (
    <ul className="space-y-2">
      {warnings.map((w) => (
        <li
          key={w.code + (w.time ?? "")}
          className={cx(
            "flex items-start gap-2 rounded-md border px-3 py-2 text-sm",
            w.level === "critical" && "border-red-300 bg-red-50 text-red-900",
            w.level === "warning" && "border-amber-300 bg-amber-50 text-amber-900",
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

export function HospitalView({
  output,
  viewTime,
  setViewTime,
}: {
  output: SimulationOutput | null;
  viewTime: number;
  setViewTime: (t: number) => void;
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

  // Playback: advance the shared clock a few minutes per tick until the end of the run.
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(2);
  const clock = useRef(t);
  useEffect(() => {
    clock.current = t;
  }, [t]);
  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => {
      const next = clock.current + speed;
      if (next >= lastT) {
        clock.current = lastT;
        setViewTime(lastT);
        setPlaying(false);
      } else {
        clock.current = next;
        setViewTime(next);
      }
    }, 120);
    return () => window.clearInterval(id);
  }, [playing, speed, lastT, setViewTime]);

  if (!output || !point) return <EmptyState>No simulation results available. Run a simulation to see the hospital state.</EmptyState>;

  const { params } = output;
  const selected =
    output.patients.find((p) => p.id === selectedId) ?? flow.in_treatment[0] ?? flow.waiting[0] ?? output.patients[0] ?? null;

  const saturated = RESOURCE_KEYS.filter((k) => point.capacity[k] > 0 && point.in_use[k] / point.capacity[k] >= 0.9);
  const isCritical = (p: PatientOutcome) => p.urgency >= params.criticalUrgency;

  const chip = (p: PatientOutcome, stage: FlowStage) => {
    const waited = stage === "waiting" ? t - p.arrival_time : p.wait_time;
    const critical = stage === "waiting" && isCritical(p);
    const overdue = stage === "waiting" && waited > params.safetyThreshold;
    return (
      <li key={p.id}>
        <button
          type="button"
          onClick={() => setSelectedId(p.id)}
          aria-pressed={selected?.id === p.id}
          className={cx(
            "flex w-full items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-left text-xs transition-colors",
            critical ? "border-red-400 bg-red-50" : overdue ? "border-amber-400 bg-amber-50" : "border-slate-200 bg-white hover:bg-slate-50",
            selected?.id === p.id && "ring-2 ring-blue-600",
          )}
        >
          <span className="font-semibold">
            {p.id}
            {p.emergency && <span className="ml-1 font-normal text-amber-700">surge</span>}
          </span>
          <span className="flex flex-wrap items-center justify-end gap-1">
            {critical && <Badge tone="red">Critical</Badge>}
            {overdue && (
              <Badge tone="yellow">
                <Clock size={10} aria-hidden className="mr-0.5" /> &gt;{params.safetyThreshold}m
              </Badge>
            )}
            <Badge tone={p.urgency >= 4 ? "red" : p.urgency === 3 ? "yellow" : "grey"}>U{p.urgency}</Badge>
            <span className="tabular-nums text-slate-500">{waited}m</span>
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
  const parts = d
    ? [
        { label: "Urgency", detail: `α · u = ${params.weights.alpha} × ${selected!.urgency}`, value: d.score.urgency },
        { label: "Waiting time", detail: `β · w = ${params.weights.beta} × ${d.score.waiting_time} min`, value: d.score.waiting },
        { label: "Deterioration risk", detail: `γ · r = ${params.weights.gamma} × ${d.score.risk_value.toFixed(2)}`, value: d.score.risk },
        { label: "Emergency priority", detail: `δ · e = ${params.weights.delta} × ${selected!.emergency ? 1 : 0}`, value: d.score.emergency },
      ]
    : [];
  const maxPart = Math.max(1, ...parts.map((p) => p.value));

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor="view-time" className="text-sm font-medium text-slate-800">
            Hospital state at minute <span className="tabular-nums">{t}</span> of {lastT}
          </label>
          <Button
            variant="secondary"
            aria-label={playing ? "Pause playback" : "Play the run"}
            onClick={() => {
              if (playing) return setPlaying(false);
              if (t >= lastT) setViewTime(0); // replay from the start
              setPlaying(true);
            }}
          >
            {playing ? <Pause size={15} aria-hidden /> : <Play size={15} aria-hidden />} {playing ? "Pause" : "Play"}
          </Button>
          <select
            aria-label="Playback speed"
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
            className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-800"
          >
            <option value={1}>Slow</option>
            <option value={2}>Normal</option>
            <option value={5}>Fast</option>
            <option value={12}>Turbo</option>
          </select>
          <input id="view-time" type="range" min={0} max={lastT} value={t} onChange={(e) => { setPlaying(false); setViewTime(Number(e.target.value)); }} className="min-w-48 flex-1 accent-blue-700" />
          <Button variant="secondary" onClick={() => setViewTime(output.metrics.peak_queue_time)}>Peak queue (min {output.metrics.peak_queue_time})</Button>
          <Button variant="secondary" onClick={() => setViewTime(lastT)}>End (min {lastT})</Button>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm" role="status">
          <CompletionBadge output={output} />
          {!output.completed && output.error && <span className="text-xs text-red-800">{output.error}</span>}
        </div>
        <dl className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4 lg:grid-cols-7">
          {[
            ["Current time", `${t} min`],
            ["Actual completion", `${output.metrics.actual_completion_time} min (planned ${output.metrics.configured_duration})`],
            ["Treated so far", `${flow.treated.length} of ${output.patients.length}`],
            ["Waiting", String(flow.waiting.length)],
            ["Active treatments", String(flow.in_treatment.length)],
            ["Available resources", RESOURCE_KEYS.filter((k) => point.capacity[k] > 0).map((k) => `${RESOURCE_LABELS[k]} ${Math.max(0, point.capacity[k] - point.in_use[k])}`).join(", ") || "none"],
            ["Current bottleneck", point.bottleneck ? RESOURCE_LABELS[point.bottleneck] : "none"],
          ].map(([label, value]) => (
            <div key={label} className="min-w-0 rounded-md border border-slate-200 px-2 py-1.5">
              <dt className="text-slate-500">{label}</dt>
              <dd className="font-semibold text-slate-900">{value}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-2 text-xs text-slate-600">
          {STRATEGY_LABELS[output.strategy]} · {flow.waiting.length} waiting · {flow.in_treatment.length} in treatment · {flow.treated.length} treated
          {flow.not_arrived.length > 0 ? ` · ${flow.not_arrived.length} not yet arrived` : ""}
          {params.emergencySurge && t >= params.surgeStart ? " · surge active" : ""}
          {params.resourceFailure && t >= params.failureStart ? ` · ${RESOURCE_LABELS[params.failedResource]} failure active` : ""}
        </p>
      </Card>

      <ResourceCards total={point.capacity} inUse={point.in_use} />

      {saturated.length > 0 && (
        <div role="alert" className="animate-warn flex items-start gap-2 rounded-md border border-red-400 bg-red-50 px-3 py-2 text-sm text-red-900">
          <Siren size={16} aria-hidden className="mt-0.5 shrink-0" />
          <span>
            <strong>Bottleneck at minute {t}:</strong> {saturated.map((k) => `${RESOURCE_LABELS[k]} ${point.in_use[k]}/${point.capacity[k]}`).join(", ")} in use with {flow.waiting.length} patient(s) waiting.
          </span>
        </div>
      )}

      <Card title="Patient flow" description="Waiting → In treatment → Treated. Select a patient to see why they were chosen.">
        <div className="grid gap-3 md:grid-cols-3">
          {columns.map(({ stage, title, tone }, i) => (
            <div key={stage} className="min-w-0">
              <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-800">
                {i > 0 && <ArrowRight size={14} aria-hidden className="text-slate-400" />}
                {title} <Badge tone={tone}>{flow[stage].length}</Badge>
              </h3>
              <ul className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
                {flow[stage].length === 0 ? <li className="text-xs text-slate-500">None</li> : flow[stage].map((p) => chip(p, stage))}
              </ul>
            </div>
          ))}
        </div>
      </Card>

      <PatientTimeline output={output} viewTime={t} setViewTime={setViewTime} selectedId={selected?.id ?? null} onSelect={setSelectedId} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Current allocations" description={`Patients being treated at minute ${t}.`}>
          {flow.in_treatment.length === 0 ? (
            <EmptyState>No patients are in treatment at this minute.</EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-left text-xs">
                <thead className="border-b border-slate-200 text-slate-600 uppercase">
                  <tr>
                    {["Patient", "Condition", "Urg.", "Score", "Resources", "Start", "Done"].map((h) => (
                      <th key={h} scope="col" className="px-1.5 py-1.5 font-semibold">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {flow.in_treatment.map((p) => (
                    <tr key={p.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setSelectedId(p.id)}>
                      <th scope="row" className="px-1.5 py-1.5 font-semibold">{p.id}</th>
                      <td className="px-1.5 py-1.5">{p.condition}</td>
                      <td className="px-1.5 py-1.5">{p.urgency}</td>
                      <td className="px-1.5 py-1.5 tabular-nums">{fmt1(p.priority_score)}</td>
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

        <Card title="Decision explanation" description="Computed by the scheduling engine — not by an AI model.">
          {!selected ? (
            <EmptyState>Select a patient to see the decision.</EmptyState>
          ) : d ? (
            <div className="space-y-3 text-sm">
              <p>
                <strong>Why {selected.id} was selected</strong> at minute {d.time} ({d.queue_length} patient{d.queue_length === 1 ? "" : "s"} were queued).
              </p>
              {output.strategy !== "dynamic" && (
                <p className="rounded-md border border-blue-200 bg-blue-50 px-2 py-1.5 text-xs text-blue-900">
                  This run used <strong>{STRATEGY_LABELS[output.strategy]}</strong>, which orders the queue by {output.strategy === "fcfs" ? "arrival time" : "urgency"}; the dynamic score below is shown for reference.
                </p>
              )}
              <ul className="space-y-1.5">
                {parts.map((p) => (
                  <li key={p.label}>
                    <div className="flex justify-between text-xs">
                      <span>
                        {p.label} <span className="text-slate-500">({p.detail})</span>
                      </span>
                      <span className="font-semibold tabular-nums">{fmt1(p.value)}</span>
                    </div>
                    <div className="h-1.5 rounded bg-slate-200">
                      <div className="h-full rounded bg-blue-600 transition-[width] duration-500" style={{ width: `${(p.value / maxPart) * 100}%` }} />
                    </div>
                  </li>
                ))}
                <li className="flex justify-between border-t border-slate-200 pt-1.5 font-semibold">
                  <span>Final priority score S</span>
                  <span className="tabular-nums">{fmt1(d.score.total)}</span>
                </li>
              </ul>
              <div>
                <p className="mb-1 text-xs font-semibold text-slate-700">Resource availability at that moment</p>
                <ul className="flex flex-wrap gap-1.5">
                  {RESOURCE_KEYS.filter((k) => d.required[k]).map((k) => (
                    <li key={k}>
                      <Badge tone="green">
                        {RESOURCE_LABELS[k]}: needed {d.required[k]}, {d.available_before[k]} free
                      </Badge>
                    </li>
                  ))}
                </ul>
              </div>
              {(d.blocked_minutes ?? 0) > 0 && d.binding_resource && (
                <p className="text-xs text-slate-700">
                  Waited {d.blocked_minutes} min while blocked; the binding resource was {RESOURCE_LABELS[d.binding_resource]}.
                </p>
              )}
              {d.skipped.length > 0 && (
                <p className="text-xs text-slate-700">
                  Higher-ranked patients skipped because resources were short:{" "}
                  {d.skipped.map((s) => `${s.id} (${s.blocked_by.map((k) => RESOURCE_LABELS[k]).join(", ")})`).join("; ")}.
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-slate-700">
              <strong>{selected.id}</strong> was never started in this run
              {selected.status === "not_arrived" ? " (arrives after the simulation ends)." : `: the resources it needs (${resourceText(selected)}) were not available when it was ranked. It had waited ${selected.wait_time} min when the run ended, with a score of ${fmt1(selected.priority_score)}.`}
            </p>
          )}
        </Card>
      </div>
    </div>
  );
}
