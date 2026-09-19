"use client";

import { Trophy } from "lucide-react";
import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CHART_COLORS } from "./ResultsCharts";
import { Card, EmptyState, Notice, cx, fmt1, pct0 } from "./ui";
import { useStore } from "@/lib/store";
import { toSimPatients } from "@/lib/runner";
import {
  STRATEGIES,
  STRATEGY_LABELS,
  compareStrategies,
  runAllStrategies,
  treatmentOrder,
  type Comparison,
} from "@/lib/simulation";

type Column = { key: keyof Comparison["rows"][number]; best?: keyof Comparison["best"]; header: string; render: (v: number) => string };

const COLUMNS: Column[] = [
  { key: "treated", best: "treated", header: "Treated", render: (v) => String(v) },
  { key: "avgWait", best: "avgWait", header: "Average wait", render: (v) => `${fmt1(v)} min` },
  { key: "criticalWait", best: "criticalWait", header: "Critical wait", render: (v) => `${fmt1(v)} min` },
  { key: "maxWait", best: "maxWait", header: "Max wait", render: (v) => `${v} min` },
  { key: "icuUtilization", header: "ICU utilization", render: (v) => pct0(v) },
  { key: "remaining", best: "remaining", header: "Patients remaining", render: (v) => String(v) },
  { key: "completion", best: "completion", header: "Completion time", render: (v) => `${v} min` },
  { key: "objective", best: "objective", header: "Objective score", render: (v) => fmt1(v) },
];

export function StrategyComparison() {
  const { patients, resources, resourcesSaved, params } = useStore();

  const result = useMemo(() => {
    const simPatients = toSimPatients(patients);
    if (simPatients.length === 0 || !resourcesSaved) return null;
    try {
      const outputs = runAllStrategies(simPatients, resources, params);
      return { outputs, comparison: compareStrategies(outputs) };
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Comparison failed." };
    }
  }, [patients, resources, resourcesSaved, params]);

  return (
    <Card
      title="Strategy Lab"
      description="The same patients, resources, surge and failure settings are run through all three strategies. Results are calculated live from the current data."
    >
      {!result ? (
        <EmptyState>Add patients and save a resource configuration to compare strategies.</EmptyState>
      ) : "error" in result ? (
        <Notice tone="red">{result.error}</Notice>
      ) : (
        <div className="space-y-5">
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[820px] text-left text-sm">
              <thead className="border-b border-slate-200 text-xs text-slate-600 uppercase">
                <tr>
                  <th scope="col" className="px-2 py-2">Strategy</th>
                  {COLUMNS.map((c) => (
                    <th key={c.header} scope="col" className="px-2 py-2">{c.header}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {result.comparison.rows.map((row) => (
                  <tr key={row.strategy}>
                    <th scope="row" className="px-2 py-2 font-semibold">{row.label}</th>
                    {COLUMNS.map((c) => {
                      const isBest = c.best ? result.comparison.best[c.best].includes(row.strategy) : false;
                      return (
                        <td key={c.header} className={cx("px-2 py-2 tabular-nums", isBest && "bg-emerald-100 font-semibold text-emerald-900")}>
                          {c.render(row[c.key] as number)}
                          {isBest && (
                            <span className="ml-1 inline-flex items-center align-middle" title="Best in this category">
                              <Trophy size={12} aria-hidden />
                              <span className="sr-only"> best</span>
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-1 text-xs text-slate-500">Green marks the best value per category; ICU utilization is informational and not ranked.</p>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div role="img" aria-label="Average, critical and maximum wait by strategy" className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={result.comparison.rows.map((r) => ({ name: r.label, "Average wait": +r.avgWait.toFixed(1), "Critical wait": +r.criticalWait.toFixed(1), "Max wait": r.maxWait }))} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#475569" }} />
                  <YAxis unit="m" tick={{ fontSize: 12, fill: "#475569" }} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="Average wait" fill={CHART_COLORS.blue} isAnimationActive={false} />
                  <Bar dataKey="Critical wait" fill={CHART_COLORS.red} isAnimationActive={false} />
                  <Bar dataKey="Max wait" fill={CHART_COLORS.grey} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-slate-900">Findings from these calculated metrics</h3>
              <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-slate-800">
                {result.comparison.recommendations.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </div>
          </div>

          {result.comparison.sameOrderMessage && (
            <Notice tone="blue">
              {result.comparison.sameOrderMessage} ({result.comparison.sameOrder.map(([a, b]) => `${STRATEGY_LABELS[a]} = ${STRATEGY_LABELS[b]}`).join("; ")})
            </Notice>
          )}

          <div>
            <h3 className="text-sm font-semibold text-slate-900">Treatment order (first 15 started)</h3>
            <p className="text-xs text-slate-500">Highlighted patients start in a different position than under First-Come, First-Served — this is where the policy changes the order.</p>
            <div className="mt-2 space-y-2">
              {STRATEGIES.map((s) => {
                const order = treatmentOrder(result.outputs[s]).slice(0, 15);
                const base = treatmentOrder(result.outputs.fcfs);
                return (
                  <div key={s} className="flex flex-wrap items-center gap-1 text-xs">
                    <span className="w-44 shrink-0 font-semibold text-slate-800">{STRATEGY_LABELS[s]}</span>
                    {order.map((id, i) => (
                      <span key={id} className={cx("rounded border px-1.5 py-0.5 tabular-nums", s !== "fcfs" && base[i] !== id ? "border-blue-400 bg-blue-50 font-semibold text-blue-900" : "border-slate-200 bg-white text-slate-700")}>
                        {id}
                      </span>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="grid gap-3 text-sm md:grid-cols-3">
            <div className="rounded-md border border-slate-200 p-3"><strong>First-Come, First-Served</strong> may be fair by arrival order but can delay urgent patients behind minor cases.</div>
            <div className="rounded-md border border-slate-200 p-3"><strong>Urgency Only</strong> prioritises critical cases but can cause long waits for low-urgency patients.</div>
            <div className="rounded-md border border-slate-200 p-3"><strong>Dynamic Priority</strong> aims to balance urgency and waiting time, so long waits gradually raise a patient’s rank.</div>
          </div>
          <p className="text-xs text-slate-600">These are results of a simplified model on synthetic data. No strategy is clinically validated.</p>
        </div>
      )}
    </Card>
  );
}
