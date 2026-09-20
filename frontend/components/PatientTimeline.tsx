"use client";

import { useMemo } from "react";
import { Card, cx } from "./ui";
import type { PatientOutcome, SimulationOutput } from "@/lib/simulation";

const LABEL_W = 84; // px, keep in sync with the `w-[84px]` classes below

function niceStep(horizon: number): number {
  const target = horizon / 8;
  for (const s of [1, 2, 5, 10, 15, 20, 30, 60, 120, 240]) if (s >= target) return s;
  return 480;
}

const byArrival = (a: PatientOutcome, b: PatientOutcome) =>
  a.arrival_time - b.arrival_time || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function PatientTimeline({
  output,
  viewTime,
  setViewTime,
  selectedId,
  onSelect,
}: {
  output: SimulationOutput;
  viewTime: number;
  setViewTime: (t: number) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const horizon = Math.max(1, output.timeline.length - 1);
  const { params } = output;
  const rows = useMemo(() => [...output.patients].sort(byArrival), [output.patients]);
  const pct = (m: number) => `${(Math.max(0, Math.min(horizon, m)) / horizon) * 100}%`;
  const ticks = useMemo(() => {
    const step = niceStep(horizon);
    const out: number[] = [];
    for (let m = 0; m <= horizon; m += step) out.push(m);
    return out;
  }, [horizon]);
  const t = Math.max(0, Math.min(horizon, viewTime));

  const scrub = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    setViewTime(Math.round(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * horizon));
  };

  const markers = [
    params.emergencySurge && params.surgeStart <= horizon ? { at: params.surgeStart, label: "Surge", color: "var(--chart-warn-text)" } : null,
    params.resourceFailure && params.failureStart <= horizon ? { at: params.failureStart, label: "Failure", color: "var(--chart-crit-text)" } : null,
  ].filter((m): m is { at: number; label: string; color: string } => m !== null);

  return (
    <Card
      title="Patient timeline"
      description="One row per patient. Click the chart to jump to a minute."
    >
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-700" aria-hidden>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-5 rounded-sm bg-slate-300" /> Waiting
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-5 rounded-sm bg-red-400" /> Waiting past the {params.safetyThreshold}-min safety limit
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-5 rounded-sm bg-gradient-to-r from-blue-600 to-sky-500" /> In treatment
        </span>
        {output.patients.some((p) => p.ambulance) && (
          <span className="flex items-center gap-1.5">
            <span className="h-0 w-5 border-t-2 border-dashed border-red-500" /> Ambulance on its way
          </span>
        )}
        {output.patients.some((p) => p.appointment) && (
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rotate-45 border-2 border-violet-600 bg-surface" /> Booked slot
          </span>
        )}
      </div>

      <div className="relative max-h-[26rem] overflow-y-auto rounded-lg border border-slate-200 bg-surface">
        <div className="sticky top-0 z-10 flex border-b border-slate-200 bg-slate-50/95 text-[10px] text-slate-500 backdrop-blur">
          <div className="w-[84px] shrink-0 px-2 py-1 font-semibold uppercase">Patient</div>
          <div className="relative h-6 flex-1 cursor-pointer" onClick={scrub}>
            {ticks.map((m) => (
              <span key={m} className="absolute top-1 -translate-x-1/2 tabular-nums" style={{ left: pct(m) }}>
                {m}
              </span>
            ))}
            {markers.map((m) => (
              <span key={m.label} className="absolute bottom-0 -translate-x-1/2 text-[9px] font-semibold" style={{ left: pct(m.at), color: m.color }}>
                {m.label}
              </span>
            ))}
          </div>
        </div>

        <div className="relative">
          {rows.map((p) => {
            const critical = p.urgency >= params.criticalUrgency;
            const started = p.start_time !== null;
            const waitEnd = started ? p.start_time! : horizon;
            const waitLen = Math.max(0, waitEnd - p.arrival_time);
            const safeEnd = p.arrival_time + Math.min(waitLen, params.safetyThreshold);
            return (
              <div key={p.id} className={cx("flex items-center border-b border-slate-100 last:border-b-0", selectedId === p.id && "bg-blue-50")}>
                <button
                  type="button"
                  onClick={() => onSelect(p.id)}
                  aria-pressed={selectedId === p.id}
                  title={`${p.condition} · urgency ${p.urgency}`}
                  className="flex w-[84px] shrink-0 items-center gap-1.5 px-2 py-[3px] text-left text-[11px] font-semibold text-slate-800 hover:text-blue-700"
                >
                  <span aria-hidden className={cx("h-1.5 w-1.5 rounded-full", critical ? "bg-red-500" : p.urgency === 3 ? "bg-amber-500" : "bg-slate-300")} />
                  {p.id}
                  <span className="sr-only">
                    {p.appointment ? ", booked appointment" : ""}
                    {p.ambulance ? ", arrived by ambulance" : ""}, urgency {p.urgency}, waited {p.wait_time} minutes
                  </span>
                </button>
                <div className="relative h-[18px] flex-1 cursor-pointer" onClick={scrub} aria-hidden>
                  {waitLen > 0 && (
                    <>
                      <div className="absolute top-1/2 h-2 -translate-y-1/2 rounded-l-sm bg-slate-300" style={{ left: pct(p.arrival_time), width: `calc(${pct(safeEnd)} - ${pct(p.arrival_time)})` }} />
                      {waitLen > params.safetyThreshold && (
                        <div className="absolute top-1/2 h-2 -translate-y-1/2 bg-red-400" style={{ left: pct(safeEnd), width: `calc(${pct(waitEnd)} - ${pct(safeEnd)})` }} />
                      )}
                    </>
                  )}
                  {p.ambulance && p.alert_time != null && p.alert_time < p.arrival_time && (
                    <div
                      className="absolute top-1/2 -translate-y-1/2 border-t-2 border-dashed border-red-500"
                      style={{ left: pct(p.alert_time), width: `calc(${pct(p.arrival_time)} - ${pct(p.alert_time)})` }}
                      title={`${p.id}: ambulance warned at minute ${p.alert_time}, arrives at minute ${p.arrival_time}`}
                    />
                  )}
                  {p.appointment && (
                    <span
                      className="absolute top-1/2 z-[1] h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 border-2 border-violet-600 bg-surface"
                      style={{ left: pct(p.arrival_time) }}
                      title={`${p.id}: booked for minute ${p.arrival_time}`}
                    />
                  )}
                  {started && (
                    <div
                      className="absolute top-1/2 h-3 -translate-y-1/2 rounded-sm bg-gradient-to-r from-blue-600 to-sky-500 shadow-sm"
                      style={{ left: pct(p.start_time!), width: `calc(${pct(p.end_time!)} - ${pct(p.start_time!)})` }}
                      title={`${p.id}: waited ${p.wait_time} min, treated minute ${p.start_time}–${p.end_time}`}
                    />
                  )}
                </div>
              </div>
            );
          })}

          <div className="pointer-events-none absolute inset-y-0 right-0" style={{ left: LABEL_W }} aria-hidden>
            {markers.map((m) => (
              <div key={m.label} className="absolute inset-y-0 border-l border-dashed" style={{ left: pct(m.at), borderColor: m.color }} />
            ))}
            <div className="playhead absolute inset-y-0 w-0.5 -translate-x-1/2 bg-blue-600" style={{ left: pct(t) }}>
              <span className="absolute -top-0.5 left-1/2 h-2 w-2 -translate-x-1/2 rounded-full bg-blue-600 ring-2 ring-surface" />
            </div>
          </div>
        </div>
      </div>
      <p className="mt-2 text-xs text-slate-500">
        Minute {t} of {horizon}.
      </p>
    </Card>
  );
}
