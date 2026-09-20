"use client";

import { AlertTriangle, CheckCircle2, Siren } from "lucide-react";
import { ProgressBar, cx, type Tone } from "./ui";
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
  warning: { tone: "yellow", label: "Busy", Icon: AlertTriangle, text: "text-amber-700" },
  critical: { tone: "red", label: "Critical", Icon: Siren, text: "text-red-700" },
};

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
    <div className={cx("grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5", className)}>
      {RESOURCE_KEYS.map((key) => {
        const capacity = total[key];
        const used = inUse[key];
        const utilization = capacity > 0 ? Math.min(1, used / capacity) : 0;
        const level = resourceStatus(capacity > 0 ? utilization : 0);
        const status = STATUS[level];
        const critical = capacity > 0 && level === "critical";
        return (
          <div
            key={key}
            className={cx(
              "min-w-0 rounded-xl border bg-surface p-4 shadow-[0_1px_2px_rgb(15_23_42/0.04)]",
              critical ? "animate-warn border-red-300" : "border-slate-200",
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <h3 className="truncate text-[13px] font-medium text-slate-600">{RESOURCE_LABELS[key]}</h3>
              <span className={cx("flex shrink-0 items-center gap-1 text-xs font-medium", capacity === 0 ? "text-slate-400" : status.text)}>
                <status.Icon size={13} aria-hidden /> {capacity === 0 ? "None" : status.label}
              </span>
            </div>
            <p className="mt-2 text-2xl leading-none font-semibold tracking-tight tabular-nums text-slate-900">
              {used}
              <span className="text-base font-normal text-slate-400"> / {capacity}</span>
            </p>
            <div className="mt-3">
              <ProgressBar value={utilization} tone={capacity === 0 ? "grey" : status.tone} label={`${RESOURCE_LABELS[key]} utilization`} />
            </div>
            <p className="mt-2 text-xs text-slate-500 tabular-nums">{Math.max(0, capacity - used)} available</p>
          </div>
        );
      })}
    </div>
  );
}
