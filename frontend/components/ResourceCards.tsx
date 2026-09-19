"use client";

import { AlertTriangle, CheckCircle2, Siren } from "lucide-react";
import { Card, ProgressBar, cx, pct0, type Tone } from "./ui";
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
            <p className="mt-2 text-3xl font-bold tabular-nums text-slate-900">
              {pct0(utilization)}
              <span className="ml-1 text-xs font-medium text-slate-500">utilization</span>
            </p>
            <div className="mt-2">
              <ProgressBar value={utilization} tone={capacity === 0 ? "grey" : status.tone} label={`${RESOURCE_LABELS[key]} utilization`} />
            </div>
            <dl className="mt-3 grid grid-cols-3 gap-1 text-center text-xs">
              <div>
                <dt className="text-slate-500">Total</dt>
                <dd className="text-sm font-semibold tabular-nums">{capacity}</dd>
              </div>
              <div>
                <dt className="text-slate-500">In use</dt>
                <dd className="text-sm font-semibold tabular-nums">{used}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Available</dt>
                <dd className="text-sm font-semibold tabular-nums">{Math.max(0, capacity - used)}</dd>
              </div>
            </dl>
          </Card>
        );
      })}
    </div>
  );
}
