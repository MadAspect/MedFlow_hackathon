"use client";

import { CircleCheck, Info, Trophy, TriangleAlert } from "lucide-react";
import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CHART_COLORS } from "./ResultsCharts";
import { Badge, Card, EmptyState, Notice, cx, fmt1 } from "./ui";
import { useStore } from "@/lib/store";
import { toSimPatients } from "@/lib/runner";
import {
  DECISION_CRITERIA,
  STRATEGIES,
  STRATEGY_LABELS,
  TIE_FRACTION,
  TIE_MIN_MINUTES,
  analyse,
  treatmentOrder,
  type AdviceTone,
  type BestKey,
  type ComparisonRow,
} from "@/lib/simulation";

type Column = {
  key: Exclude<keyof ComparisonRow, "strategy" | "label" | "treated">;
  best: BestKey;
  header: string;
  sub: string;
  unit: "min" | "count";
};

const adviceStyle: Record<AdviceTone, { box: string; Icon: typeof Info; label: string }> = {
  red: { box: "border-red-500 bg-red-50 text-red-900", Icon: TriangleAlert, label: "Problem" },
  yellow: { box: "border-amber-500 bg-amber-50 text-amber-900", Icon: TriangleAlert, label: "Watch out" },
  green: { box: "border-emerald-600 bg-emerald-50 text-emerald-900", Icon: CircleCheck, label: "Do this" },
  blue: { box: "border-blue-500 bg-blue-50 text-blue-900", Icon: Info, label: "Good to know" },
};

const SERIES_COLORS = { fcfs: CHART_COLORS.grey, urgency: CHART_COLORS.red, dynamic: CHART_COLORS.blue, hazard: CHART_COLORS.green } as const;

function Change({ delta, suffix = "" }: { delta: number; suffix?: string }) {
  if (Math.abs(delta) < 0.05) return <span className="block text-xs text-slate-500">no change</span>;
  const good = delta < 0;
  return (
    <span className={cx("block text-xs font-medium", good ? "text-emerald-800" : "text-red-800")}>
      {good ? "−" : "+"}
      {fmt1(Math.abs(delta))}
      {suffix}
    </span>
  );
}

export function StrategyComparison() {
  const { patients, resources, resourcesSaved, params } = useStore();

  const result = useMemo(() => {
    const simPatients = toSimPatients(patients);
    if (simPatients.length === 0 || !resourcesSaved) return null;
    try {
      return analyse(simPatients, resources, params);
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Comparison failed." };
    }
  }, [patients, resources, resourcesSaved, params]);

  const columns: Column[] = [
    { key: "breaches", best: "breaches", header: "Past safety limit", sub: `patients waiting over ${params.safetyThreshold} min`, unit: "count" },
    { key: "criticalWait", best: "criticalWait", header: "Critical patients’ wait", sub: `average, urgency ≥ ${params.criticalUrgency}`, unit: "min" },
    { key: "maxWait", best: "maxWait", header: "Longest wait", sub: "any single patient", unit: "min" },
    { key: "avgWait", best: "avgWait", header: "Average wait", sub: "all patients", unit: "min" },
    { key: "completion", best: "completion", header: "Finish time", sub: "last patient done", unit: "min" },
    { key: "remaining", best: "remaining", header: "Untreated", sub: "should be 0", unit: "count" },
  ];

  return (
    <Card
      title="Compare strategies and get advice"
      description="All four strategies on the same patients and settings. Calculated, not AI-generated."
    >
      {!result ? (
        <EmptyState>Add patients and save a resource configuration to compare strategies.</EmptyState>
      ) : "error" in result ? (
        <Notice tone="red">{result.error}</Notice>
      ) : (
        <div className="space-y-6">
          {STRATEGIES.map(
            (s) =>
              !result.outputs[s].completed && (
                <Notice key={s} tone="red">
                  {STRATEGY_LABELS[s]}: simulation error — not all patients were treated. {result.outputs[s].error}
                </Notice>
              ),
          )}

          {/* 1. Recommendation */}
          <div className={cx("rounded-lg border-2 p-4", result.verdict.tie ? "border-blue-300 bg-blue-50" : "border-emerald-300 bg-emerald-50")}>
            <p className="text-xs font-semibold tracking-wide text-slate-700 uppercase">Recommended strategy</p>
            <p className="mt-1 text-xl font-bold text-slate-900">{STRATEGY_LABELS[result.verdict.strategy]}</p>
            <p className="mt-1 text-sm text-slate-800">{result.verdict.headline}</p>
            {result.verdict.details.map((d) => (
              <p key={d} className="mt-1 text-sm text-slate-700">
                {d}
              </p>
            ))}
            <p className="mt-2 text-xs text-slate-600">
              Scheduling does not create capacity — it decides <em>who</em> waits. The biggest gains usually come from the advice below.
            </p>
          </div>

          {/* 2. Advice */}
          <div>
            <h3 className="text-base font-semibold text-slate-900">How to make this system more efficient</h3>
            <p className="text-sm text-slate-600">
              Calculated from the recommended strategy’s run. Each suggestion is tested by re-running the simulation, not guessed.
            </p>
            {result.advice.length === 0 ? (
              <p className="mt-2 text-sm text-slate-600">Nothing to flag for this scenario.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {result.advice.map((item) => {
                  const { box, Icon, label } = adviceStyle[item.tone];
                  return (
                    <li key={item.id} className={cx("flex gap-3 rounded-md border-l-4 p-3", box)}>
                      <Icon size={18} aria-hidden className="mt-0.5 shrink-0" />
                      <div>
                        <p className="text-sm font-semibold">
                          <span className="sr-only">{label}: </span>
                          {item.title}
                        </p>
                        <p className="mt-0.5 text-sm text-slate-800">{item.detail}</p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* 3. Resource what-if */}
          <div>
            <h3 className="text-base font-semibold text-slate-900">What if you add one more?</h3>
            <p className="text-sm text-slate-600">
              Each row adds one unit of a single resource and re-runs {STRATEGY_LABELS[result.recommendation.strategy]} to completion. Only five configurations are tested — this is not an exhaustive search.
            </p>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[520px] text-left text-sm">
                <thead className="border-b border-slate-200 text-xs text-slate-600 uppercase">
                  <tr>
                    <th scope="col" className="px-2 py-2">Change</th>
                    <th scope="col" className="px-2 py-2 text-right">Total waiting</th>
                    <th scope="col" className="px-2 py-2 text-right">Critical patients’ waiting</th>
                    <th scope="col" className="px-2 py-2 text-right">Last patient finishes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  <tr>
                    <th scope="row" className="px-2 py-2 font-medium">Current setup</th>
                    <td className="px-2 py-2 text-right tabular-nums">{fmt1(result.recommendation.baseline.metrics.total_waiting_time)} min</td>
                    <td className="px-2 py-2 text-right tabular-nums">{fmt1(result.recommendation.baseline.metrics.critical_wait_total)} min</td>
                    <td className="px-2 py-2 text-right tabular-nums">minute {result.recommendation.baseline.metrics.actual_completion_time}</td>
                  </tr>
                  {[...result.recommendation.candidates]
                    .sort((a, b) => a.objective - b.objective)
                    .map((c) => {
                      const isBest = result.recommendation.best?.resource === c.resource;
                      return (
                        <tr key={c.resource} className={cx(isBest && "bg-emerald-100 font-semibold text-emerald-900")}>
                          <th scope="row" className="px-2 py-2 font-medium">
                            {c.label}
                            {isBest && <span className="ml-1 text-xs">(best tested)</span>}
                          </th>
                          <td className="px-2 py-2 text-right tabular-nums">
                            {fmt1(c.output.metrics.total_waiting_time)} min
                            <Change delta={-c.totalWaitSaved} suffix=" min" />
                          </td>
                          <td className="px-2 py-2 text-right tabular-nums">
                            {fmt1(c.output.metrics.critical_wait_total)} min
                            <Change delta={-c.criticalWaitSaved} suffix=" min" />
                          </td>
                          <td className="px-2 py-2 text-right tabular-nums">
                            minute {c.output.metrics.actual_completion_time}
                            <Change delta={-c.completionSaved} suffix=" min" />
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>

          {/* 4. Side-by-side comparison */}
          <div>
            <h3 className="text-base font-semibold text-slate-900">Side by side</h3>
            <p className="text-sm text-slate-600">
              Lower is better in every column. Green marks the best value; the small numbers show the change compared with the baseline (First-Come, First-Served).
            </p>
            <div className="relative mt-2 overflow-x-auto">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="border-b border-slate-200 align-bottom text-xs text-slate-600">
                  <tr>
                    <th scope="col" className="px-2 py-2 uppercase">Strategy</th>
                    {columns.map((c) => (
                      <th key={c.header} scope="col" className="px-2 py-2 font-medium">
                        <span className="block text-slate-800 uppercase">{c.header}</span>
                        <span className="block font-normal">{c.sub}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {result.comparison.rows.map((row) => {
                    const base = result.comparison.rows[0];
                    return (
                      <tr key={row.strategy}>
                        <th scope="row" className="px-2 py-2 font-semibold">
                          {row.label}
                          {row.strategy === "fcfs" && (
                            <span className="mt-1 block">
                              <Badge tone="blue">Most common · baseline</Badge>
                            </span>
                          )}
                          {row.strategy === result.verdict.strategy && !result.verdict.tie && (
                            <span className="mt-1 block">
                              <Badge tone="green">Recommended</Badge>
                            </span>
                          )}
                        </th>
                        {columns.map((c) => {
                          const value = row[c.key];
                          const isBest = result.comparison.best[c.best].includes(row.strategy);
                          const delta = value - base[c.key];
                          return (
                            <td key={c.header} className={cx("px-2 py-2 tabular-nums", isBest && "bg-emerald-100 font-semibold text-emerald-900")}>
                              {c.unit === "min" ? `${fmt1(value)} min` : value}
                              {isBest && (
                                <span className="ml-1 inline-flex items-center align-middle" title="Best in this column">
                                  <Trophy size={12} aria-hidden />
                                  <span className="sr-only"> best</span>
                                </span>
                              )}
                              {row.strategy !== "fcfs" && <Change delta={delta} suffix={c.unit === "min" ? " min" : ""} />}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {result.comparison.sameOrderMessage && (
              <Notice tone="blue" className="mt-2">
                {result.comparison.sameOrderMessage} ({result.comparison.sameOrder.map(([a, b]) => `${STRATEGY_LABELS[a]} = ${STRATEGY_LABELS[b]}`).join("; ")})
              </Notice>
            )}
          </div>

          {/* 5. Who waits */}
          <div>
            <h3 className="text-base font-semibold text-slate-900">Who waits under each strategy?</h3>
            <p className="text-sm text-slate-600">
              Average wait for each urgency level (5 = most urgent). A strategy that helps urgent patients usually costs the low-urgency ones — this shows the price.
            </p>
            <div role="img" aria-label="Average wait for each urgency level under each strategy" className="mt-2 h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={result.urgencyWaits.map((r) => ({
                    name: `Urgency ${r.urgency} (${r.patients})`,
                    [STRATEGY_LABELS.fcfs]: +r.average.fcfs.toFixed(1),
                    [STRATEGY_LABELS.urgency]: +r.average.urgency.toFixed(1),
                    [STRATEGY_LABELS.dynamic]: +r.average.dynamic.toFixed(1),
                    [STRATEGY_LABELS.hazard]: +r.average.hazard.toFixed(1),
                  }))}
                  margin={{ top: 8, right: 12, bottom: 0, left: -12 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-line)" />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: "var(--chart-axis-strong)" }} />
                  <YAxis unit="m" tick={{ fontSize: 12, fill: "var(--chart-axis-strong)" }} />
                  <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid var(--chart-line)", background: "var(--surface)", color: "var(--foreground)", fontSize: 12 }} cursor={{ fill: "var(--chart-cursor)" }} />
                  <Legend wrapperStyle={{ fontSize: 12, color: "var(--chart-axis-strong)" }} />
                  {STRATEGIES.map((s) => (
                    <Bar key={s} dataKey={STRATEGY_LABELS[s]} fill={SERIES_COLORS[s]} isAnimationActive={false} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="text-xs text-slate-500">The number in brackets is how many patients have that urgency.</p>
          </div>

          {/* 6. Treatment order */}
          <div>
            <h3 className="text-base font-semibold text-slate-900">Treatment order (first 15 started)</h3>
            <p className="text-xs text-slate-500">Highlighted patients start in a different position than under First-Come, First-Served — this is where the policy changes the order.</p>
            <div className="mt-2 space-y-2">
              {STRATEGIES.map((s) => {
                const order = treatmentOrder(result.outputs[s]).slice(0, 15);
                const base = treatmentOrder(result.outputs.fcfs);
                return (
                  <div key={s} className="flex flex-wrap items-center gap-1 text-xs">
                    <span className="w-44 shrink-0 font-semibold text-slate-800">{STRATEGY_LABELS[s]}</span>
                    {order.map((id, i) => (
                      <span key={id} className={cx("rounded border px-1.5 py-0.5 tabular-nums", s !== "fcfs" && base[i] !== id ? "border-blue-400 bg-blue-50 font-semibold text-blue-900" : "border-slate-200 bg-surface text-slate-700")}>
                        {id}
                      </span>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>

          {/* 7. Method */}
          <details className="rounded-md border border-slate-200 p-3 text-sm">
            <summary className="cursor-pointer font-medium text-slate-800">How the recommendation is decided</summary>
            <p className="mt-2 text-slate-700">The strategies are checked in this order. Each check only separates strategies that are still tied on the checks above it:</p>
            <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-slate-700">
              {DECISION_CRITERIA.map((c) => (
                <li key={c.key}>{c.title}</li>
              ))}
            </ol>
            <p className="mt-2 text-slate-700">
              Wait times within {TIE_MIN_MINUTES} minute or {TIE_FRACTION * 100}% of the best count as tied. If nothing separates the strategies, the simplest one — First-Come, First-Served — is kept.
            </p>
            <p className="mt-2 text-slate-700">
              Why not a single score? A blended number hides trade-offs and depends on weights someone picked. A strategy can win it while making low-urgency patients wait far longer, so the safety-limit check comes first and the chart above shows who pays.
            </p>
          </details>

          <p className="text-xs text-slate-600">These are results of a simplified model on synthetic data. No strategy is clinically validated.</p>
        </div>
      )}
    </Card>
  );
}
