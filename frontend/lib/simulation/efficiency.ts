import { runSimulation } from "./engine";
import { RESOURCE_LABELS, RESOURCE_SINGULAR, cloneResourceSet } from "./resources";
import { STRATEGY_LABELS } from "./policies";
import { treatmentOrder } from "./metrics";
import {
  RESOURCE_KEYS,
  type ResourceKey,
  type ResourceSet,
  type SimParams,
  type SimPatient,
  type SimulationOutput,
} from "./types";

/**
 * Normal vs efficient system.
 *
 *   normal    = First-Come, First-Served
 *   efficient = Dynamic Priority
 *
 * Both are ordinary runs of the same deterministic engine on identical input:
 * same patients, same resources, same surge/failure settings. Only the
 * patient-selection policy differs. Nothing here calls an AI model or the network.
 */

export const BEST_SYSTEM_LABEL = "Best system within the tested scheduling policies.";
export const SAME_ORDER_MESSAGE = "These strategies produced the same order for this scenario.";
export const BEST_CONFIG_LABEL = "Best tested configuration";

/** Guards the improvement formula against a zero baseline. */
const EPSILON = 0.0001;

export type Direction = "lower" | "higher" | "info";

export interface ComparisonMetricRow {
  key: string;
  label: string;
  direction: Direction;
  /** Numeric values, or null for text rows (bottleneck). */
  normal: number | null;
  efficient: number | null;
  /** efficient − normal (null for text rows). */
  difference: number | null;
  /** Percentage improvement from the formulas below (null for text rows). */
  improvementPct: number | null;
  /** Display text for the two values (numbers are formatted, text is passed through). */
  normalText: string;
  efficientText: string;
  format: "count" | "minutes" | "percent" | "score" | "text";
}

export interface NormalVsEfficient {
  normal: SimulationOutput;
  efficient: SimulationOutput;
  rows: ComparisonMetricRow[];
  /** Deterministic template text, filled from the two runs. */
  explanation: string;
  /** True when both policies started patients in exactly the same order. */
  sameOrder: boolean;
  /** Which system has the lower objective score ("tie" when equal). */
  better: "normal" | "efficient" | "tie";
  bestLabel: string;
}

/**
 * Percentage improvement of `efficient` over `normal`.
 *   lower is better:   (normal − efficient) / max(|normal|, 0.0001) · 100
 *   higher is better:  (efficient − normal) / max(|normal|, 0.0001) · 100
 */
export function improvementPercent(
  normal: number,
  efficient: number,
  direction: "lower" | "higher",
): number {
  const gain = direction === "lower" ? normal - efficient : efficient - normal;
  return (gain / Math.max(Math.abs(normal), EPSILON)) * 100;
}

const fmt1 = (n: number) => (Math.round(n * 10) / 10).toString();
const pct = (fraction: number) => `${(fraction * 100).toFixed(0)}%`;

function numericRow(
  key: string,
  label: string,
  direction: Direction,
  format: ComparisonMetricRow["format"],
  normal: number,
  efficient: number,
  text: (n: number) => string,
): ComparisonMetricRow {
  return {
    key,
    label,
    direction,
    normal,
    efficient,
    difference: efficient - normal,
    improvementPct: direction === "info" ? null : improvementPercent(normal, efficient, direction),
    normalText: text(normal),
    efficientText: text(efficient),
    format,
  };
}

function bottleneckLabel(out: SimulationOutput): string {
  const top = out.metrics.bottlenecks[0];
  return top ? RESOURCE_LABELS[top.resource] : "None (no patient waited for a resource)";
}

/** Fill the fixed explanation template from the two calculated runs. */
export function buildExplanation(normal: SimulationOutput, efficient: SimulationOutput): string {
  const n = normal.metrics;
  const e = efficient.metrics;
  return [
    `The normal system uses ${STRATEGY_LABELS.fcfs} scheduling.`,
    `The efficient system uses ${STRATEGY_LABELS.dynamic} scheduling, which combines urgency and waiting time.`,
    "",
    `The efficient system treated ${e.patients_treated} patients and completed the run in ${e.actual_completion_time} minutes.`,
    `Average waiting time changed from ${fmt1(n.average_wait)} to ${fmt1(e.average_wait)} minutes.`,
    `Critical-patient waiting time changed from ${fmt1(n.critical_wait_total)} to ${fmt1(e.critical_wait_total)} minutes.`,
    `The main bottleneck was ${bottleneckLabel(efficient)}.`,
  ].join("\n");
}

/** Run the normal (FCFS) and efficient (Dynamic Priority) systems on identical input. */
export function compareNormalVsEfficient(
  patients: SimPatient[],
  resources: ResourceSet,
  params: Partial<SimParams> = {},
): NormalVsEfficient {
  // Each run gets its own deep copy of the inputs, so no state can leak between them.
  const copyPatients = () =>
    patients.map((p) => ({ ...p, required_resources: { ...p.required_resources } }));
  const normal = runSimulation(copyPatients(), cloneResourceSet(resources), {
    ...params,
    strategy: "fcfs",
  });
  const efficient = runSimulation(copyPatients(), cloneResourceSet(resources), {
    ...params,
    strategy: "dynamic",
  });
  const n = normal.metrics;
  const e = efficient.metrics;

  const minutes = (v: number) => `${fmt1(v)} min`;
  const count = (v: number) => String(v);
  const utilRow = (key: ResourceKey, label: string) =>
    numericRow(
      `util_${key}`,
      label,
      "higher",
      "percent",
      n.resource_utilization[key],
      e.resource_utilization[key],
      pct,
    );

  const rows: ComparisonMetricRow[] = [
    numericRow("treated", "Patients treated", "higher", "count", n.patients_treated, e.patients_treated, count),
    numericRow("remaining", "Patients remaining", "lower", "count", n.patients_remaining, e.patients_remaining, count),
    numericRow("completion", "Actual completion time", "lower", "minutes", n.actual_completion_time, e.actual_completion_time, minutes),
    numericRow("total_wait", "Total waiting time", "lower", "minutes", n.total_waiting_time, e.total_waiting_time, minutes),
    numericRow("avg_wait", "Average waiting time", "lower", "minutes", n.average_wait, e.average_wait, minutes),
    numericRow("max_wait", "Maximum waiting time", "lower", "minutes", n.maximum_wait, e.maximum_wait, minutes),
    numericRow("critical_wait", "Critical-patient waiting time", "lower", "minutes", n.critical_wait_total, e.critical_wait_total, minutes),
    utilRow("doctor", "Doctor utilization"),
    utilRow("nurse", "Nurse utilization"),
    utilRow("bed", "Bed utilization"),
    utilRow("icu_bed", "ICU utilization"),
    utilRow("operating_room", "Operating-room utilization"),
    {
      key: "bottleneck",
      label: "Bottleneck resource",
      direction: "info",
      normal: null,
      efficient: null,
      difference: null,
      improvementPct: null,
      normalText: bottleneckLabel(normal),
      efficientText: bottleneckLabel(efficient),
      format: "text",
    },
    numericRow("objective", "Objective score", "lower", "score", n.objective_score, e.objective_score, fmt1),
  ];

  const better =
    e.objective_score < n.objective_score
      ? "efficient"
      : e.objective_score > n.objective_score
        ? "normal"
        : "tie";

  return {
    normal,
    efficient,
    rows,
    explanation: buildExplanation(normal, efficient),
    sameOrder: treatmentOrder(normal).join("|") === treatmentOrder(efficient).join("|"),
    better,
    bestLabel: BEST_SYSTEM_LABEL,
  };
}

export interface ResourceCandidate {
  resource: ResourceKey;
  label: string;
  /** Resources with one extra unit of `resource`. */
  configuration: ResourceSet;
  output: SimulationOutput;
  objective: number;
  /** baseline objective − candidate objective (positive = better). */
  objectiveGain: number;
  improvementPct: number;
}

export interface ResourceRecommendation {
  baseline: SimulationOutput;
  candidates: ResourceCandidate[];
  /** Candidate with the lowest objective score, only if it beats the baseline. */
  best: ResourceCandidate | null;
  label: string;
}

/**
 * Add one unit of each resource in turn, re-run the full Dynamic Priority
 * simulation (to completion) and compare objective scores with the baseline.
 * This tests five configurations; it is not an exhaustive search, so the
 * winner is only the best of those tested.
 */
export function recommendResource(
  patients: SimPatient[],
  resources: ResourceSet,
  params: Partial<SimParams> = {},
): ResourceRecommendation {
  const run = (config: ResourceSet) =>
    runSimulation(
      patients.map((p) => ({ ...p, required_resources: { ...p.required_resources } })),
      config,
      { ...params, strategy: "dynamic" },
    );
  const baseline = run(cloneResourceSet(resources));

  const candidates: ResourceCandidate[] = RESOURCE_KEYS.map((resource) => {
    const configuration = cloneResourceSet(resources);
    configuration[resource] += 1;
    const output = run(configuration);
    const objective = output.metrics.objective_score;
    return {
      resource,
      label: `+1 ${RESOURCE_SINGULAR[resource]}`,
      configuration,
      output,
      objective,
      objectiveGain: baseline.metrics.objective_score - objective,
      improvementPct: improvementPercent(baseline.metrics.objective_score, objective, "lower"),
    };
  });

  // Strict "<" keeps the first resource in RESOURCE_KEYS order on ties.
  let best: ResourceCandidate | null = null;
  for (const c of candidates) {
    if (c.objective < baseline.metrics.objective_score && (best === null || c.objective < best.objective)) {
      best = c;
    }
  }
  return { baseline, candidates, best, label: BEST_CONFIG_LABEL };
}
