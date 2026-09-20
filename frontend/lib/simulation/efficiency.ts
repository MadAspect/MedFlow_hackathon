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

export const SAME_ORDER_MESSAGE = "These strategies produced the same order for this scenario.";
export const BEST_CONFIG_LABEL = "Best tested configuration";

const EPSILON = 0.0001;

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
  configuration: ResourceSet;
  output: SimulationOutput;
  objective: number;
  objectiveGain: number;
  improvementPct: number;
  totalWaitSaved: number;
  criticalWaitSaved: number;
  completionSaved: number;
}

export interface ResourceRecommendation {
  strategy: Strategy;
  baseline: SimulationOutput;
  candidates: ResourceCandidate[];
  best: ResourceCandidate | null;
  label: string;
}

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
