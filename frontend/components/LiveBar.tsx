"use client";

import { Pause, Play, RotateCcw, SkipForward } from "lucide-react";
import { useMemo } from "react";
import { Button, Segmented, cx, fmt1 } from "./ui";
import { PLAYBACK_SPEEDS, useStore } from "@/lib/store";
import { liveSnapshot, slotLabel } from "@/lib/simulation";

export function LiveBar({ className }: { className?: string }) {
  const { current, viewTime, setViewTime, playing, setPlaying, speed, setSpeed } = useStore();
  const output = current?.output ?? null;
  const last = output ? Math.max(0, output.timeline.length - 1) : 0;
  const t = Math.max(0, Math.min(last, viewTime));
  const snap = useMemo(() => (output ? liveSnapshot(output, t) : null), [output, t]);
  if (!output || !snap) return null;

  const atEnd = t >= last;
  const toggle = () => {
    if (playing) return setPlaying(false);
    if (atEnd) setViewTime(0); // replay from the start
    setPlaying(true);
  };
  const late = snap.appointmentsLate;

  const chips: { label: string; value: string; tone?: "red" | "amber" }[] = [
    { label: "Waiting", value: String(snap.waiting), tone: snap.criticalWaiting > 0 ? "red" : undefined },
    { label: "In treatment", value: String(snap.inTreatment) },
    { label: "Treated", value: `${snap.treated}/${snap.total}` },
    { label: "Avg wait", value: `${fmt1(snap.averageWait)} min` },
    { label: "Longest wait", value: `${snap.longestWait} min`, tone: snap.longestWait > output.params.safetyThreshold ? "amber" : undefined },
    ...(output.metrics.appointments_total
      ? [{ label: "Appointments late", value: `${late}/${output.metrics.appointments_total}`, tone: late > 0 ? ("amber" as const) : undefined }]
      : []),
  ];

  return (
    <div className={cx("sticky top-2 z-30 rounded-xl border border-slate-200 bg-surface/95 p-3 shadow-md backdrop-blur", className)}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex items-center gap-2">
          <Button onClick={toggle} aria-label={playing ? "Pause replay" : atEnd ? "Replay the run" : "Play the run"} className="w-24">
            {playing ? <Pause size={15} aria-hidden /> : atEnd ? <RotateCcw size={15} aria-hidden /> : <Play size={15} aria-hidden />}
            {playing ? "Pause" : atEnd ? "Replay" : "Play"}
          </Button>
          <div className="min-w-[5.5rem] leading-tight" role="timer" aria-live="off">
            <p className="flex items-center gap-1.5 text-xl font-semibold tabular-nums">
              {playing && <span aria-hidden className="live-dot h-2 w-2 rounded-full bg-red-500" />}
              {slotLabel(t)}
            </p>
            <p className="text-xs text-slate-500 tabular-nums">
              minute {t} of {last}
            </p>
          </div>
        </div>

        <input
          type="range"
          min={0}
          max={last}
          value={t}
          aria-label="Simulation minute"
          aria-valuetext={`${slotLabel(t)}, minute ${t} of ${last}`}
          onChange={(e) => {
            setPlaying(false);
            setViewTime(Number(e.target.value));
          }}
          className="h-2 min-w-40 flex-1 cursor-pointer accent-blue-600"
        />

        <div className="flex items-center gap-2">
          <Segmented
            size="sm"
            label="Replay speed"
            value={speed}
            onChange={setSpeed}
            options={PLAYBACK_SPEEDS.map((s) => ({ value: s, label: `${s}×`, title: `${s} simulated minutes per second` }))}
          />
          <Button variant="ghost" size="sm" onClick={() => { setPlaying(false); setViewTime(last); }} disabled={atEnd} aria-label="Jump to the end of the run">
            <SkipForward size={14} aria-hidden /> End
          </Button>
        </div>
      </div>

      <dl className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1 border-t border-slate-100 pt-2.5 text-xs">
        {chips.map((c) => (
          <div key={c.label} className="flex items-baseline gap-1.5">
            <dt className="text-slate-500">{c.label}</dt>
            <dd className={cx("text-sm font-semibold tabular-nums", c.tone === "red" ? "text-red-700" : c.tone === "amber" ? "text-amber-700" : "text-slate-900")}>{c.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
