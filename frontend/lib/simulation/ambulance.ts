import type { PatientOutcome, SimPatient } from "./types";

export const AMBULANCE_GRACE = 10;

export const MAX_AMBULANCE_MINUTES = 240;

export const ambulanceEta = (p: { arrival_time: number; alert_time: number }): number => p.arrival_time - p.alert_time;

export const isInbound = (p: { arrival_time: number; alert_time?: number | null }, t: number): boolean =>
  p.alert_time != null && p.alert_time <= t && t < p.arrival_time;

export const isPreAlerted = (p: SimPatient, preAlert: boolean | undefined): boolean =>
  p.ambulance !== undefined && preAlert !== false;

export const ambulanceOutcomes = (patients: PatientOutcome[]): PatientOutcome[] =>
  patients.filter((p) => p.ambulance === true).sort((a, b) => a.arrival_time - b.arrival_time || a.id.localeCompare(b.id));
