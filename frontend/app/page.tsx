"use client";

import { ArrowRight, CheckCircle2, Circle, PlayCircle } from "lucide-react";
import Link from "next/link";
import { MetricsCards } from "@/components/MetricsCards";
import { ResourceCards } from "@/components/ResourceCards";
import { WarningsList } from "@/components/HospitalView";
import { Button, Card, EcgLine, PageHeader, fmt1 } from "@/components/ui";
import { useStore } from "@/lib/store";
import { DEMO_RESOURCES } from "@/lib/demo";
import { RESOURCE_LABELS, STRATEGY_LABELS, emptyResourceSet } from "@/lib/simulation";

export default function ControlRoomPage() {
  const { patients, resources, resourcesSaved, runs, current, viewTime, runDemo, running } = useStore();

  const t = current ? Math.min(viewTime, Math.max(0, current.output.timeline.length - 1)) : 0;
  const point = current?.output.timeline[t];
  const steps = [
    { done: patients.length > 0, label: "Add or load patients", detail: `${patients.length} stored`, href: "/patients" },
    { done: resourcesSaved, label: "Configure hospital resources", detail: resourcesSaved ? "Saved" : "Not saved yet", href: "/resources" },
    { done: runs.length > 0, label: "Run a simulation", detail: `${runs.length} run${runs.length === 1 ? "" : "s"} saved`, href: "/simulation" },
    { done: runs.length > 0, label: "Compare strategies", detail: "Recommendation and advice", href: "/simulation#compare" },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Control Room"
        description="Given the current patient queue and available doctors, nurses, beds, ICU beds and operating rooms, which patient should be treated next — and how does the hospital perform under different scheduling strategies?"
      />

      <section
        aria-label="Prototype notice and latest headline numbers"
        className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-blue-900 via-blue-800 to-blue-700 p-5 text-white shadow-lg shadow-blue-800/20"
      >
        <div aria-hidden className="pointer-events-none absolute -top-16 -right-10 h-56 w-56 rounded-full bg-sky-400/30 blur-3xl" />
        <EcgLine className="pointer-events-none absolute inset-x-0 bottom-2 h-12 w-full text-sky-200/50" />
        <div className="relative">
          <p className="max-w-3xl text-sm text-sky-50">
            <strong className="font-semibold text-white">Hospital operations simulation and decision-support prototype.</strong> Synthetic patient data only — not a
            clinical system and not medical advice.
          </p>
          {current && !current.output.isPlaceholder ? (
            <dl className="stagger mt-4 grid grid-cols-2 gap-3 pb-6 sm:grid-cols-4">
              {[
                ["Treated", `${current.output.metrics.patients_treated}/${current.output.metrics.total_patients}`],
                ["Average wait", `${fmt1(current.output.metrics.average_wait)} min`],
                ["Critical wait", `${fmt1(current.output.metrics.critical_wait)} min`],
                ["Bottleneck", current.output.metrics.bottlenecks[0] ? RESOURCE_LABELS[current.output.metrics.bottlenecks[0].resource] : "None"],
              ].map(([label, value], i) => (
                <div key={label} style={{ ["--i" as string]: i }} className="rounded-xl border border-white/15 bg-white/10 px-3 py-2 backdrop-blur-sm">
                  <dt className="text-xs text-sky-100">{label}</dt>
                  <dd className="text-xl font-bold tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="mt-3 pb-6 text-sm text-sky-100">Run the demo below to see live numbers here.</p>
          )}
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="One-click demo" description="Loads a tight, synthetic scenario and runs it." className="lg:col-span-1">
          <ul className="mb-3 list-disc space-y-0.5 pl-5 text-sm text-slate-700">
            <li>
              {DEMO_RESOURCES.doctor} doctors, {DEMO_RESOURCES.nurse} nurses, {DEMO_RESOURCES.bed} beds, {DEMO_RESOURCES.icu_bed} ICU beds, {DEMO_RESOURCES.operating_room} operating room
            </li>
            <li>25 synthetic patients, 60-minute run</li>
            <li>Emergency surge at minute 20</li>
            <li>One ICU bed fails at minute 35</li>
          </ul>
          <p className="mb-3 text-xs text-slate-600">This replaces the stored patients and saves a new resource configuration.</p>
          <Button
            disabled={running}
            onClick={async () => {
              if (patients.length > 0 && !window.confirm("The demo replaces all stored patients. Continue?")) return;
              await runDemo();
            }}
          >
            <PlayCircle size={16} aria-hidden /> {running ? "Running…" : "Run demo scenario"}
          </Button>
        </Card>

        <Card title="Workflow" className="lg:col-span-2">
          <ol className="grid gap-2 sm:grid-cols-2">
            {steps.map((s, i) => (
              <li key={s.label}>
                <Link href={s.href} className="flex items-center gap-3 rounded-md border border-slate-200 p-3 hover:bg-slate-50">
                  {s.done ? <CheckCircle2 size={20} aria-hidden className="shrink-0 text-emerald-600" /> : <Circle size={20} aria-hidden className="shrink-0 text-slate-400" />}
                  <span className="flex-1">
                    <span className="block text-sm font-semibold">
                      {i + 1}. {s.label}
                    </span>
                    <span className="block text-xs text-slate-600">
                      {s.done ? "Done · " : ""}
                      {s.detail}
                    </span>
                  </span>
                  <ArrowRight size={16} aria-hidden className="text-slate-400" />
                </Link>
              </li>
            ))}
          </ol>
        </Card>
      </div>

      <section aria-labelledby="state-heading">
        <h2 id="state-heading" className="mb-2 text-lg font-semibold">
          Hospital state
        </h2>
        {current && point ? (
          <>
            <p className="mb-2 text-xs text-slate-600">
              Latest run: {STRATEGY_LABELS[current.output.strategy]}, showing minute {t} of {Math.max(0, current.output.timeline.length - 1)} (actual completion: minute {current.output.metrics.actual_completion_time}). Scrub through time on the Simulation page.
            </p>
            <ResourceCards total={point.capacity} inUse={point.in_use} />
          </>
        ) : (
          <>
            <p className="mb-2 text-xs text-slate-600">
              {resourcesSaved ? "Configured capacity" : "Default capacity (not saved yet)"} — no simulation has been run.
            </p>
            <ResourceCards total={resources} inUse={emptyResourceSet()} />
          </>
        )}
      </section>

      <section aria-labelledby="results-heading" className="space-y-3">
        <div className="flex items-end justify-between">
          <h2 id="results-heading" className="text-lg font-semibold">
            Latest results
          </h2>
          <Link href="/simulation" className="text-sm font-medium text-blue-700 hover:underline">
            Open Simulation →
          </Link>
        </div>
        <MetricsCards output={current?.output ?? null} />
        {current && (
          <Card title="Warnings and bottlenecks">
            <WarningsList warnings={current.output.warnings} />
          </Card>
        )}
      </section>
    </div>
  );
}
