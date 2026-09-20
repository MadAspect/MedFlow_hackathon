import { SAME_ORDER_MESSAGE } from "./efficiency";
import { treatmentOrder } from "./metrics";
import { STRATEGIES, STRATEGY_LABELS } from "./policies";
import type { Strategy, SimulationOutput } from "./types";

export type BestKey =
  | "treated"
  | "avgWait"
  | "criticalWait"
  | "maxWait"
  | "breaches"
  | "remaining"
  | "completion";

export interface ComparisonRow {
  strategy: Strategy;
  label: string;
  treated: number;
  avgWait: number;
  criticalWait: number;
  maxWait: number;
  breaches: number;
  remaining: number;
  completion: number;
}

export interface Comparison {
  rows: ComparisonRow[];
  best: Record<BestKey, Strategy[]>;
  sameOrder: [Strategy, Strategy][];
  sameOrderMessage: string | null;
}

const EPS = 1e-9;

function bestOf(rows: ComparisonRow[], key: BestKey, higherIsBetter: boolean): Strategy[] {
  const values = rows.map((r) => r[key]);
  const target = higherIsBetter ? Math.max(...values) : Math.min(...values);
  if (values.every((v) => Math.abs(v - target) < EPS)) return [];
  return rows.filter((r) => Math.abs(r[key] - target) < EPS).map((r) => r.strategy);
}

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
      breaches: m.safety_threshold_breaches,
      remaining: m.patients_remaining,
      completion: m.actual_completion_time,
    };
  });

  const best: Comparison["best"] = {
    treated: bestOf(rows, "treated", true),
    avgWait: bestOf(rows, "avgWait", false),
    criticalWait: bestOf(rows, "criticalWait", false),
    maxWait: bestOf(rows, "maxWait", false),
    breaches: bestOf(rows, "breaches", false),
    remaining: bestOf(rows, "remaining", false),
    completion: bestOf(rows, "completion", false),
  };

  const sameOrder: [Strategy, Strategy][] = [];
  for (let i = 0; i < STRATEGIES.length; i++) {
    for (let j = i + 1; j < STRATEGIES.length; j++) {
      const a = treatmentOrder(outputs[STRATEGIES[i]]).join("|");
      const b = treatmentOrder(outputs[STRATEGIES[j]]).join("|");
      if (a === b) sameOrder.push([STRATEGIES[i], STRATEGIES[j]]);
    }
  }

  return {
    rows,
    best,
    sameOrder,
    sameOrderMessage: sameOrder.length > 0 ? SAME_ORDER_MESSAGE : null,
  };
}
