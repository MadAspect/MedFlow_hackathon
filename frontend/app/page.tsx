"use client";

import { ArrowRight, CheckCircle2, Circle, PlayCircle } from "lucide-react";
import Link from "next/link";
import { MetricsCards } from "@/components/MetricsCards";
import { ResourceCards } from "@/components/ResourceCards";
import { WarningsList } from "@/components/HospitalView";
import { Button, Card, Notice, PageHeader } from "@/components/ui";
import { useStore } from "@/lib/store";
import { DEMO_RESOURCES } from "@/lib/demo";
import { STRATEGY_LABELS, emptyResourceSet } from "@/lib/simulation";

export default function ControlRoomPage() {
  const { patients, resources, resourcesSaved, runs, current, viewTime, runDemo, running } = useStore();

  const t = current ? Math.min(viewTime, Math.max(0, current.output.timeline.length - 1)) : 0;
  const point = current?.output.timeline[t];
  const steps = [
    { done: patients.length > 0, label: "Add or load patients", detail: `${patients.length} stored`, href: "/patients" },
    { done: resourcesSaved, label: "Configure hospital resources", detail: resourcesSaved ? "Saved" : "Not saved yet", href: "/resources" },
    { done: runs.length > 0, label: "Run a simulation", detail: `${runs.length} run${runs.length === 1 ? "" : "s"} saved`, href: "/simulation" },
    { done: runs.length > 0, label: "Compare strategies", detail: "Strategy Lab", href: "/simulation" },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Control Room"
        description="Given the current patient queue and available doctors, nurses, beds, ICU beds and operating rooms, which patient should be treated next — and how does the hospital perform under different scheduling strategies?"
      />

      <Notice tone="blue">
        <strong>Hospital operations simulation and decision-support prototype.</strong> Synthetic patient data only — not a clinical system and not medical advice.
      </Notice>

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
