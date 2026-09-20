
export const RESOURCE_KEYS = [
  "doctor",
  "nurse",
  "bed",
  "icu_bed",
  "operating_room",
] as const;

export type ResourceKey = (typeof RESOURCE_KEYS)[number];

export type ResourceSet = Record<ResourceKey, number>;

export type ResourceRequest = Partial<Record<ResourceKey, number>>;

export type Strategy = "fcfs" | "urgency" | "dynamic" | "hazard";

export interface SimPatient {
  id: string;
  condition: string;
  arrival_time: number;
  urgency: number;
  treatment_time: number;
  required_resources: ResourceRequest;
  emergency?: boolean;
  appointment?: boolean;
  ambulance?: { alert_time: number };
}

export interface Weights {
  alpha: number; // urgency
  beta: number; // waiting time (per minute)
  gamma: number; // deterioration risk
  delta: number; // emergency priority
}

export interface SimParams {
  strategy: Strategy;
  duration: number;
  weights: Weights;
  emergencySurge: boolean;
  surgeStart: number;
  surgeCount: number;
  resourceFailure: boolean;
  failedResource: ResourceKey;
  failureStart: number;
  failureUnits: number;
  safetyThreshold: number;
  criticalUrgency: number;
  reservation?: boolean;
  protectAppointments?: boolean;
  preAlert?: boolean;
}

export interface ScoreBreakdown {
  urgency: number;
  waiting: number;
  risk: number;
  emergency: number;
  total: number;
  waiting_time: number;
  risk_value: number;
  hazard?: HazardBreakdown;
}

export interface HazardBreakdown {
  base_rate: number;
  wait_factor: number;
  harm_rate: number;
  footprint: number;
  index: number;
}

export interface SkippedCandidate {
  id: string;
  blocked_by: ResourceKey[];
}

export interface Decision {
  seq: number;
  time: number;
  score: ScoreBreakdown;
  required: ResourceRequest;
  available_before: ResourceSet;
  queue_length: number;
  skipped: SkippedCandidate[];
  blocked_minutes?: number;
  binding_resource?: ResourceKey | null;
  appointment_hold?: {
    minutes: number;
    appointment_id: string;
    kind?: "appointment" | "ambulance";
  };
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
  appointment: boolean;
  ambulance?: boolean;
  alert_time?: number | null;
  status: OutcomeStatus;
  start_time: number | null;
  end_time: number | null;
  wait_time: number;
  priority_score: number;
  decision: Decision | null;
}

export interface TimelinePoint {
  t: number;
  queue_length: number;
  in_treatment: number;
  treated: number;
  in_use: ResourceSet;
  capacity: ResourceSet;
  bottleneck?: ResourceKey | null;
}

export interface BottleneckEntry {
  resource: ResourceKey;
  blocked_patient_minutes: number;
  blocked_patients?: number;
}

export interface Metrics {
  total_patients: number;
  patients_arrived: number;
  patients_treated: number;
  average_wait: number;
  maximum_wait: number;
  critical_wait: number;
  queue_length_final: number;
  peak_queue_length: number;
  peak_queue_time: number;
  patients_remaining: number;
  resource_utilization: ResourceSet;
  resource_conflicts: number;
  safety_threshold_breaches: number;
  bottlenecks: BottleneckEntry[];
  configured_duration: number;
  actual_completion_time: number;
  total_waiting_time: number;
  critical_wait_total: number;
  resource_overload: number;
  appointments_total?: number;
  appointments_on_time?: number;
  appointment_average_delay?: number;
  appointment_max_delay?: number;
  walk_in_average_wait?: number;
  ambulance_total?: number;
  ambulance_on_arrival?: number;
  ambulance_average_wait?: number;
  ambulance_max_wait?: number;
  ambulance_average_lead?: number;
  objective_score: number;
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
  resources: ResourceSet;
  patients: PatientOutcome[];
  metrics: Metrics;
  timeline: TimelinePoint[];
  warnings: SimWarning[];
  completed: boolean;
  error: string | null;
  isPlaceholder: boolean;
  engine: string;
}

export const PLACEHOLDER_NOTICE =
  "Placeholder simulation output — connect the scheduling engine to generate calculated results.";
