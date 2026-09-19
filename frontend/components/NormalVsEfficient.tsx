"use client";

import { useMemo } from "react";
import { Badge, Card, EmptyState, Notice, cx, fmt1 } from "./ui";
import { useStore } from "@/lib/store";
import { toSimPatients } from "@/lib/runner";
import {
  BEST_CONFIG_LABEL,
  SAME_ORDER_MESSAGE,
  STRATEGY_LABELS,
  compareNormalVsEfficient,
  recommendResource,
  type ComparisonMetricRow,
} from "@/lib/simulation";

const sign = (n: number) => (n > 0 ? "+" : n < 0 ? "−" : "");

function differenceText(row: ComparisonMetricRow): string {
  if (row.difference === null) return "—";
  const d = row.difference;
  const abs = Math.abs(d);
  switch (row.format) {
    case "percent":
      return `${sign(d)}${(abs * 100).toFixed(0)} pts`;
    case "minutes":
      return `${sign(d)}${fmt1(abs)} min`;
    default:
      return `${sign(d)}${fmt1(abs)}`;
  }
}

function improvementText(row: ComparisonMetricRow): string | null {
  if (row.improvementPct === null || row.normal === null || row.difference === null) return null;
  if (row.difference === 0) return "no change";
  // The formula divides by max(|normal|, 0.0001); a zero baseline gives a meaningless percentage.
  if (Math.abs(row.normal) < 0.0001) return "n/a (baseline is 0)";
  const p = row.improvementPct;
  return `${p >= 0 ? "+" : "−"}${Math.abs(p).toFixed(1)}% ${p >= 0 ? "better" : "worse"}`;
}

export function NormalVsEfficient() {
  const { patients, resources, resourcesSaved, params } = useStore();

  const result = useMemo(() => {
    const simPatients = toSimPatients(patients);
    if (simPatients.length === 0 || !resourcesSaved) return null;
    try {
      return {
        comparison: compareNormalVsEfficient(simPatients, resources, params),
        recommendation: recommendResource(simPatients, resources, params),
      };
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Comparison failed." };
    }
  }, [patients, resources, resourcesSaved, params]);

  return (
    <Card
      title="Normal vs efficient system"
      description="The normal system is First-Come, First-Served; the efficient system is Dynamic Priority. Both run separately on identical patients and resources, and every value is calculated from those two runs. No AI is used."
    >
      {!result ? (
        <EmptyState>Add patients and save a resource configuration to compare the two systems.</EmptyState>
      ) : "error" in result ? (
        <Notice tone="red">{result.error}</Notice>
      ) : (
        <div className="space-y-5">
          {[result.comparison.normal, result.comparison.efficient].map(
            (out) =>
              !out.completed && (
                <Notice key={out.strategy} tone="red">
                  {STRATEGY_LABELS[out.strategy]}: Simulation error — not all patients were treated. {out.error}
                </Notice>
              ),
          )}

          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="border-b border-slate-200 text-xs text-slate-600 uppercase">
                <tr>
                  <th scope="col" className="px-2 py-2">Metric</th>
                  <th scope="col" className="px-2 py-2 text-right">Normal system</th>
                  <th scope="col" className="px-2 py-2 text-right">Efficient system</th>
                  <th scope="col" className="px-2 py-2 text-right">Difference</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {result.comparison.rows.map((row) => {
                  const improvement = improvementText(row);
                  const good = row.improvementPct !== null && row.improvementPct > 0;
                  const bad = row.improvementPct !== null && row.improvementPct < 0;
                  return (
                    <tr key={row.key}>
                      <th scope="row" className="px-2 py-2 font-medium">{row.label}</th>
                      <td className="px-2 py-2 text-right tabular-nums">{row.normalText}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{row.efficientText}</td>
                      <td className={cx("px-2 py-2 text-right tabular-nums", good && "text-emerald-800", bad && "text-red-800")}>
                        {differenceText(row)}
                        {improvement && <span className="block text-xs">{improvement}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="mt-1 text-xs text-slate-500">
              Improvement = (normal − efficient) ÷ max(|normal|, 0.0001) × 100 for lower-is-better metrics, and (efficient − normal) ÷ max(|normal|, 0.0001) × 100 for higher-is-better metrics.
              Objective score = 1.0·total wait + 4.0·critical wait + 10000·patients remaining + 10000·resource overload + 0.5·maximum wait (lower is better). Utilization is measured over the longer of the planned duration and the actual completion time.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge tone={result.comparison.better === "efficient" ? "green" : "grey"}>
              {result.comparison.bestLabel}
            </Badge>
            <span>
              {result.comparison.better === "efficient"
                ? `${STRATEGY_LABELS.dynamic} has the lower objective score in this scenario.`
                : result.comparison.better === "normal"
                  ? `${STRATEGY_LABELS.fcfs} has the lower objective score in this scenario; Dynamic Priority did not improve it here.`
                  : "Both systems have the same objective score in this scenario."}
            </span>
          </div>
          {result.comparison.sameOrder && <Notice tone="blue">{SAME_ORDER_MESSAGE}</Notice>}

          <div>
            <h3 className="text-sm font-semibold text-slate-900">Explanation (fixed template, filled from the two runs)</h3>
            <p className="mt-1 whitespace-pre-line text-sm text-slate-800">{result.comparison.explanation}</p>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-slate-900">{BEST_CONFIG_LABEL}</h3>
            <p className="text-xs text-slate-600">
              Adds one unit of each resource in turn, re-runs the full Dynamic Priority simulation to completion and compares objective scores. Five configurations are tested; this is not an exhaustive search.
            </p>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[520px] text-left text-sm">
                <thead className="border-b border-slate-200 text-xs text-slate-600 uppercase">
                  <tr>
                    <th scope="col" className="px-2 py-2">Candidate</th>
                    <th scope="col" className="px-2 py-2 text-right">Completion</th>
                    <th scope="col" className="px-2 py-2 text-right">Objective score</th>
                    <th scope="col" className="px-2 py-2 text-right">vs current</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  <tr>
                    <th scope="row" className="px-2 py-2 font-medium">Current configuration</th>
                    <td className="px-2 py-2 text-right tabular-nums">{result.recommendation.baseline.metrics.actual_completion_time} min</td>
                    <td className="px-2 py-2 text-right tabular-nums">{fmt1(result.recommendation.baseline.metrics.objective_score)}</td>
                    <td className="px-2 py-2 text-right">—</td>
                  </tr>
                  {result.recommendation.candidates.map((c) => {
                    const isBest = result.recommendation.best?.resource === c.resource;
                    return (
                      <tr key={c.resource} className={cx(isBest && "bg-emerald-100 font-semibold text-emerald-900")}>
                        <th scope="row" className="px-2 py-2 font-medium">
                          {c.label}
                          {isBest && <span className="ml-1 text-xs">(best tested)</span>}
                        </th>
                        <td className="px-2 py-2 text-right tabular-nums">{c.output.metrics.actual_completion_time} min</td>
                        <td className="px-2 py-2 text-right tabular-nums">{fmt1(c.objective)}</td>
                        <td className="px-2 py-2 text-right tabular-nums">
                          {Math.abs(result.recommendation.baseline.metrics.objective_score) < 0.0001 && c.objectiveGain !== 0
                            ? "n/a"
                            : `${c.improvementPct >= 0 ? "+" : "−"}${Math.abs(c.improvementPct).toFixed(1)}%`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-sm">
              {result.recommendation.best
                ? `${BEST_CONFIG_LABEL}: ${result.recommendation.best.label} (objective ${fmt1(result.recommendation.best.objective)} vs ${fmt1(result.recommendation.baseline.metrics.objective_score)} now).`
                : "No single added unit lowered the objective score, so no change is suggested from the tested configurations."}
            </p>
          </div>
        </div>
      )}
    </Card>
  );
}
