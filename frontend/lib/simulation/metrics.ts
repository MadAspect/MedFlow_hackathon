import { RESOURCE_LABELS, RESOURCE_SINGULAR, emptyResourceSet } from "./resources";
import {
  RESOURCE_KEYS,
  type Metrics,
  type OutcomeStatus,
  type PatientOutcome,
  type ResourceSet,
  type SimParams,
  type SimWarning,
  type SimulationOutput,
  type TimelinePoint,
} from "./types";

export function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Utilization of one resource: used unit-minutes divided by the nominal
 * capacity-minutes (capacity × duration). Returns 0 when capacity or duration
 * is zero, and never exceeds 1.
 */
export function utilization(
  usedUnitMinutes: number,
  capacity: number,
  duration: number,
): number {
  if (capacity <= 0 || duration <= 0) return 0;
  return Math.min(1, usedUnitMinutes / (capacity * duration));
}

/** Weights of the objective score. The lower the score, the better the run. */
export const OBJECTIVE_WEIGHTS = {
  totalWaiting: 1.0,
  criticalWaiting: 4.0,
  patientsRemaining: 10000.0,
  resourceOverload: 10000.0,
  maxWaiting: 0.5,
} as const;

/**
 *   objective = 1·totalWaitingTime + 4·criticalPatientWaitingTime
 *             + 10000·patientsRemaining + 10000·resourceOverload
 *             + 0.5·maximumWaitingTime
 */
export function objectiveScore(m: {
  total_waiting_time: number;
  critical_wait_total: number;
  patients_remaining: number;
  resource_overload: number;
  maximum_wait: number;
}): number {
  return (
    OBJECTIVE_WEIGHTS.totalWaiting * m.total_waiting_time +
    OBJECTIVE_WEIGHTS.criticalWaiting * m.critical_wait_total +
    OBJECTIVE_WEIGHTS.patientsRemaining * m.patients_remaining +
    OBJECTIVE_WEIGHTS.resourceOverload * m.resource_overload +
    OBJECTIVE_WEIGHTS.maxWaiting * m.maximum_wait
  );
}

export interface MetricsInput {
  outcomes: PatientOutcome[];
  timeline: TimelinePoint[];
  resources: ResourceSet;
  params: SimParams;
  /** Patient-minutes of queueing attributed to each resource as the binding shortage. */
  blockedPatientMinutes: ResourceSet;
  /** Distinct patients whose binding shortage was each resource. */
  blockedPatientCounts?: ResourceSet;
  /** Distinct patients blocked at least once by a resource shortage. */
  resourceConflicts: number;
  /** Minute the last treatment finished; defaults to the latest recorded end time. */
  actualCompletionTime?: number;
}

export function computeMetrics(input: MetricsInput): Metrics {
  const { outcomes, timeline, resources, params } = input;
  const arrived = outcomes.filter((o) => o.status !== "not_arrived");
  const critical = arrived.filter((o) => o.urgency >= params.criticalUrgency);
  const treated = outcomes.filter((o) => o.status === "treated");
  const actualCompletionTime =
    input.actualCompletionTime ?? outcomes.reduce((m, o) => Math.max(m, o.end_time ?? 0), 0);

  // Utilization covers the observation window [0, horizon): the configured
  // duration, extended to the actual completion time when the run is longer.
  const horizon = Math.max(params.duration, actualCompletionTime);
  const used = emptyResourceSet();
  let overload = 0;
  for (const point of timeline) {
    if (point.t >= horizon) continue;
    for (const k of RESOURCE_KEYS) {
      used[k] += point.in_use[k];
      overload += Math.max(0, point.in_use[k] - resources[k]);
    }
  }
  const resource_utilization = emptyResourceSet();
  for (const k of RESOURCE_KEYS) {
    resource_utilization[k] = utilization(used[k], resources[k], horizon);
  }

  let peak = 0;
  let peakTime = 0;
  for (const point of timeline) {
    if (point.queue_length > peak) {
      peak = point.queue_length;
      peakTime = point.t;
    }
  }

  const last = timeline[timeline.length - 1];
  const bottlenecks = RESOURCE_KEYS.map((resource) => ({
    resource,
    blocked_patient_minutes: input.blockedPatientMinutes[resource],
    blocked_patients: input.blockedPatientCounts?.[resource] ?? 0,
  }))
    .filter((b) => b.blocked_patient_minutes > 0)
    .sort((a, b) => b.blocked_patient_minutes - a.blocked_patient_minutes);

  const total_waiting_time = arrived.reduce((s, o) => s + o.wait_time, 0);
  const critical_wait_total = critical.reduce((s, o) => s + o.wait_time, 0);
  const maximum_wait = arrived.reduce((m, o) => Math.max(m, o.wait_time), 0);
  const patients_remaining = outcomes.length - treated.length;

  return {
    total_patients: outcomes.length,
    patients_arrived: arrived.length,
    patients_treated: treated.length,
    average_wait: average(arrived.map((o) => o.wait_time)),
    maximum_wait,
    critical_wait: average(critical.map((o) => o.wait_time)),
    configured_duration: params.duration,
    actual_completion_time: actualCompletionTime,
    total_waiting_time,
    critical_wait_total,
    resource_overload: overload,
    objective_score: objectiveScore({
      total_waiting_time,
      critical_wait_total,
      patients_remaining,
      resource_overload: overload,
      maximum_wait,
    }),
    queue_length_final: last ? last.queue_length : 0,
    peak_queue_length: peak,
    peak_queue_time: peakTime,
    patients_remaining,
    resource_utilization,
    resource_conflicts: input.resourceConflicts,
    safety_threshold_breaches: arrived.filter(
      (o) => o.wait_time > params.safetyThreshold,
    ).length,
    bottlenecks,
  };
}

export interface WarningInput {
  outcomes: PatientOutcome[];
  timeline: TimelinePoint[];
  metrics: Metrics;
  resources: ResourceSet;
  params: SimParams;
  surgeAdded: number;
  /** Set when the run could not treat every patient. */
  error?: string | null;
}

/** Human-readable warnings and bottlenecks derived from calculated output. */
export function buildWarnings(input: WarningInput): SimWarning[] {
  const { outcomes, timeline, metrics, resources, params } = input;
  const warnings: SimWarning[] = [];

  if (input.error) {
    warnings.push({
      level: "critical",
      code: "simulation_incomplete",
      time: metrics.actual_completion_time,
      message: input.error,
    });
  } else if (outcomes.length > 0 && metrics.actual_completion_time > params.duration) {
    warnings.push({
      level: "info",
      code: "beyond_duration",
      time: metrics.actual_completion_time,
      message: `The planned observation period was ${params.duration} min, but patients were still waiting or in treatment, so the simulation continued until minute ${metrics.actual_completion_time}, when the last patient was treated.`,
    });
  }

  if (outcomes.length === 0) {
    warnings.push({
      level: "info",
      code: "no_patients",
      message: "There are no patients to schedule.",
    });
  }

  if (RESOURCE_KEYS.every((k) => resources[k] === 0)) {
    warnings.push({
      level: "critical",
      code: "no_resources",
      message: "All resource capacities are zero, so no patient can be treated.",
    });
  }

  if (params.emergencySurge && input.surgeAdded > 0 && params.surgeStart <= params.duration) {
    warnings.push({
      level: "info",
      code: "surge",
      time: params.surgeStart,
      message: `Emergency surge: ${input.surgeAdded} synthetic emergency arrivals from minute ${params.surgeStart}.`,
    });
  }

  const failedUnits = params.resourceFailure
    ? Math.min(params.failureUnits, resources[params.failedResource])
    : 0;
  if (params.resourceFailure && params.failureStart <= params.duration) {
    warnings.push({
      level: "warning",
      code: "failure",
      time: params.failureStart,
      message: `Resource failure: ${failedUnits} × ${RESOURCE_SINGULAR[params.failedResource]} taken offline from minute ${params.failureStart} (a unit in use goes offline when its treatment finishes).`,
    });
  }

  // Patients whose needs exceed capacity can never be scheduled.
  for (const k of RESOURCE_KEYS) {
    const reduced =
      params.resourceFailure && k === params.failedResource
        ? resources[k] - failedUnits
        : resources[k];
    const never = outcomes.filter((o) => (o.required_resources[k] ?? 0) > resources[k]);
    if (never.length > 0) {
      warnings.push({
        level: "critical",
        code: `unschedulable_${k}`,
        message: `${never.length} patient(s) need more ${RESOURCE_LABELS[k].toLowerCase()} than the hospital has (${resources[k]}) and can never be treated: ${never
          .slice(0, 5)
          .map((o) => o.id)
          .join(", ")}${never.length > 5 ? "…" : ""}.`,
      });
    } else if (reduced < resources[k]) {
      const afterFailure = outcomes.filter(
        (o) => (o.required_resources[k] ?? 0) > reduced,
      );
      if (afterFailure.length > 0) {
        warnings.push({
          level: "warning",
          code: `unschedulable_after_failure_${k}`,
          message: `${afterFailure.length} patient(s) need more ${RESOURCE_LABELS[k].toLowerCase()} than remain after the failure (${reduced}).`,
        });
      }
    }
  }

  // Saturation and bottlenecks per resource.
  const topBottleneck = metrics.bottlenecks[0]?.resource;
  for (const k of RESOURCE_KEYS) {
    let saturatedMinutes = 0;
    let firstSaturated: number | null = null;
    for (const p of timeline) {
      const cap = p.capacity[k];
      const saturated = cap > 0 ? p.in_use[k] / cap >= 0.9 : resources[k] > 0;
      if (saturated) {
        saturatedMinutes++;
        if (firstSaturated === null) firstSaturated = p.t;
      }
    }
    const blocked =
      metrics.bottlenecks.find((b) => b.resource === k)?.blocked_patient_minutes ?? 0;
    if (saturatedMinutes > 0 && blocked > 0) {
      warnings.push({
        level: k === topBottleneck ? "critical" : "warning",
        code: `bottleneck_${k}`,
        time: firstSaturated ?? undefined,
        message: `${k === topBottleneck ? "Bottleneck: " : ""}${RESOURCE_LABELS[k]} were ≥90% in use for ${saturatedMinutes} min (from minute ${firstSaturated}); it was the binding shortage for ${blocked} patient-minutes of waiting.`,
      });
    }
  }

  if (metrics.safety_threshold_breaches > 0) {
    warnings.push({
      level: "warning",
      code: "safety_threshold",
      message: `${metrics.safety_threshold_breaches} patient(s) waited longer than the ${params.safetyThreshold}-minute safety threshold.`,
    });
  }

  if (metrics.peak_queue_length >= 5) {
    warnings.push({
      level: "info",
      code: "queue_peak",
      time: metrics.peak_queue_time,
      message: `Queue peaked at ${metrics.peak_queue_length} patients at minute ${metrics.peak_queue_time}.`,
    });
  }

  const criticalWaiting = outcomes.filter((o) => o.status === "critical_waiting").length;
  if (criticalWaiting > 0) {
    warnings.push({
      level: "critical",
      code: "critical_waiting",
      message: `${criticalWaiting} critical patient(s) were still waiting when the simulation ended.`,
    });
  }

  return warnings;
}

/** Histogram of patient waiting times (arrived patients only). */
export function waitHistogram(
  outcomes: PatientOutcome[],
  bucketSize = 10,
): { range: string; count: number }[] {
  const waits = outcomes.filter((o) => o.status !== "not_arrived").map((o) => o.wait_time);
  if (waits.length === 0) return [];
  const buckets = Math.floor(Math.max(...waits) / bucketSize) + 1;
  const counts = new Array<number>(buckets).fill(0);
  for (const w of waits) counts[Math.floor(w / bucketSize)]++;
  return counts.map((count, i) => ({
    range: `${i * bucketSize}–${(i + 1) * bucketSize - 1}`,
    count,
  }));
}

export function statusCounts(outcomes: PatientOutcome[]): Record<OutcomeStatus, number> {
  const counts: Record<OutcomeStatus, number> = {
    treated: 0,
    in_treatment: 0,
    waiting: 0,
    critical_waiting: 0,
    not_arrived: 0,
  };
  for (const o of outcomes) counts[o.status]++;
  return counts;
}

/** Patient ids in the order treatment started – shows how a policy reorders the queue. */
export function treatmentOrder(output: Pick<SimulationOutput, "patients">): string[] {
  return output.patients
    .filter((p) => p.decision)
    .sort((a, b) => a.decision!.seq - b.decision!.seq)
    .map((p) => p.id);
}

/** Patient state at time t, reconstructed from a finished run. */
export type FlowStage = "not_arrived" | "waiting" | "in_treatment" | "treated";

export function stageAt(p: PatientOutcome, t: number): FlowStage {
  if (p.arrival_time > t) return "not_arrived";
  if (p.start_time === null || p.start_time > t) return "waiting";
  if (p.end_time !== null && p.end_time <= t) return "treated";
  return "in_treatment";
}

/** Green below 70%, yellow 70–89%, red 90% and above. */
export function resourceStatus(utilizationFraction: number): "ok" | "warning" | "critical" {
  if (utilizationFraction >= 0.9) return "critical";
  if (utilizationFraction >= 0.7) return "warning";
  return "ok";
}
