import { RESOURCE_KEYS, type ResourceKey, type ResourceSet, type SimulationOutput } from "./simulation/types";
import { alignRoster, assignmentsAt, isAssignable, type StaffMember } from "./staff";

/**
 * Everything the "simulation finished" popup shows, worked out from the run and the roster. Pure and
 * display-only: the engine schedules doctors and nurses as counts, so who worked comes from the same
 * stable mapping the Staff and Hospital pages use (assignmentsAt).
 */

export interface ResourceUsage {
  key: ResourceKey;
  /** Units the hospital started the run with. */
  capacity: number;
  /** Most units in use at the same minute. */
  peak: number;
  /** Share of the observation window the units were busy, 0 to 1. */
  utilization: number;
  /** Unit-hours of use, e.g. 2 doctors for 30 minutes is 1 unit-hour. */
  unitHours: number;
}

export interface FacultyUsage {
  role: "doctor" | "nurse";
  /** Headcount set on the Resources page. */
  configured: number;
  /** Most working at the same minute. */
  peakWorking: number;
  /** How many different people treated at least one patient. */
  worked: number;
  /** Names of those people (open positions are numbered, e.g. "Doctor 4"). */
  names: string[];
  /** Named people who are not available and so took no new work. */
  offDuty: number;
  hours: number;
}

export interface RunSummary {
  patients: { total: number; treated: number; remaining: number };
  timing: { planned: number; finished: number };
  waits: { average: number; maximum: number; critical: number; queuePeak: number; queuePeakAt: number; breaches: number };
  resources: ResourceUsage[];
  faculty: FacultyUsage[];
  /** Technicians and other staff on the roster; the engine does not schedule them. */
  otherStaff: number;
  stock: SimulationOutput["stock"] | null;
  bottlenecks: { resource: ResourceKey; patientMinutes: number }[];
  warnings: { critical: number; warning: number; info: number };
}

export function buildRunSummary(output: SimulationOutput, staff: StaffMember[], configured: ResourceSet = output.resources): RunSummary {
  const { metrics, timeline } = output;
  const horizon = Math.max(metrics.configured_duration, metrics.actual_completion_time);

  const peak = Object.fromEntries(RESOURCE_KEYS.map((k) => [k, 0])) as ResourceSet;
  const unitMinutes = { ...peak };
  for (const point of timeline) {
    for (const k of RESOURCE_KEYS) {
      peak[k] = Math.max(peak[k], point.in_use[k]);
      if (point.t < horizon) unitMinutes[k] += point.in_use[k];
    }
  }
  const resources: ResourceUsage[] = RESOURCE_KEYS.map((k) => ({
    key: k,
    capacity: output.resources[k],
    peak: peak[k],
    utilization: metrics.resource_utilization[k],
    unitHours: unitMinutes[k] / 60,
  }));

  const { scheduled } = alignRoster(staff, configured);
  const pool = scheduled.filter((s) => s.role === "doctor" || s.role === "nurse");
  const worked = new Set<string>();
  for (let t = 0; t < timeline.length; t++) {
    for (const id of assignmentsAt(output.patients, pool, t).keys()) worked.add(id);
  }
  const faculty: FacultyUsage[] = (["doctor", "nurse"] as const).map((role) => {
    const people = pool.filter((s) => s.role === role);
    const who = people.filter((s) => worked.has(s.id));
    return {
      role,
      configured: configured[role],
      peakWorking: peak[role],
      worked: who.length,
      names: who.map((s) => s.name),
      offDuty: people.filter((s) => !isAssignable(s) && s.availability_status !== "busy").length,
      hours: unitMinutes[role] / 60,
    };
  });

  return {
    patients: { total: metrics.total_patients, treated: metrics.patients_treated, remaining: metrics.patients_remaining },
    timing: { planned: metrics.configured_duration, finished: metrics.actual_completion_time },
    waits: {
      average: metrics.average_wait,
      maximum: metrics.maximum_wait,
      critical: metrics.critical_wait,
      queuePeak: metrics.peak_queue_length,
      queuePeakAt: metrics.peak_queue_time,
      breaches: metrics.safety_threshold_breaches,
    },
    resources,
    faculty,
    otherStaff: scheduled.filter((s) => s.role === "technician" || s.role === "other").length,
    stock: output.stock ?? null,
    bottlenecks: metrics.bottlenecks.slice(0, 3).map((b) => ({ resource: b.resource, patientMinutes: b.blocked_patient_minutes })),
    warnings: {
      critical: output.warnings.filter((w) => w.level === "critical").length,
      warning: output.warnings.filter((w) => w.level === "warning").length,
      info: output.warnings.filter((w) => w.level === "info").length,
    },
  };
}
