import { RESOURCE_LABELS } from "./resources";
import { STRATEGIES, STRATEGY_LABELS } from "./policies";
import type { Strategy, SimulationOutput } from "./types";

export type BestKey = "treated" | "avgWait" | "criticalWait" | "maxWait" | "remaining";

export interface ComparisonRow {
  strategy: Strategy;
  label: string;
  treated: number;
  avgWait: number;
  criticalWait: number;
  maxWait: number;
  icuUtilization: number;
  remaining: number;
}

export interface Comparison {
  rows: ComparisonRow[];
  /** Strategies sharing the best value per category (empty when all are equal). */
  best: Record<BestKey, Strategy[]>;
  /** Plain-language findings computed from the metrics above. */
  recommendations: string[];
}

const EPS = 1e-9;

function bestOf(rows: ComparisonRow[], key: BestKey, higherIsBetter: boolean): Strategy[] {
  const values = rows.map((r) => r[key]);
  const target = higherIsBetter ? Math.max(...values) : Math.min(...values);
  if (values.every((v) => Math.abs(v - target) < EPS)) return []; // nothing to highlight
  return rows.filter((r) => Math.abs(r[key] - target) < EPS).map((r) => r.strategy);
}

const names = (list: Strategy[]) => list.map((s) => STRATEGY_LABELS[s]).join(" / ");
const f1 = (n: number) => n.toFixed(1);

export function compareStrategies(outputs: Record<Strategy, SimulationOutput>): Comparison {
  const rows: ComparisonRow[] = STRATEGIES.map((strategy) => {
    const m = outputs[strategy].metrics;
    return {
      strategy,
      label: STRATEGY_LABELS[strategy],
      treated: m.patients_treated,
      avgWait: m.average_wait,
      criticalWait: m.critical_wait,
      maxWait: m.maximum_wait,
      icuUtilization: m.resource_utilization.icu_bed,
      remaining: m.patients_remaining,
    };
  });

  const best: Comparison["best"] = {
    treated: bestOf(rows, "treated", true),
    avgWait: bestOf(rows, "avgWait", false),
    criticalWait: bestOf(rows, "criticalWait", false),
    maxWait: bestOf(rows, "maxWait", false),
    remaining: bestOf(rows, "remaining", false),
  };

  const recommendations: string[] = [];
  const row = (s: Strategy) => rows.find((r) => r.strategy === s)!;

  if (best.criticalWait.length > 0) {
    recommendations.push(
      `Lowest critical-patient wait: ${names(best.criticalWait)} (${f1(row(best.criticalWait[0]).criticalWait)} min average).`,
    );
  }
  if (best.maxWait.length > 0) {
    recommendations.push(
      `Lowest maximum wait: ${names(best.maxWait)} (${row(best.maxWait[0]).maxWait} min) — the fairest outcome for the longest-waiting patient.`,
    );
  }
  if (best.treated.length > 0) {
    recommendations.push(
      `Most patients treated within the horizon: ${names(best.treated)} (${row(best.treated[0]).treated}).`,
    );
  }

  const dyn = row("dynamic");
  const urg = row("urgency");
  const fcfs = row("fcfs");
  if (Math.abs(dyn.maxWait - urg.maxWait) > EPS || Math.abs(dyn.criticalWait - urg.criticalWait) > EPS) {
    recommendations.push(
      `Dynamic Priority vs Urgency Only: maximum wait ${dyn.maxWait} vs ${urg.maxWait} min, critical wait ${f1(dyn.criticalWait)} vs ${f1(urg.criticalWait)} min.`,
    );
  } else {
    recommendations.push(
      "Dynamic Priority and Urgency Only produced identical results for this dataset — waiting time never outweighed an urgency gap. Try raising the waiting weight (β) in the simulation controls.",
    );
  }
  if (Math.abs(dyn.criticalWait - fcfs.criticalWait) > EPS) {
    const change = ((fcfs.criticalWait - dyn.criticalWait) / Math.max(fcfs.criticalWait, EPS)) * 100;
    recommendations.push(
      `Compared with First-Come, First-Served, Dynamic Priority ${change >= 0 ? "cut" : "raised"} critical-patient wait by ${Math.abs(change).toFixed(0)}%.`,
    );
  }

  const bottleneck = outputs.dynamic.metrics.bottlenecks[0];
  if (bottleneck) {
    recommendations.push(
      `${RESOURCE_LABELS[bottleneck.resource]} were the binding resource for the most waiting (${bottleneck.blocked_patient_minutes} patient-minutes). Testing extra capacity there on the Resources page is the most direct next experiment.`,
    );
  }

  return { rows, best, recommendations };
}
