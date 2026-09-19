import { buildWarnings, computeMetrics } from "./metrics";
import { DEFAULT_WEIGHTS, rankQueue, scoreBreakdown } from "./policies";
import { cloneResourceSet, emptyResourceSet } from "./resources";
import { generateSurgePatients } from "./surge";
import {
  RESOURCE_KEYS,
  type Decision,
  type OutcomeStatus,
  type PatientOutcome,
  type ResourceKey,
  type ResourceSet,
  type SimParams,
  type SimPatient,
  type SimulationOutput,
  type SkippedCandidate,
  type TimelinePoint,
} from "./types";

export const ENGINE_NAME = "medflow-ts-discrete-v1";

export class SimulationInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SimulationInputError";
  }
}

export function defaultParams(overrides: Partial<SimParams> = {}): SimParams {
  return {
    strategy: "dynamic",
    duration: 120,
    emergencySurge: false,
    surgeStart: 20,
    surgeCount: 10,
    resourceFailure: false,
    failedResource: "icu_bed",
    failureStart: 35,
    failureUnits: 1,
    safetyThreshold: 30,
    criticalUrgency: 4,
    ...overrides,
    weights: { ...DEFAULT_WEIGHTS, ...(overrides.weights ?? {}) },
  };
}

const isNonNegInt = (n: unknown): n is number =>
  typeof n === "number" && Number.isInteger(n) && n >= 0;

/** Reject any input that could break the model's invariants. */
export function assertValidInput(
  patients: SimPatient[],
  resources: ResourceSet,
  params: SimParams,
): void {
  for (const k of RESOURCE_KEYS) {
    if (!isNonNegInt(resources[k])) {
      throw new SimulationInputError(
        `Resource "${k}" must be an integer >= 0 (got ${String(resources[k])}).`,
      );
    }
  }
  if (!Number.isInteger(params.duration) || params.duration < 1) {
    throw new SimulationInputError("Simulation duration must be an integer >= 1 minute.");
  }
  if (!isNonNegInt(params.surgeStart) || !isNonNegInt(params.failureStart)) {
    throw new SimulationInputError("Surge and failure start times must be integers >= 0.");
  }
  if (!isNonNegInt(params.failureUnits) || !isNonNegInt(params.surgeCount)) {
    throw new SimulationInputError("Failure units and surge size must be integers >= 0.");
  }
  for (const w of Object.values(params.weights)) {
    if (!Number.isFinite(w)) throw new SimulationInputError("Weights must be finite numbers.");
  }

  const seen = new Set<string>();
  for (const p of patients) {
    if (typeof p.id !== "string" || p.id.trim() === "") {
      throw new SimulationInputError("Every patient needs a non-empty id.");
    }
    if (seen.has(p.id)) throw new SimulationInputError(`Duplicate patient id "${p.id}".`);
    seen.add(p.id);
    if (!isNonNegInt(p.arrival_time)) {
      throw new SimulationInputError(`Patient ${p.id}: arrival time must be an integer >= 0.`);
    }
    if (!Number.isInteger(p.urgency) || p.urgency < 1 || p.urgency > 5) {
      throw new SimulationInputError(`Patient ${p.id}: urgency must be an integer from 1 to 5.`);
    }
    if (!Number.isInteger(p.treatment_time) || p.treatment_time <= 0) {
      throw new SimulationInputError(`Patient ${p.id}: treatment time must be an integer > 0.`);
    }
    let needsSomething = false;
    for (const k of RESOURCE_KEYS) {
      const need = p.required_resources[k] ?? 0;
      if (!isNonNegInt(need)) {
        throw new SimulationInputError(`Patient ${p.id}: "${k}" must be an integer >= 0.`);
      }
      if (need > 0) needsSomething = true;
    }
    if (!needsSomething) {
      throw new SimulationInputError(`Patient ${p.id}: at least one resource is required.`);
    }
  }
}

/**
 * Discrete-time (1-minute step) hospital simulation.
 *
 * At every minute T:
 *   1. Release resources of treatments that finish at or before T.
 *   2. Admit patients whose arrival time is <= T to the queue.
 *   3. Rank the queue with the selected policy and walk it in order, starting
 *      every patient whose whole resource set is currently free, so
 *      Σ allocated_r <= capacity_r always holds.
 *
 * Treatment is non-preemptive. A failed resource unit goes offline at the
 * failure start, or when the unit next becomes free if it is in use.
 * The result is fully deterministic for identical inputs.
 */
export function runSimulation(
  patients: SimPatient[],
  resources: ResourceSet,
  paramOverrides: Partial<SimParams> = {},
): SimulationOutput {
  const params = defaultParams(paramOverrides);
  const surge = params.emergencySurge
    ? generateSurgePatients(params.surgeStart, params.surgeCount)
    : [];
  const all = [...patients, ...surge];
  assertValidInput(all, resources, params);

  const n = all.length;
  const { duration } = params;
  const startTime: (number | null)[] = new Array(n).fill(null);
  const decisions: (Decision | null)[] = new Array(n).fill(null);
  const everBlocked: boolean[] = new Array(n).fill(false);
  const blockedMinutes = emptyResourceSet();
  const inUse = emptyResourceSet();
  const running: number[] = [];
  let queue: number[] = [];
  let treatedCount = 0;
  let seq = 0;
  const timeline: TimelinePoint[] = [];

  const failedUnits = params.resourceFailure
    ? Math.min(params.failureUnits, resources[params.failedResource])
    : 0;

  /** Capacity available for NEW allocations at minute t. */
  const allocationCapacity = (t: number): ResourceSet => {
    const cap = cloneResourceSet(resources);
    if (failedUnits > 0 && t >= params.failureStart) {
      cap[params.failedResource] -= failedUnits;
    }
    return cap;
  };

  const arrivalOrder = all
    .map((_, i) => i)
    .sort((a, b) => all[a].arrival_time - all[b].arrival_time || a - b);
  let arrivalPtr = 0;

  const shortages = (need: SimPatient["required_resources"], cap: ResourceSet) =>
    RESOURCE_KEYS.filter((k) => (need[k] ?? 0) > cap[k] - inUse[k]);

  /**
   * Of the resources a queued patient is short of, the one that becomes
   * sufficient last (running treatments release units in end-time order).
   * A need that exceeds capacity never resolves, so it binds first.
   */
  const bindingResource = (
    need: SimPatient["required_resources"],
    short: ResourceKey[],
    cap: ResourceSet,
  ): ResourceKey => {
    const releases = running
      .map((idx) => ({ end: startTime[idx]! + all[idx].treatment_time, idx }))
      .sort((a, b) => a.end - b.end);
    let binding = short[0];
    let latest = -1;
    for (const k of short) {
      const required = need[k] ?? 0;
      let time = Infinity;
      if (required <= cap[k]) {
        let free = cap[k] - inUse[k];
        time = 0;
        for (const r of releases) {
          if (free >= required) break;
          free += all[r.idx].required_resources[k] ?? 0;
          time = r.end;
        }
      }
      // Ties (units freed by the same patient) blame the scarcer resource.
      if (time > latest || (time === latest && cap[k] < cap[binding])) {
        latest = time;
        binding = k;
      }
    }
    return binding;
  };

  for (let t = 0; t <= duration; t++) {
    // 1. Release finished treatments.
    for (let r = running.length - 1; r >= 0; r--) {
      const idx = running[r];
      if (startTime[idx]! + all[idx].treatment_time <= t) {
        for (const k of RESOURCE_KEYS) inUse[k] -= all[idx].required_resources[k] ?? 0;
        running.splice(r, 1);
        treatedCount++;
      }
    }

    // 2. Admit arrivals.
    while (arrivalPtr < n && all[arrivalOrder[arrivalPtr]].arrival_time <= t) {
      queue.push(arrivalOrder[arrivalPtr++]);
    }

    const cap = allocationCapacity(t);

    // 3. Allocate (the horizon itself is only a final snapshot).
    if (t < duration && queue.length > 0) {
      const queueLength = queue.length;
      const ranked = rankQueue(
        queue.map((index) => ({ index, patient: all[index] })),
        t,
        params,
      );
      const skipped: SkippedCandidate[] = [];
      const startedNow = new Set<number>();

      for (const cand of ranked) {
        const need = cand.patient.required_resources;
        const short = shortages(need, cap);
        if (short.length === 0) {
          const availableBefore = emptyResourceSet();
          for (const k of RESOURCE_KEYS) availableBefore[k] = cap[k] - inUse[k];
          decisions[cand.index] = {
            seq: seq++,
            time: t,
            score: cand.score,
            required: { ...need },
            available_before: availableBefore,
            queue_length: queueLength,
            skipped: skipped.map((s) => ({ ...s, blocked_by: [...s.blocked_by] })),
          };
          for (const k of RESOURCE_KEYS) inUse[k] += need[k] ?? 0;
          startTime[cand.index] = t;
          running.push(cand.index);
          startedNow.add(cand.index);
        } else {
          skipped.push({ id: cand.patient.id, blocked_by: short });
        }
      }

      queue = queue.filter((i) => !startedNow.has(i));

      // Whoever is still queued is blocked by what is short after this pass.
      // The delay is attributed to the binding resource: the shortage that
      // would be resolved last, once running treatments finish.
      for (const i of queue) {
        const short = shortages(all[i].required_resources, cap);
        if (short.length === 0) continue;
        everBlocked[i] = true;
        blockedMinutes[bindingResource(all[i].required_resources, short, cap)]++;
      }
    }

    // Displayed capacity: a failed unit that is still busy stays visible until freed.
    const capacityShown = emptyResourceSet();
    for (const k of RESOURCE_KEYS) capacityShown[k] = Math.max(cap[k], inUse[k]);

    timeline.push({
      t,
      queue_length: queue.length,
      in_treatment: running.length,
      treated: treatedCount,
      in_use: cloneResourceSet(inUse),
      capacity: capacityShown,
    });
  }

  const outcomes: PatientOutcome[] = all.map((p, i) => {
    const start = startTime[i];
    const decision = decisions[i];
    const end = start === null ? null : start + p.treatment_time;
    let status: OutcomeStatus;
    if (p.arrival_time > duration) status = "not_arrived";
    else if (start === null) {
      status = p.urgency >= params.criticalUrgency ? "critical_waiting" : "waiting";
    } else status = end! <= duration ? "treated" : "in_treatment";

    const wait =
      start !== null ? start - p.arrival_time : Math.max(0, duration - p.arrival_time);
    const priority =
      decision?.score.total ??
      scoreBreakdown(p, Math.max(duration, p.arrival_time), params.weights).total;

    return {
      id: p.id,
      condition: p.condition,
      arrival_time: p.arrival_time,
      urgency: p.urgency,
      treatment_time: p.treatment_time,
      required_resources: { ...p.required_resources },
      emergency: p.emergency === true,
      status,
      start_time: start,
      end_time: end,
      wait_time: wait,
      priority_score: priority,
      decision,
    };
  });

  const metrics = computeMetrics({
    outcomes,
    timeline,
    resources,
    params,
    blockedPatientMinutes: blockedMinutes,
    resourceConflicts: everBlocked.filter(Boolean).length,
  });

  return {
    strategy: params.strategy,
    params,
    resources: cloneResourceSet(resources),
    patients: outcomes,
    metrics,
    timeline,
    warnings: buildWarnings({
      outcomes,
      timeline,
      metrics,
      resources,
      params,
      surgeAdded: surge.length,
    }),
    isPlaceholder: false,
    engine: ENGINE_NAME,
  };
}

/** Run the same input through every strategy (used by the Strategy Lab). */
export function runAllStrategies(
  patients: SimPatient[],
  resources: ResourceSet,
  params: Partial<SimParams> = {},
): Record<SimParams["strategy"], SimulationOutput> {
  return {
    fcfs: runSimulation(patients, resources, { ...params, strategy: "fcfs" }),
    urgency: runSimulation(patients, resources, { ...params, strategy: "urgency" }),
    dynamic: runSimulation(patients, resources, { ...params, strategy: "dynamic" }),
  };
}
