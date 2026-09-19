"use client";

import { HospitalView, WarningsList } from "@/components/HospitalView";
import { MetricsCards } from "@/components/MetricsCards";
import { ResultsCharts } from "@/components/ResultsCharts";
import { SimulationControls } from "@/components/SimulationControls";
import { StrategyComparison } from "@/components/StrategyComparison";
import { Card, Notice, PageHeader } from "@/components/ui";
import { useStore } from "@/lib/store";
import { PLACEHOLDER_NOTICE, STRATEGY_LABELS } from "@/lib/simulation";

export default function SimulationPage() {
  const { current, viewTime, setViewTime } = useStore();
  const output = current?.output ?? null;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Simulation"
        description="Choose a scheduling strategy, optionally add an emergency surge or a resource failure, and run. Results are saved to the database."
      />
      <SimulationControls />

      <section aria-labelledby="results-heading" className="space-y-4">
        <h2 id="results-heading" className="text-xl font-semibold">
          Results
        </h2>
        {output && (
          <p className="text-sm text-slate-600">
            {STRATEGY_LABELS[output.strategy]} · {output.params.duration} min
            {output.params.emergencySurge ? ` · surge from minute ${output.params.surgeStart}` : ""}
            {output.params.resourceFailure ? ` · ${output.params.failedResource.replace("_", " ")} failure at minute ${output.params.failureStart}` : ""}
            {current?.createdAt ? ` · run at ${new Date(current.createdAt).toLocaleString()}` : ""}
          </p>
        )}
        {output?.isPlaceholder && <Notice tone="yellow">{PLACEHOLDER_NOTICE}</Notice>}
        <MetricsCards output={output} />
        {output && (
          <Card title="Warnings and bottlenecks">
            <WarningsList warnings={output.warnings} />
          </Card>
        )}
      </section>

      <section aria-labelledby="hospital-heading" className="space-y-3">
        <h2 id="hospital-heading" className="text-xl font-semibold">
          Interactive hospital view
        </h2>
        <HospitalView output={output} viewTime={viewTime} setViewTime={setViewTime} />
      </section>

      <section aria-labelledby="charts-heading" className="space-y-3">
        <h2 id="charts-heading" className="text-xl font-semibold">
          Charts
        </h2>
        <ResultsCharts output={output} />
      </section>

      <section aria-labelledby="lab-heading" className="space-y-3">
        <h2 id="lab-heading" className="sr-only">
          Strategy comparison
        </h2>
        <StrategyComparison />
      </section>
    </div>
  );
}
