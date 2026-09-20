import { RESOURCE_KEYS, type ResourceSet, type ScoreBreakdown, type SimPatient } from "./types";

export const HAZARD_PARAMS = {
  levelFactor: 2,
  tau: 30,
  kappa: 2,
} as const;

const MIN_FOOTPRINT = 1e-9;

export function baseRate(urgency: number, emergency: boolean): number {
  return HAZARD_PARAMS.levelFactor ** (urgency + (emergency ? 1 : 0) - 1);
}

export function waitFactor(waiting: number): number {
  return (1 + Math.max(0, waiting) / HAZARD_PARAMS.tau) ** HAZARD_PARAMS.kappa;
}

export function harmRate(urgency: number, emergency: boolean, waiting: number): number {
  return baseRate(urgency, emergency) * waitFactor(waiting);
}

export function cumulativeHarm(urgency: number, emergency: boolean, waiting: number): number {
  const { tau, kappa } = HAZARD_PARAMS;
  const w = Math.max(0, waiting);
  return baseRate(urgency, emergency) * (tau / (kappa + 1)) * ((1 + w / tau) ** (kappa + 1) - 1);
}

export function resourcePrices(queue: SimPatient[], capacity: ResourceSet): ResourceSet {
  const prices = {} as ResourceSet;
  for (const k of RESOURCE_KEYS) {
    let demand = 0;
    for (const p of queue) demand += p.required_resources[k] ?? 0;
    prices[k] = 1 + demand / Math.max(1, capacity[k]);
  }
  return prices;
}

export function footprint(patient: SimPatient, prices: ResourceSet, capacity: ResourceSet): number {
  let share = 0;
  for (const k of RESOURCE_KEYS) {
    share += (prices[k] * (patient.required_resources[k] ?? 0)) / Math.max(1, capacity[k]);
  }
  return Math.max(MIN_FOOTPRINT, (patient.treatment_time / 60) * share);
}

export function hazardScore(
  patient: SimPatient,
  T: number,
  prices: ResourceSet,
  capacity: ResourceSet,
): ScoreBreakdown {
  const waiting = Math.max(0, T - patient.arrival_time);
  const base = baseRate(patient.urgency, patient.emergency === true);
  const factor = waitFactor(waiting);
  const rate = base * factor;
  const cost = footprint(patient, prices, capacity);
  const index = rate / cost;
  return {
    urgency: 0,
    waiting: 0,
    risk: 0,
    emergency: 0,
    total: index,
    waiting_time: waiting,
    risk_value: 0,
    hazard: { base_rate: base, wait_factor: factor, harm_rate: rate, footprint: cost, index },
  };
}
