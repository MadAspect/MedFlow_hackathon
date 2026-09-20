import { APPOINTMENT_GRACE } from "./appointments";
import { average, stageAt, utilization } from "./metrics";
import { emptyResourceSet } from "./resources";
import { RESOURCE_KEYS, type PatientOutcome, type ResourceSet, type SimulationOutput } from "./types";

export function waitAt(p: PatientOutcome, t: number): number {
  if (p.arrival_time > t) return 0;
  const end = p.start_time !== null && p.start_time <= t ? p.start_time : t;
  return Math.max(0, end - p.arrival_time);
}

export interface LiveSnapshot {
  t: number;
  total: number;
  notArrived: number;
  waiting: number;
  inTreatment: number;
  treated: number;
  criticalWaiting: number;
  averageWait: number;
  longestWait: number;
  utilization: ResourceSet;
  appointmentsDue: number;
  appointmentsLate: number;
}

export function liveSnapshot(output: SimulationOutput, t: number): LiveSnapshot {
  const { patients, timeline, params } = output;
  const last = Math.max(0, timeline.length - 1);
  const at = Math.max(0, Math.min(last, Math.round(t)));

  let notArrived = 0;
  let waiting = 0;
  let inTreatment = 0;
  let treated = 0;
  let criticalWaiting = 0;
  let appointmentsDue = 0;
  let appointmentsLate = 0;
  const waits: number[] = [];
  for (const p of patients) {
    const stage = stageAt(p, at);
    if (stage === "not_arrived") {
      notArrived++;
      continue;
    }
    const wait = waitAt(p, at);
    waits.push(wait);
    if (stage === "waiting") {
      waiting++;
      if (p.urgency >= params.criticalUrgency) criticalWaiting++;
    } else if (stage === "in_treatment") inTreatment++;
    else treated++;
    if (p.appointment) {
      appointmentsDue++;
      if (wait > APPOINTMENT_GRACE) appointmentsLate++;
    }
  }

  // Same window as the final metric: minutes [0, horizon), so the last frame matches it.
  const horizon = Math.max(1, params.duration, output.metrics.actual_completion_time);
  const minutes = Math.min(at + 1, horizon);
  const used = emptyResourceSet();
  for (let m = 0; m < minutes && m < timeline.length; m++) {
    for (const k of RESOURCE_KEYS) used[k] += timeline[m].in_use[k];
  }
  const util = emptyResourceSet();
  for (const k of RESOURCE_KEYS) util[k] = utilization(used[k], output.resources[k], minutes);

  return {
    t: at,
    total: patients.length,
    notArrived,
    waiting,
    inTreatment,
    treated,
    criticalWaiting,
    averageWait: average(waits),
    longestWait: waits.reduce((m, w) => Math.max(m, w), 0),
    utilization: util,
    appointmentsDue,
    appointmentsLate,
  };
}

export function liveWaitHistogram(
  output: SimulationOutput,
  t: number,
  bucketSize = 10,
): { range: string; count: number }[] {
  const finalMax = output.patients.reduce((m, p) => Math.max(m, p.wait_time), 0);
  const buckets = Math.floor(finalMax / bucketSize) + 1;
  const counts = new Array<number>(buckets).fill(0);
  for (const p of output.patients) {
    if (p.arrival_time > t) continue;
    counts[Math.min(buckets - 1, Math.floor(waitAt(p, t) / bucketSize))]++;
  }
  return counts.map((count, i) => ({ range: `${i * bucketSize}–${(i + 1) * bucketSize - 1}`, count }));
}
