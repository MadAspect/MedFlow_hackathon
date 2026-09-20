"use client";

import { ArrowRight, CheckCircle2, Circle, PlayCircle } from "lucide-react";
import Link from "next/link";
import { LiveBar } from "@/components/LiveBar";
import { ResourceCards } from "@/components/ResourceCards";
import { WarningsList } from "@/components/HospitalView";
import { Button, Card, InfoTip, PageHeader, Stat, fmt1 } from "@/components/ui";
import { useStore } from "@/lib/store";
import { DEMO_RESOURCES } from "@/lib/demo";
import { RESOURCE_LABELS, STRATEGY_LABELS, emptyResourceSet, liveSnapshot, slotLabel } from "@/lib/simulation";

export default function ControlRoomPage() {
  const { patients, resources, resourcesSaved, runs, current, viewTime, runDemo, running } = useStore();

  const output = current?.output ?? null;
  const t = output ? Math.min(viewTime, Math.max(0, output.timeline.length - 1)) : 0;
  const point = output?.timeline[t];
  const snap = output && !output.isPlaceholder ? liveSnapshot(output, t) : null;
  const steps = [
    { done: patients.length > 0, label: "Add patients", detail: `${patients.length} stored`, href: "/patients" },
    { done: resourcesSaved, label: "Set resources", detail: resourcesSaved ? "Saved" : "Not saved yet", href: "/resources" },
    { done: runs.length > 0, label: "Run a simulation", detail: `${runs.length} saved`, href: "/simulation" },
    { done: runs.length > 0, label: "Compare strategies", detail: "Advice and what-ifs", href: "/simulation#compare" },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Control Room"
        description="Your hospital at a glance."
        actions={
          <span className="inline-flex items-center gap-1.5">
            <Button
              disabled={running}
              onClick={async () => {
                if (patients.length > 0 && !window.confirm("The demo replaces all stored patients. Continue?")) return;
                await runDemo();
              }}
            >
              <PlayCircle size={16} aria-hidden /> {running ? "Running…" : "Run demo"}
            </Button>
            <InfoTip align="right">
              Loads {DEMO_RESOURCES.doctor} doctors, {DEMO_RESOURCES.nurse} nurses, {DEMO_RESOURCES.bed} beds, {DEMO_RESOURCES.icu_bed} ICU beds and {DEMO_RESOURCES.operating_room} operating room, plus 25 synthetic patients, an
              emergency surge at minute 20 and an ICU bed failing at minute 35. This replaces the stored patients and saves a new resource configuration.
            </InfoTip>
          </span>
        }
      />

      {output && !output.isPlaceholder && snap ? (
        <>
          <LiveBar />
          <div className="stagger grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              <Stat key="t" label="Treated" value={`${snap.treated}/${snap.total}`} sub={`at ${slotLabel(t)}`} />,
              <Stat key="w" label="Waiting now" value={snap.waiting} sub={`${snap.inTreatment} in treatment`} tone={snap.criticalWaiting > 0 ? "red" : undefined} />,
              <Stat key="a" label="Average wait" value={`${fmt1(snap.averageWait)} min`} sub="so far" />,
              <Stat key="b" label="Bottleneck" value={output.metrics.bottlenecks[0] ? RESOURCE_LABELS[output.metrics.bottlenecks[0].resource] : "None"} sub={`${STRATEGY_LABELS[output.strategy]} run`} />,
            ].map((card, i) => (
              <div key={i} style={{ ["--i" as string]: i }}>
                {card}
              </div>
            ))}
          </div>
        </>
      ) : (
        <Card>
          <p className="text-sm text-slate-600">
            No simulation yet. Press <strong className="text-slate-900">Run demo</strong> to see live numbers here, or follow the steps below.
          </p>
        </Card>
      )}

      <section aria-labelledby="state-heading" className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 id="state-heading" className="text-sm font-semibold text-slate-900">
            Hospital state
          </h2>
          <span className="text-xs text-slate-500">{output && point ? `minute ${t} of ${Math.max(0, output.timeline.length - 1)}` : resourcesSaved ? "configured capacity" : "default capacity, not saved"}</span>
        </div>
        {output && point ? <ResourceCards total={point.capacity} inUse={point.in_use} /> : <ResourceCards total={resources} inUse={emptyResourceSet()} />}
      </section>

      <div className="grid gap-4 lg:grid-cols-5">
        <Card title="Get started" className="lg:col-span-2">
          <ol className="space-y-1">
            {steps.map((s, i) => (
              <li key={s.label}>
                <Link href={s.href} className="group flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-slate-50">
                  {s.done ? <CheckCircle2 size={18} aria-hidden className="shrink-0 text-emerald-500" /> : <Circle size={18} aria-hidden className="shrink-0 text-slate-300" />}
                  <span className="flex-1 text-sm">
                    <span className="font-medium text-slate-900">
                      {i + 1}. {s.label}
                    </span>
                    <span className="ml-2 text-xs text-slate-500">{s.detail}</span>
                  </span>
                  <ArrowRight size={15} aria-hidden className="text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-slate-500" />
                </Link>
              </li>
            ))}
          </ol>
        </Card>

        <Card
          title="Warnings and bottlenecks"
          className="lg:col-span-3"
          actions={
            output && (
              <Link href="/simulation" className="text-[13px] font-medium text-blue-700 hover:text-blue-700">
                Open simulation →
              </Link>
            )
          }
        >
          {output ? <WarningsList warnings={output.warnings} /> : <p className="text-sm text-slate-500">Nothing to show until a simulation has run.</p>}
        </Card>
      </div>
    </div>
  );
}
