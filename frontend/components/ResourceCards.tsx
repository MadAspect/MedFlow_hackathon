"use client";

import { AlertTriangle, CheckCircle2, Siren } from "lucide-react";
import { Card, cx, pct0, type Tone } from "./ui";
import {
  RESOURCE_KEYS,
  RESOURCE_LABELS,
  resourceStatus,
  type ResourceSet,
} from "@/lib/simulation";

const STATUS: Record<
  ReturnType<typeof resourceStatus>,
  { tone: Tone; label: string; Icon: typeof CheckCircle2; text: string }
> = {
  ok: { tone: "green", label: "Normal", Icon: CheckCircle2, text: "text-emerald-700" },
  warning: { tone: "yellow", label: "Warning", Icon: AlertTriangle, text: "text-amber-700" },
  critical: { tone: "red", label: "Critical", Icon: Siren, text: "text-red-700" },
};

const RING: Record<Tone, string> = {
  blue: "#2563eb",
  green: "#059669",
  yellow: "#d97706",
  red: "#dc2626",
  grey: "#94a3b8",
};

/** Circular utilization gauge. The ring animates when the value changes; the text carries the value. */
function Gauge({ value, tone, label }: { value: number; tone: Tone; label: string }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(v * 100)}
      className="relative h-[72px] w-[72px] shrink-0"
      style={tone === "red" ? { filter: "drop-shadow(0 0 6px rgb(220 38 38 / 0.35))" } : undefined}
    >
      <svg viewBox="0 0 64 64" className="h-full w-full -rotate-90" aria-hidden>
        <circle cx="32" cy="32" r={r} fill="none" stroke="#e2e8f0" strokeWidth="7" />
        <circle
          cx="32"
          cy="32"
          r={r}
          fill="none"
          stroke={RING[tone]}
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - v)}
          className="transition-[stroke-dashoffset] duration-500 ease-out"
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-sm font-bold tabular-nums text-slate-900">{pct0(v)}</span>
    </div>
  );
}

/**
 * One card per resource: total, in use, available and utilization.
 * `total` is the capacity currently online; green < 70%, yellow 70–89%, red ≥ 90%.
 */
export function ResourceCards({
  total,
  inUse,
  className,
}: {
  total: ResourceSet;
  inUse: ResourceSet;
  className?: string;
}) {
  return (
    <div className={cx("grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5", className)}>
      {RESOURCE_KEYS.map((key) => {
        const capacity = total[key];
        const used = inUse[key];
        const utilization = capacity > 0 ? Math.min(1, used / capacity) : 0;
        const status = STATUS[resourceStatus(capacity > 0 ? utilization : 0)];
        const critical = capacity > 0 && resourceStatus(utilization) === "critical";
        return (
          <Card
            key={key}
            className={cx(critical && "animate-warn border-red-400", "!shadow-none")}
          >
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-slate-900">{RESOURCE_LABELS[key]}</h3>
              <span className={cx("flex items-center gap-1 text-xs font-semibold", status.text)}>
                <status.Icon size={14} aria-hidden /> {capacity === 0 ? "None" : status.label}
              </span>
            </div>
            <div className="mt-3 flex items-center gap-3">
              <Gauge value={utilization} tone={capacity === 0 ? "grey" : status.tone} label={`${RESOURCE_LABELS[key]} utilization`} />
              <dl className="grid flex-1 grid-cols-1 gap-1 text-xs">
                {[
                  ["Total", capacity],
                  ["In use", used],
                  ["Available", Math.max(0, capacity - used)],
                ].map(([label, value]) => (
                  <div key={label} className="flex items-baseline justify-between gap-2">
                    <dt className="text-slate-500">{label}</dt>
                    <dd className="text-sm font-semibold tabular-nums">{value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
