import type { NewPatient } from "./database";
import type { ResourceSet, SimParams } from "./simulation/types";

type Row = [
  id: string,
  condition: string,
  arrival: number,
  urgency: number,
  treatment: number,
  resources: NewPatient["required_resources"],
];

const build = (rows: Row[]): NewPatient[] =>
  rows.map(([patient_id, condition, arrival_time, urgency, treatment_time, required_resources]) => ({
    patient_id,
    condition,
    arrival_time,
    urgency,
    treatment_time,
    required_resources,
  }));

export const EXAMPLE_PATIENTS: NewPatient[] = build([
  ["P001", "Cardiac event", 0, 5, 35, { doctor: 1, nurse: 2, icu_bed: 1 }],
  ["P002", "Fracture", 2, 3, 25, { doctor: 1, nurse: 1, bed: 1 }],
  ["P003", "Routine check", 5, 1, 15, { nurse: 1, bed: 1 }],
  ["P004", "Stroke", 8, 5, 40, { doctor: 1, nurse: 2, icu_bed: 1 }],
  ["P005", "Minor illness", 10, 1, 10, { nurse: 1, bed: 1 }],
  ["P006", "Abdominal emergency", 12, 4, 45, { doctor: 2, nurse: 2, operating_room: 1 }],
  ["P007", "Laceration", 15, 2, 20, { doctor: 1, nurse: 1, bed: 1 }],
  ["P008", "Respiratory failure", 18, 5, 50, { doctor: 1, nurse: 2, icu_bed: 1 }],
  ["P009", "Sepsis", 22, 4, 30, { doctor: 1, nurse: 1, icu_bed: 1 }],
  ["P010", "Head injury", 25, 4, 35, { doctor: 1, nurse: 2, bed: 1 }],
  ["P011", "Routine check", 28, 1, 12, { nurse: 1, bed: 1 }],
  ["P012", "Multi-trauma", 30, 5, 60, { doctor: 2, nurse: 3, operating_room: 1 }],
  ["P013", "Fracture", 35, 2, 25, { doctor: 1, nurse: 1, bed: 1 }],
  ["P014", "Minor illness", 40, 1, 10, { nurse: 1, bed: 1 }],
  ["P015", "Severe burns", 45, 4, 40, { doctor: 1, nurse: 2, icu_bed: 1 }],
  ["P016", "Laceration", 50, 3, 20, { doctor: 1, nurse: 1, bed: 1 }],
  ["P017", "Cardiac event", 60, 3, 30, { doctor: 1, nurse: 1, bed: 1 }],
  ["P018", "Stroke", 70, 4, 45, { doctor: 1, nurse: 2, operating_room: 1 }],
]);

export const EXAMPLE_APPOINTMENTS: NewPatient[] = build([
  ["A001", "Routine check", 30, 1, 15, { doctor: 1, nurse: 1, bed: 1 }],
  ["A002", "Fracture", 45, 2, 30, { doctor: 1, nurse: 1, bed: 1 }],
  ["A003", "Laceration", 60, 2, 20, { doctor: 1, nurse: 1, bed: 1 }],
  ["A004", "Fracture", 75, 3, 45, { doctor: 2, nurse: 2, operating_room: 1 }],
  ["A005", "Routine check", 90, 1, 15, { doctor: 1, nurse: 1, bed: 1 }],
  ["A006", "Minor illness", 105, 1, 10, { doctor: 1, nurse: 1, bed: 1 }],
]).map((p) => ({ ...p, appointment: true }));

export const EXAMPLE_AMBULANCES: NewPatient[] = (
  [
    ["M001", "Cardiac event", 8, 20, 5, 35, { doctor: 1, nurse: 2, icu_bed: 1 }],
    ["M002", "Multi-trauma", 28, 40, 5, 60, { doctor: 2, nurse: 3, operating_room: 1 }],
    ["M003", "Stroke", 47, 55, 4, 40, { doctor: 1, nurse: 2, icu_bed: 1 }],
    ["M004", "Respiratory failure", 58, 65, 5, 45, { doctor: 1, nurse: 2, icu_bed: 1 }],
    ["M005", "Severe burns", 70, 80, 4, 40, { doctor: 1, nurse: 2, icu_bed: 1 }],
  ] as [string, string, number, number, number, number, NewPatient["required_resources"]][]
).map(([patient_id, condition, alert_time, arrival_time, urgency, treatment_time, required_resources]) => ({
  patient_id,
  condition,
  arrival_time,
  urgency,
  treatment_time,
  required_resources,
  alert_time,
}));

export const DEMO_RESOURCES: ResourceSet = {
  doctor: 3,
  nurse: 6,
  bed: 8,
  icu_bed: 2,
  operating_room: 1,
};

const DEMO_AMBULANCE_ALERTS: Record<string, number> = { D07: 0, D12: 6, D20: 22, D23: 33 };

export const DEMO_PATIENTS: NewPatient[] = build([
  ["D01", "Routine check", 0, 2, 15, { nurse: 1, bed: 1 }],
  ["D02", "Fracture", 1, 3, 20, { nurse: 1, bed: 1 }],
  ["D03", "Cardiac event", 2, 5, 25, { nurse: 1, icu_bed: 1 }],
  ["D04", "Minor illness", 3, 1, 10, { nurse: 1, bed: 1 }],
  ["D05", "Abdominal emergency", 5, 4, 35, { doctor: 1, nurse: 1, operating_room: 1 }],
  ["D06", "Fracture", 6, 3, 30, { doctor: 1, nurse: 1, operating_room: 1 }],
  ["D07", "Respiratory failure", 8, 5, 25, { nurse: 1, icu_bed: 1 }],
  ["D08", "Laceration", 9, 2, 15, { nurse: 1, bed: 1 }],
  ["D09", "Routine check", 11, 1, 10, { nurse: 1, bed: 1 }],
  ["D10", "Minor illness", 14, 2, 15, { nurse: 1, bed: 1 }],
  ["D11", "Head injury", 15, 2, 20, { nurse: 1, bed: 1 }],
  ["D12", "Stroke", 17, 4, 25, { nurse: 1, icu_bed: 1 }],
  ["D13", "Routine check", 18, 1, 10, { nurse: 1, bed: 1 }],
  ["D14", "Sepsis", 21, 3, 25, { nurse: 1, icu_bed: 1 }],
  ["D15", "Laceration", 24, 2, 15, { nurse: 1, bed: 1 }],
  ["D16", "Fracture", 26, 2, 20, { nurse: 1, bed: 1 }],
  ["D17", "Severe burns", 28, 4, 25, { nurse: 1, icu_bed: 1 }],
  ["D18", "Minor illness", 30, 1, 10, { nurse: 1, bed: 1 }],
  ["D19", "Multi-trauma", 36, 4, 25, { doctor: 1, nurse: 1, operating_room: 1 }],
  ["D20", "Cardiac event", 33, 5, 25, { nurse: 1, icu_bed: 1 }],
  ["D21", "Routine check", 36, 2, 15, { nurse: 1, bed: 1 }],
  ["D22", "Fracture", 40, 3, 20, { nurse: 1, bed: 1 }],
  ["D23", "Respiratory failure", 43, 4, 25, { nurse: 1, icu_bed: 1 }],
  ["D24", "Minor illness", 47, 1, 10, { nurse: 1, bed: 1 }],
  ["D25", "Laceration", 52, 2, 25, { nurse: 1, bed: 1 }],
]).map((p) => (p.patient_id in DEMO_AMBULANCE_ALERTS ? { ...p, alert_time: DEMO_AMBULANCE_ALERTS[p.patient_id] } : p));

/** Booked appointments for the demo: fixed slots that hold a doctor, a nurse and a bed. */
export const DEMO_APPOINTMENTS: NewPatient[] = build([
  ["A01", "Routine check", 12, 1, 15, { doctor: 1, nurse: 1, bed: 1 }],
  ["A02", "Fracture", 20, 2, 25, { doctor: 1, nurse: 1, bed: 1 }],
  ["A03", "Minor illness", 30, 1, 10, { doctor: 1, nurse: 1, bed: 1 }],
  ["A04", "Laceration", 38, 2, 20, { doctor: 1, nurse: 1, bed: 1 }],
  ["A05", "Routine check", 45, 1, 15, { doctor: 1, nurse: 1, bed: 1 }],
]).map((p) => ({ ...p, appointment: true }));

export const DEMO_PARAMS: Partial<SimParams> = {
  strategy: "dynamic",
  duration: 60,
  emergencySurge: true,
  surgeStart: 20,
  resourceFailure: true,
  failedResource: "icu_bed",
  failureStart: 35,
  failureUnits: 1,
};

export const CONTRAST_PATIENTS: NewPatient[] = build([
  ["A", "Fracture", 0, 2, 20, { nurse: 1, icu_bed: 1 }],
  ["B", "Cardiac event", 1, 5, 20, { doctor: 1, nurse: 1, icu_bed: 1 }],
  ["C", "Routine check", 2, 1, 10, { nurse: 1, icu_bed: 1 }],
  ["D", "Respiratory failure", 3, 4, 15, { doctor: 1, nurse: 1, icu_bed: 1 }],
  ["E", "Sepsis", 30, 4, 15, { doctor: 1, nurse: 1, icu_bed: 1 }],
  ["F", "Stroke", 45, 5, 15, { doctor: 1, nurse: 1, icu_bed: 1 }],
  ["G", "Head injury", 60, 4, 15, { doctor: 1, nurse: 1, icu_bed: 1 }],
]);

export const CONTRAST_RESOURCES: ResourceSet = {
  doctor: 2,
  nurse: 2,
  bed: 2,
  icu_bed: 1,
  operating_room: 1,
};

export const CONTRAST_PARAMS: Partial<SimParams> = {
  strategy: "dynamic",
  duration: 60,
  emergencySurge: false,
  resourceFailure: false,
};

export const CONTRAST_MESSAGE =
  "This scenario is designed to make the scheduling trade-offs visible. It does not change the algorithms.";
