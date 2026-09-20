import { computeMetrics } from "./metrics";
import { defaultParams } from "./engine";
import { scoreBreakdown } from "./policies";
import { cloneResourceSet, emptyResourceSet } from "./resources";
import {
  PLACEHOLDER_NOTICE,
  type OutcomeStatus,
  type PatientOutcome,
  type ResourceSet,
  type SimParams,
  type SimPatient,
  type SimulationOutput,
  type TimelinePoint,
} from "./types";

export const PLACEHOLDER_ENGINE_NAME = "placeholder";

export function runPlaceholderSimulation(
  patients: SimPatient[],
  resources: ResourceSet,
  paramOverrides: Partial<SimParams> = {},
): SimulationOutput {
  const params = defaultParams(paramOverrides);
  const sorted = patients
    .map((p, i) => ({ p, i }))
    .sort((a, b) => a.p.arrival_time - b.p.arrival_time || a.i - b.i);

  let cursor = 0;
  const outcomes: PatientOutcome[] = sorted.map(({ p }) => {
    const start = Math.max(cursor, p.arrival_time);
    const began = start < params.duration;
    if (began) cursor = start + p.treatment_time;
    const end = began ? start + p.treatment_time : null;
    let status: OutcomeStatus;
    if (p.arrival_time > params.duration) status = "not_arrived";
    else if (!began) status = p.urgency >= params.criticalUrgency ? "critical_waiting" : "waiting";
    else status = end! <= params.duration ? "treated" : "in_treatment";
    return {
      id: p.id,
      condition: p.condition,
      arrival_time: p.arrival_time,
      urgency: p.urgency,
      treatment_time: p.treatment_time,
      required_resources: { ...p.required_resources },
      emergency: false,
      appointment: p.appointment === true,
      status,
      start_time: began ? start : null,
      end_time: end,
      wait_time: began ? start - p.arrival_time : Math.max(0, params.duration - p.arrival_time),
      priority_score: scoreBreakdown(p, p.arrival_time, params.weights).total,
      decision: null,
    };
  });

  const timeline: TimelinePoint[] = [];
  for (let t = 0; t <= params.duration; t++) {
    const queued = outcomes.filter(
      (o) => o.arrival_time <= t && (o.start_time === null || o.start_time > t),
    ).length;
    const treated = outcomes.filter((o) => o.end_time !== null && o.end_time <= t).length;
    timeline.push({
      t,
      queue_length: queued,
      in_treatment: outcomes.filter(
        (o) => o.start_time !== null && o.start_time <= t && (o.end_time ?? 0) > t,
      ).length,
      treated,
      in_use: emptyResourceSet(),
      capacity: cloneResourceSet(resources),
    });
  }

  const metrics = computeMetrics({
    outcomes,
    timeline,
    resources,
    params,
    blockedPatientMinutes: emptyResourceSet(),
    resourceConflicts: 0,
  });

  return {
    strategy: params.strategy,
    params,
    resources: cloneResourceSet(resources),
    patients: outcomes,
    metrics,
    timeline,
    warnings: [{ level: "warning", code: "placeholder", message: PLACEHOLDER_NOTICE }],
    completed: metrics.patients_remaining === 0,
    error: null,
    isPlaceholder: true,
    engine: PLACEHOLDER_ENGINE_NAME,
  };
}
