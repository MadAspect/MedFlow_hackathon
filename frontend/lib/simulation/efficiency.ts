import { runSimulation } from "./engine";
import { RESOURCE_SINGULAR, cloneResourceSet } from "./resources";
import {
  RESOURCE_KEYS,
  type ResourceKey,
  type ResourceSet,
  type SimParams,
  type SimPatient,
  type SimulationOutput,
  type Strategy,
} from "./types";

/**
 * Resource what-ifs.
 *
 * Every candidate is an ordinary run of the same deterministic engine on
 * identical input; only the resource capacities differ. Nothing here calls an
 * AI model or the network.
 */

export const SAME_ORDER_MESSAGE = "These strategies produced the same order for this scenario.";
export const BEST_CONFIG_LABEL = "Best tested configuration";

/** Guards the improvement formula against a zero baseline. */
const EPSILON = 0.0001;

/**
 * Percentage improvement of `after` over `before`.
 *   lower is better:   (before − after) / max(|before|, 0.0001) · 100
 *   higher is better:  (after − before) / max(|before|, 0.0001) · 100
 */
export function improvementPercent(
  before: number,
  after: number,
  direction: "lower" | "higher",
): number {
  const gain = direction === "lower" ? before - after : after - before;
  return (gain / Math.max(Math.abs(before), EPSILON)) * 100;
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
  /** Minutes of total waiting removed by the extra unit (negative = more waiting). */
  totalWaitSaved: number;
  /** Minutes of critical-patient waiting removed by the extra unit. */
  criticalWaitSaved: number;
  /** Minutes earlier the last patient finishes. */
  completionSaved: number;
}

export interface ResourceRecommendation {
  strategy: Strategy;
  baseline: SimulationOutput;
  candidates: ResourceCandidate[];
  /** Candidate with the lowest objective score, only if it beats the baseline. */
  best: ResourceCandidate | null;
  label: string;
}

/**
 * Add one unit of each resource in turn, re-run the full simulation (to
 * completion) under `strategy` and compare with the baseline. This tests five
 * configurations; it is not an exhaustive search, so the winner is only the
 * best of those tested. "Best" is the lowest objective score, which counts
 * critical waits four times and treats an unfinished run as far worse.
 */
export function recommendResource(
  patients: SimPatient[],
  resources: ResourceSet,
  params: Partial<SimParams> = {},
  strategy: Strategy = "dynamic",
): ResourceRecommendation {
  const run = (config: ResourceSet) =>
    runSimulation(
      patients.map((p) => ({ ...p, required_resources: { ...p.required_resources } })),
      config,
      { ...params, strategy },
    );
  const baseline = run(cloneResourceSet(resources));
  const b = baseline.metrics;

  const candidates: ResourceCandidate[] = RESOURCE_KEYS.map((resource) => {
    const configuration = cloneResourceSet(resources);
    configuration[resource] += 1;
    const output = run(configuration);
    const m = output.metrics;
    return {
      resource,
      label: `+1 ${RESOURCE_SINGULAR[resource]}`,
      configuration,
      output,
      objective: m.objective_score,
      objectiveGain: b.objective_score - m.objective_score,
      improvementPct: improvementPercent(b.objective_score, m.objective_score, "lower"),
      totalWaitSaved: b.total_waiting_time - m.total_waiting_time,
      criticalWaitSaved: b.critical_wait_total - m.critical_wait_total,
      completionSaved: b.actual_completion_time - m.actual_completion_time,
    };
  });

  // Strict "<" keeps the first resource in RESOURCE_KEYS order on ties.
  let best: ResourceCandidate | null = null;
  for (const c of candidates) {
    if (c.objective < b.objective_score && (best === null || c.objective < best.objective)) {
      best = c;
    }
  }
  return { strategy, baseline, candidates, best, label: BEST_CONFIG_LABEL };
}
