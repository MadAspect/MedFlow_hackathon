import type {
  ScoreBreakdown,
  SimParams,
  SimPatient,
  Strategy,
  Weights,
} from "./types";

/** Transparent default weights for the dynamic priority score. */
export const DEFAULT_WEIGHTS: Weights = {
  alpha: 4.0,
  beta: 0.15,
  gamma: 3.0,
  delta: 2.0,
};

/** Minutes for the deterioration-risk curve to reach ~63% of its ceiling. */
export const RISK_TIME_CONSTANT = 30;

export const STRATEGY_LABELS: Record<Strategy, string> = {
  fcfs: "First-Come, First-Served",
  urgency: "Urgency Only",
  dynamic: "Dynamic Priority",
};

export const STRATEGY_DESCRIPTIONS: Record<Strategy, string> = {
  fcfs: "Treats patients strictly in arrival order. Fair by arrival, but urgent patients can wait behind minor cases.",
  urgency:
    "Always treats the most urgent patient first (ties by arrival). Protects critical cases but can starve low-urgency patients.",
  dynamic:
    "Ranks by S = α·urgency + β·waiting + γ·risk + δ·emergency. Waiting time slowly lifts low-urgency patients so they are not starved.",
};

export const STRATEGIES: Strategy[] = ["fcfs", "urgency", "dynamic"];

/** w_i(T) = T - a_i (never negative: a patient cannot wait before arriving). */
export function waitingTime(T: number, arrivalTime: number): number {
  return Math.max(0, T - arrivalTime);
}

/**
 * Deterioration risk r_i(T) in [0, 1):
 *   r_i = (u_i / 5) · (1 − exp(−w_i / τ))
 * Riskier (more urgent) patients deteriorate faster the longer they wait.
 * This is a modelling assumption for the simulation, not a clinical model.
 */
export function deteriorationRisk(urgency: number, waiting: number): number {
  return (urgency / 5) * (1 - Math.exp(-Math.max(0, waiting) / RISK_TIME_CONSTANT));
}

/** S_i(T) with every term exposed so the UI can explain a decision. */
export function scoreBreakdown(
  patient: SimPatient,
  T: number,
  weights: Weights,
): ScoreBreakdown {
  const w = waitingTime(T, patient.arrival_time);
  const r = deteriorationRisk(patient.urgency, w);
  const emergencyPriority = patient.emergency ? 1 : 0;
  const urgency = weights.alpha * patient.urgency;
  const waiting = weights.beta * w;
  const risk = weights.gamma * r;
  const emergency = weights.delta * emergencyPriority;
  return {
    urgency,
    waiting,
    risk,
    emergency,
    total: urgency + waiting + risk + emergency,
    waiting_time: w,
    risk_value: r,
  };
}

export interface RankedCandidate {
  index: number;
  patient: SimPatient;
  score: ScoreBreakdown;
}

const byArrivalThenId = (a: SimPatient, b: SimPatient) =>
  a.arrival_time - b.arrival_time || a.id.localeCompare(b.id);

/**
 * Comparator for a scheduling policy: negative means `a` is treated before `b`.
 * Every policy is deterministic (ties fall back to arrival time, then id) so
 * the strategy comparison is reproducible.
 */
export function compareCandidates(
  strategy: Strategy,
  a: RankedCandidate,
  b: RankedCandidate,
): number {
  switch (strategy) {
    case "fcfs":
      return byArrivalThenId(a.patient, b.patient) || a.index - b.index;
    case "urgency":
      return (
        b.patient.urgency - a.patient.urgency ||
        byArrivalThenId(a.patient, b.patient) ||
        a.index - b.index
      );
    case "dynamic":
      return (
        b.score.total - a.score.total ||
        b.patient.urgency - a.patient.urgency ||
        byArrivalThenId(a.patient, b.patient) ||
        a.index - b.index
      );
  }
}

/** Order the waiting queue at time T according to the chosen strategy. */
export function rankQueue(
  queue: { index: number; patient: SimPatient }[],
  T: number,
  params: Pick<SimParams, "strategy" | "weights">,
): RankedCandidate[] {
  return queue
    .map(({ index, patient }) => ({
      index,
      patient,
      score: scoreBreakdown(patient, T, params.weights),
    }))
    .sort((a, b) => compareCandidates(params.strategy, a, b));
}
