"use client";

import { Download } from "lucide-react";
import { HospitalView, WarningsList } from "@/components/HospitalView";
import { MetricsCards } from "@/components/MetricsCards";
import { ResultsCharts } from "@/components/ResultsCharts";
import { SimulationControls } from "@/components/SimulationControls";
import { StrategyComparison } from "@/components/StrategyComparison";
import { Button, Card, Notice, PageHeader, fmt1 } from "@/components/ui";
import { downloadCsv, outcomesToCsv } from "@/lib/export";
import { useStore } from "@/lib/store";
import { PLACEHOLDER_NOTICE, RESOURCE_LABELS, STRATEGY_LABELS, type SimulationOutput } from "@/lib/simulation";

/** One plain-language sentence summarising a finished run, built only from its metrics. */
function summarise(output: SimulationOutput): string {
  const m = output.metrics;
  const top = m.bottlenecks[0];
  return (
    `Under ${STRATEGY_LABELS[output.strategy]}, ${m.patients_treated} of ${m.total_patients} patients were treated. ` +
    `On average a patient waited ${fmt1(m.average_wait)} min` +
    (m.patients_arrived > 0 && m.critical_wait_total > 0 ? ` (critical patients: ${fmt1(m.critical_wait)} min)` : "") +
    (top ? `, and ${RESOURCE_LABELS[top.resource].toLowerCase()} were the main bottleneck.` : ", and no patient had to wait for a resource.")
  );
}

export default function SimulationPage() {
  const { current, viewTime, setViewTime } = useStore();
  const output = current?.output ?? null;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Simulation"
        description={
          <>
            Choose a scheduling strategy, optionally add an emergency surge or a resource failure, and run. Results are saved to the database. For a
            side-by-side comparison and advice on making the system more efficient, jump to{" "}
            <a href="#compare" className="font-medium text-blue-800 underline">
              Compare strategies and get advice
            </a>
            .
          </>
        }
      />
      <SimulationControls />

      <section aria-labelledby="results-heading" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="results-heading" className="text-xl font-semibold">
            Results
          </h2>
          {output && !output.isPlaceholder && (
            <Button variant="secondary" onClick={() => downloadCsv(`medflow-${output.strategy}-run.csv`, outcomesToCsv(output))}>
              <Download size={15} aria-hidden /> Download patients (CSV)
            </Button>
          )}
        </div>
        {output && !output.isPlaceholder && <p className="text-base text-slate-900">{summarise(output)}</p>}
        {output && (
          <p className="text-sm text-slate-600">
            {STRATEGY_LABELS[output.strategy]} · planned duration {output.metrics.configured_duration} min · actual completion {output.metrics.actual_completion_time} min
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

      <section id="compare" aria-labelledby="lab-heading" className="scroll-mt-4 space-y-4">
        <h2 id="lab-heading" className="sr-only">
          Compare strategies and get advice
        </h2>
        <StrategyComparison />
      </section>
    </div>
  );
}
