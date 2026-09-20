import { hazardScore, resourcePrices } from "./hazard";
import type {
  ResourceSet,
  ScoreBreakdown,
  SimParams,
  SimPatient,
  Strategy,
  Weights,
} from "./types";

export const DEFAULT_WEIGHTS: Weights = {
  alpha: 5.0,
  beta: 0.35,
  gamma: 2.0,
  delta: 3.0,
};

export const RISK_TIME_CONSTANT = 30;

export const STRATEGY_LABELS: Record<Strategy, string> = {
  fcfs: "First-Come, First-Served",
  urgency: "Urgency Only",
  dynamic: "Dynamic Priority",
  hazard: "Harm-Density Index",
};

export const FCFS_NOTE =
  "First-Come, First-Served is the most common and basic approach: whoever arrives first is treated first. It is the baseline the other two strategies are compared against.";

export const STRATEGY_DESCRIPTIONS: Record<Strategy, string> = {
  fcfs: "Treats patients strictly in arrival order. Simple and fair by arrival, but urgent patients can wait behind minor cases.",
  urgency:
    "Always treats the most urgent patient first (ties by arrival). Protects critical cases but can starve low-urgency patients.",
  dynamic:
    "Ranks by S = α·urgency + β·waiting + γ·risk + δ·emergency. Waiting time slowly lifts low-urgency patients so they are not starved.",
  hazard:
    "Ranks by I = h(wait) ÷ c: the harm rate of waiting (doubling per urgency level, accelerating with the wait) divided by the scarcity-priced resource-hours the treatment uses. Treats whoever relieves the most harm per unit of scarce resource; no weights to tune, and no one is starved.",
};

export const STRATEGIES: Strategy[] = ["fcfs", "urgency", "dynamic", "hazard"];

export function waitingTime(T: number, arrivalTime: number): number {
  return Math.max(0, T - arrivalTime);
}

export function deteriorationRisk(urgency: number, waiting: number): number {
  return (urgency / 5) * (1 - Math.exp(-Math.max(0, waiting) / RISK_TIME_CONSTANT));
}

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

const compareIds = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

const byArrivalThenId = (a: SimPatient, b: SimPatient) =>
  a.arrival_time - b.arrival_time || compareIds(a.id, b.id);

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
    case "hazard":
      return (
        b.score.total - a.score.total ||
        b.patient.urgency - a.patient.urgency ||
        byArrivalThenId(a.patient, b.patient) ||
        a.index - b.index
      );
  }
}

export function rankQueue(
  queue: { index: number; patient: SimPatient }[],
  T: number,
  params: Pick<SimParams, "strategy" | "weights">,
  capacity: ResourceSet,
): RankedCandidate[] {
  const prices =
    params.strategy === "hazard" ? resourcePrices(queue.map((q) => q.patient), capacity) : null;
  return queue
    .map(({ index, patient }) => ({
      index,
      patient,
      score: prices
        ? hazardScore(patient, T, prices, capacity)
        : scoreBreakdown(patient, T, params.weights),
    }))
    .sort((a, b) => compareCandidates(params.strategy, a, b));
}
