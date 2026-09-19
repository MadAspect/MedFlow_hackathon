"use client";

import { ResourceCards } from "@/components/ResourceCards";
import { ResourceForm } from "@/components/ResourceForm";
import { Card, PageHeader, ProgressBar, pct0 } from "@/components/ui";
import { useStore } from "@/lib/store";
import { RESOURCE_KEYS, emptyResourceSet, resourceStatus, totalUnits } from "@/lib/simulation";

export default function ResourcesPage() {
  const { resources, current, viewTime } = useStore();
  const t = current ? Math.min(viewTime, current.output.params.duration) : 0;
  const point = current?.output.timeline[t];
  const total = point?.capacity ?? resources;
  const inUse = point?.in_use ?? emptyResourceSet();

  const capacity = totalUnits(total);
  const allocated = totalUnits(inUse);
  const overall = capacity > 0 ? allocated / capacity : 0;
  const tone = { ok: "green", warning: "yellow", critical: "red" } as const;

  return (
    <div className="space-y-6">
      <PageHeader title="Resources" description="Set how many doctors, nurses, beds, ICU beds and operating rooms the hospital has." />
      <ResourceForm />

      <section aria-labelledby="capacity-heading" className="space-y-3">
        <h2 id="capacity-heading" className="text-lg font-semibold">
          Capacity overview
        </h2>
        <p className="text-xs text-slate-600">
          {current
            ? `Allocation is taken from the latest simulation at minute ${t}. Capacity shows units online at that minute; adjust the time on the Simulation page.`
            : "No simulation has been run, so nothing is allocated yet."}
        </p>
        <Card>
          <div className="grid gap-4 sm:grid-cols-4">
            <div>
              <p className="text-xs text-slate-600">Total capacity (units)</p>
              <p className="text-2xl font-bold tabular-nums">{capacity}</p>
            </div>
            <div>
              <p className="text-xs text-slate-600">Currently allocated</p>
              <p className="text-2xl font-bold tabular-nums">{allocated}</p>
            </div>
            <div>
              <p className="text-xs text-slate-600">Available</p>
              <p className="text-2xl font-bold tabular-nums">{Math.max(0, capacity - allocated)}</p>
            </div>
            <div>
              <p className="text-xs text-slate-600">Overall utilization</p>
              <p className="text-2xl font-bold tabular-nums">{pct0(overall)}</p>
              <div className="mt-1">
                <ProgressBar value={overall} tone={tone[resourceStatus(overall)]} label="Overall utilization" />
              </div>
            </div>
          </div>
        </Card>
        <ResourceCards total={total} inUse={inUse} />
        <p className="sr-only">{RESOURCE_KEYS.length} resource types shown.</p>
      </section>
    </div>
  );
}
