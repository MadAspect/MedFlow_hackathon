/**
 * Shared types for the MedFlow simulation engine.
 *
 * Field names deliberately match the repo-level README interface
 * (`id`, `arrival_time`, `urgency`, `treatment_time`, `required_resources`,
 * `start_time`, `end_time`, `wait_time`) and the database columns, so the same
 * objects can move between the engine, the UI and the database without mapping.
 *
 * All times are integer minutes from the start of the simulation.
 */

export const RESOURCE_KEYS = [
  "doctor",
  "nurse",
  "bed",
  "icu_bed",
  "operating_room",
] as const;

export type ResourceKey = (typeof RESOURCE_KEYS)[number];

/** Capacity (or usage) of every resource. */
export type ResourceSet = Record<ResourceKey, number>;

/** Units of each resource a patient needs while being treated (missing = 0). */
export type ResourceRequest = Partial<Record<ResourceKey, number>>;

export type Strategy = "fcfs" | "urgency" | "dynamic";

export interface SimPatient {
  id: string;
  condition: string;
  arrival_time: number;
  /** 1 (low) … 5 (critical) */
  urgency: number;
  treatment_time: number;
  required_resources: ResourceRequest;
  /** Synthetic emergency-surge arrivals get emergency_priority = 1. */
  emergency?: boolean;
}

/** Weights of the dynamic priority score S_i(T). */
export interface Weights {
  alpha: number; // urgency
  beta: number; // waiting time (per minute)
  gamma: number; // deterioration risk
  delta: number; // emergency priority
}

export interface SimParams {
  strategy: Strategy;
  /** Simulation horizon in minutes. */
  duration: number;
  weights: Weights;
  emergencySurge: boolean;
  /** Minute at which the surge begins. */
  surgeStart: number;
  /** Number of synthetic emergency arrivals in the surge. */
  surgeCount: number;
  resourceFailure: boolean;
  failedResource: ResourceKey;
  /** Minute at which the failure starts. */
  failureStart: number;
  /** Units of the failed resource that go offline. */
  failureUnits: number;
  /** A patient waiting longer than this (minutes) breaches the safety threshold. */
  safetyThreshold: number;
  /** Urgency at or above this counts as a critical patient. */
  criticalUrgency: number;
}

export interface ScoreBreakdown {
  /** alpha * u_i */
  urgency: number;
  /** beta * w_i */
  waiting: number;
  /** gamma * r_i */
  risk: number;
  /** delta * emergency_priority_i */
  emergency: number;
  /** S_i(T), the sum of the four terms. */
  total: number;
  /** w_i(T) = T - a_i, in minutes. */
  waiting_time: number;
  /** r_i(T) in [0, 1). */
  risk_value: number;
}

export interface SkippedCandidate {
  id: string;
  /** Resources this higher-ranked candidate was short of. */
  blocked_by: ResourceKey[];
}

/** Why a patient was chosen at the moment their treatment started. */
export interface Decision {
  /** Order in which treatments were started (0-based). */
  seq: number;
  time: number;
  score: ScoreBreakdown;
  required: ResourceRequest;
  /** Free capacity of every resource just before this allocation. */
  available_before: ResourceSet;
  queue_length: number;
  /** Higher-ranked patients that could not start because of resource shortage. */
  skipped: SkippedCandidate[];
}

export type OutcomeStatus =
  | "treated"
  | "in_treatment"
  | "waiting"
  | "critical_waiting"
  | "not_arrived";

export interface PatientOutcome {
  id: string;
  condition: string;
  arrival_time: number;
  urgency: number;
  treatment_time: number;
  required_resources: ResourceRequest;
  emergency: boolean;
  status: OutcomeStatus;
  start_time: number | null;
  end_time: number | null;
  /** Actual wait if started; wait so far (duration - arrival) if still queued. */
  wait_time: number;
  /** Score at the start of treatment, or at the end of the run if never started. */
  priority_score: number;
  decision: Decision | null;
}

export interface TimelinePoint {
  t: number;
  queue_length: number;
  in_treatment: number;
  treated: number;
  in_use: ResourceSet;
  /** Displayed capacity (base capacity minus failed units already offline). */
  capacity: ResourceSet;
}

export interface BottleneckEntry {
  resource: ResourceKey;
  /** Sum over minutes of queued patients whose binding (last-to-clear) shortage was this resource. */
  blocked_patient_minutes: number;
}

export interface Metrics {
  total_patients: number;
  patients_arrived: number;
  patients_treated: number;
  average_wait: number;
  maximum_wait: number;
  /** Average wait of critical patients (urgency >= criticalUrgency). */
  critical_wait: number;
  queue_length_final: number;
  peak_queue_length: number;
  peak_queue_time: number;
  patients_remaining: number;
  /** Fraction 0..1 of nominal capacity-minutes used, per resource. */
  resource_utilization: ResourceSet;
  /** Distinct patients that were blocked at least once by a resource shortage. */
  resource_conflicts: number;
  /** Arrived patients whose wait exceeds the safety threshold. */
  safety_threshold_breaches: number;
  bottlenecks: BottleneckEntry[];
}

export type WarningLevel = "info" | "warning" | "critical";

export interface SimWarning {
  level: WarningLevel;
  code: string;
  message: string;
  time?: number;
}

export interface SimulationOutput {
  strategy: Strategy;
  params: SimParams;
  /** Nominal resource capacity the run started with. */
  resources: ResourceSet;
  patients: PatientOutcome[];
  metrics: Metrics;
  timeline: TimelinePoint[];
  warnings: SimWarning[];
  /** True when produced by the placeholder engine – NOT a calculated result. */
  isPlaceholder: boolean;
  engine: string;
}

export const PLACEHOLDER_NOTICE =
  "Placeholder simulation output — connect the scheduling engine to generate calculated results.";
