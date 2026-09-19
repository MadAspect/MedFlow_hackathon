import type { NewPatient } from "./database";
import type { ResourceSet, SimParams } from "./simulation/types";

/**
 * Synthetic data only. No real patient information appears anywhere in MedFlow.
 */

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

/** 18 varied patients for "Load Example Data". */
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

/** Small hospital used by the one-click demo: capacity is deliberately tight. */
export const DEMO_RESOURCES: ResourceSet = {
  doctor: 3,
  nurse: 6,
  bed: 8,
  icu_bed: 2,
  operating_room: 1,
};

/**
 * 25 patients for the demo, listed in arrival order. Eight need an ICU bed and
 * three need the single operating room. The emergency surge adds more ICU
 * demand from minute 20. D06 (urgency 3) queues for the operating room from
 * minute 6 while D19 (urgency 4) arrives at minute 36, so when the room frees
 * at minute 40 Urgency Only and Dynamic Priority choose differently.
 */
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
]);

/** 60 minutes, surge from minute 20, one ICU bed fails at minute 35. */
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
