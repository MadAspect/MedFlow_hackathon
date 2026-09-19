/** Synthetic condition labels. Patients pick from this list, so no free text is stored. */
export const CONDITIONS = [
  "Cardiac event",
  "Stroke",
  "Multi-trauma",
  "Respiratory failure",
  "Sepsis",
  "Fracture",
  "Abdominal emergency",
  "Head injury",
  "Severe burns",
  "Laceration",
  "Minor illness",
  "Routine check",
] as const;

export type Condition = (typeof CONDITIONS)[number];

export const DISCLAIMER =
  "This project is a simulation and decision-support prototype. It is not a clinical diagnosis, treatment, or patient-management system.";

export const DATA_NOTICE = "Synthetic patient data only.";
