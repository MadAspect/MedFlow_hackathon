"use client";

import { CheckCircle2, TriangleAlert, X } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { Badge, Button, Notice, ProgressBar, Stat, fmt1, pct0, type Tone } from "./ui";
import { RESOURCE_LABELS, STRATEGY_LABELS, resourceStatus, slotLabel } from "@/lib/simulation";
import { alignRoster, isOpenSlot } from "@/lib/staff";
import { useStore } from "@/lib/store";
import { buildRunSummary } from "@/lib/summary";

const TONE = { ok: "green", warning: "yellow", critical: "red" } as const satisfies Record<string, Tone>;
const hours = (n: number) => `${n.toFixed(1)} h`;

/** Opens when a simulation finishes: the key numbers, how much of each resource was used and who worked. */
export function RunSummaryDialog() {
  const { summaryOpen, closeSummary, current, staff, resources } = useStore();
  const ref = useRef<HTMLDialogElement>(null);
  const output = current && !current.output.isPlaceholder ? current.output : null;
  const open = summaryOpen && output !== null;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const summary = useMemo(() => (output ? buildRunSummary(output, staff, resources) : null), [output, staff, resources]);
  const roster = useMemo(() => alignRoster(staff, resources), [staff, resources]);

  return (
    <dialog
      ref={ref}
      aria-labelledby="run-summary-title"
      onClose={closeSummary}
      onClick={(e) => e.target === e.currentTarget && closeSummary()}
      className="m-auto max-h-[88vh] w-[min(46rem,calc(100vw-1.5rem))] overflow-y-auto rounded-2xl border border-slate-200 bg-surface p-0 text-slate-900 shadow-2xl backdrop:bg-slate-900/50"
    >
      {output && summary && open && (
        <div className="space-y-5 p-5 sm:p-6">
          <header className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 id="run-summary-title" className="flex items-center gap-2 text-lg font-semibold tracking-tight">
                {output.completed ? <CheckCircle2 size={20} aria-hidden className="text-emerald-600" /> : <TriangleAlert size={20} aria-hidden className="text-amber-600" />}
                {output.completed ? "Simulation complete" : "Simulation stopped early"}
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                {STRATEGY_LABELS[output.strategy]} · planned {summary.timing.planned} min · finished at minute {summary.timing.finished} ({slotLabel(summary.timing.finished)})
              </p>
            </div>
            <Button variant="ghost" className="!px-2" aria-label="Close summary" onClick={closeSummary}>
              <X size={18} aria-hidden />
            </Button>
          </header>

          {!output.completed && <Notice tone="red">{output.error ?? "Not all patients were treated."}</Notice>}

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Patients treated" value={`${summary.patients.treated}/${summary.patients.total}`} tone={summary.patients.remaining > 0 ? "red" : "green"} />
            <Stat label="Average wait" value={`${fmt1(summary.waits.average)} min`} sub={`Critical: ${fmt1(summary.waits.critical)} min`} />
            <Stat label="Longest wait" value={`${summary.waits.maximum} min`} tone={summary.waits.breaches > 0 ? "yellow" : undefined} sub={summary.waits.breaches > 0 ? `${summary.waits.breaches} past the safety limit` : "None past the safety limit"} />
            <Stat label="Peak queue" value={summary.waits.queuePeak} sub={`at minute ${summary.waits.queuePeakAt}`} />
          </div>

          <section aria-labelledby="summary-faculty">
            <h3 id="summary-faculty" className="mb-2 text-sm font-semibold">
              Faculty working
            </h3>
            <ul className="grid gap-2 sm:grid-cols-2">
              {summary.faculty.map((f) => {
                const label = f.role === "doctor" ? "Doctors" : "Nurses";
                return (
                  <li key={f.role} className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm">
                    <p className="flex items-baseline justify-between gap-2">
                      <span className="font-semibold">{label}</span>
                      <span className="text-xs text-slate-500">{f.configured} on the Resources page</span>
                    </p>
                    <p className="mt-1">
                      <span className="text-xl font-semibold tabular-nums">{f.worked}</span>
                      <span className="text-slate-600"> of {f.configured} treated patients</span>
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      Up to {f.peakWorking} at the same time · {hours(f.hours)} of care
                      {f.offDuty > 0 ? ` · ${f.offDuty} off duty` : ""}
                    </p>
                    {f.names.length > 0 && (
                      <p className="mt-1.5 text-xs text-slate-600">
                        {f.names.slice(0, 6).join(", ")}
                        {f.names.length > 6 ? ` and ${f.names.length - 6} more` : ""}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
            <p className="mt-2 text-xs text-slate-500">
              {summary.otherStaff > 0 ? `${summary.otherStaff} technicians and other staff are on the roster but the engine does not schedule them. ` : ""}
              {roster.scheduled.some((s) => isOpenSlot(s)) ? "Numbered doctors and nurses are positions from the Resources page nobody has been named for yet. " : ""}
              {roster.surplus.length > 0 ? `${roster.surplus.length} named staff are beyond the Resources headcount and were not scheduled.` : ""}
            </p>
          </section>

          <section aria-labelledby="summary-resources">
            <h3 id="summary-resources" className="mb-2 text-sm font-semibold">
              Resources used
            </h3>
            <ul className="space-y-2.5">
              {summary.resources
                .filter((r) => r.capacity > 0)
                .map((r) => (
                  <li key={r.key}>
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
                      <span className="font-medium">{RESOURCE_LABELS[r.key]}</span>
                      <span className="text-xs text-slate-500 tabular-nums">
                        {pct0(r.utilization)} busy · peak {r.peak} of {r.capacity} · {hours(r.unitHours)} used
                      </span>
                    </div>
                    <div className="mt-1">
                      <ProgressBar value={r.utilization} tone={TONE[resourceStatus(r.utilization)]} label={`${RESOURCE_LABELS[r.key]} utilization`} />
                    </div>
                  </li>
                ))}
            </ul>
          </section>

          {summary.stock && (summary.stock.medicines.length > 0 || summary.stock.equipment.length > 0) && (
            <section aria-labelledby="summary-stock">
              <h3 id="summary-stock" className="mb-2 text-sm font-semibold">
                Medicine and equipment
              </h3>
              <ul className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
                {summary.stock.medicines.map((m) => (
                  <li key={m.item_id} className="flex justify-between gap-2">
                    <span>{m.name}</span>
                    <span className="text-slate-500 tabular-nums">
                      used {m.consumed} · {m.remaining} of {m.initial} left
                    </span>
                  </li>
                ))}
                {summary.stock.equipment.map((e) => (
                  <li key={e.item_id} className="flex justify-between gap-2">
                    <span>{e.name}</span>
                    <span className="text-slate-500 tabular-nums">
                      peak {e.peak_in_use} of {e.units} in use
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section aria-labelledby="summary-points">
            <h3 id="summary-points" className="mb-2 text-sm font-semibold">
              Key points
            </h3>
            <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
              <li>
                {summary.patients.treated} of {summary.patients.total} patients were treated; the last treatment ended at minute {summary.timing.finished}.
              </li>
              {summary.bottlenecks.length > 0 ? (
                <li>
                  Main bottleneck: {summary.bottlenecks.map((b) => `${RESOURCE_LABELS[b.resource].toLowerCase()} (${b.patientMinutes} patient-minutes of waiting)`).join(", ")}.
                </li>
              ) : (
                <li>No patient had to wait for a resource.</li>
              )}
              <li>
                {summary.warnings.critical + summary.warnings.warning === 0 ? (
                  "No warnings were raised."
                ) : (
                  <>
                    {summary.warnings.critical > 0 && <Badge tone="red">{summary.warnings.critical} critical</Badge>}{" "}
                    {summary.warnings.warning > 0 && <Badge tone="yellow">{summary.warnings.warning} warning{summary.warnings.warning === 1 ? "" : "s"}</Badge>} raised. See the Overview tab for details.
                  </>
                )}
              </li>
            </ul>
          </section>

          <footer className="flex justify-end">
            <Button onClick={closeSummary}>Close</Button>
          </footer>
        </div>
      )}
    </dialog>
  );
}
