"use client";

import { ClipboardList, Download } from "lucide-react";
import { useState } from "react";
import { Algorithms } from "@/components/Algorithms";
import { HospitalView, WarningsList } from "@/components/HospitalView";
import { LiveBar } from "@/components/LiveBar";
import { LivePatientForm } from "@/components/LivePatientForm";
import { MetricsCards } from "@/components/MetricsCards";
import { ResultsCharts } from "@/components/ResultsCharts";
import { SimulationControls } from "@/components/SimulationControls";
import { StrategyComparison } from "@/components/StrategyComparison";
import { Button, Card, Notice, PageHeader, Tabs, fmt1 } from "@/components/ui";
import { downloadCsv, outcomesToCsv } from "@/lib/export";
import { useStore } from "@/lib/store";
import { PLACEHOLDER_NOTICE, RESOURCE_LABELS, STRATEGY_LABELS, type SimulationOutput } from "@/lib/simulation";

type Tab = "overview" | "hospital" | "charts" | "compare" | "algorithms";
const TABS: { value: Tab; label: string }[] = [
  { value: "overview", label: "Overview" },
  { value: "hospital", label: "Hospital" },
  { value: "charts", label: "Charts" },
  { value: "compare", label: "Compare & advice" },
  { value: "algorithms", label: "Algorithms" },
];

function tabFromHash(): Tab {
  if (typeof window === "undefined") return "overview";
  const hash = window.location.hash.replace("#", "");
  return TABS.some((t) => t.value === hash) ? (hash as Tab) : "overview";
}

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
  const { current, viewTime, setViewTime, liveReplay, staff, resources, openSummary } = useStore();
  const output = current?.output ?? null;
  // The page is only rendered once the store is ready (on the client), so reading the URL here is safe.
  const [tab, setTabState] = useState<Tab>(tabFromHash);
  const setTab = (next: Tab) => {
    setTabState(next);
    window.history.replaceState(null, "", next === "overview" ? window.location.pathname : `#${next}`);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Simulation"
        description="Pick a strategy, run it, and watch the hospital minute by minute."
        actions={
          output &&
          !output.isPlaceholder && (
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={openSummary}>
                <ClipboardList size={15} aria-hidden /> Run summary
              </Button>
              <Button variant="secondary" onClick={() => downloadCsv(`waitless-${output.strategy}-run.csv`, outcomesToCsv(output))}>
                <Download size={15} aria-hidden /> Export CSV
              </Button>
            </div>
          )
        }
      />

      <SimulationControls onRan={() => liveReplay && setTab("charts")} />

      {output && (
        <>
          <LiveBar />
          <p className="-mt-2 text-xs text-slate-500">
            {STRATEGY_LABELS[output.strategy]} · planned {output.metrics.configured_duration} min · finished at minute {output.metrics.actual_completion_time}
            {output.params.emergencySurge ? ` · surge from minute ${output.params.surgeStart}` : ""}
            {output.params.resourceFailure ? ` · ${RESOURCE_LABELS[output.params.failedResource].toLowerCase()} failure at minute ${output.params.failureStart}` : ""}
            {current?.createdAt ? ` · run ${new Date(current.createdAt).toLocaleString()}` : ""}
          </p>
          <LivePatientForm />
        </>
      )}

      <div>
        <Tabs label="Simulation results" value={tab} onChange={setTab} tabs={TABS} />
        <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="mt-5 space-y-5">
          {tab === "overview" && (
            <>
              {output && !output.isPlaceholder && <p className="text-[15px] text-slate-700">{summarise(output)}</p>}
              {output?.isPlaceholder && <Notice tone="yellow">{PLACEHOLDER_NOTICE}</Notice>}
              <MetricsCards output={output} />
              {output && (
                <Card title="Warnings and bottlenecks">
                  <WarningsList warnings={output.warnings} />
                </Card>
              )}
            </>
          )}
          {tab === "hospital" && <HospitalView output={output} viewTime={viewTime} setViewTime={setViewTime} staff={staff} resources={resources} />}
          {tab === "charts" && <ResultsCharts output={output} viewTime={viewTime} />}
          {tab === "compare" && <StrategyComparison />}
          {tab === "algorithms" && <Algorithms />}
        </div>
      </div>
    </div>
  );
}
