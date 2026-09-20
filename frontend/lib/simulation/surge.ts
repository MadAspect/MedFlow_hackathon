import type { ResourceRequest, SimPatient } from "./types";

const URGENCIES = [5, 4, 5, 3, 4, 5, 4, 3, 5, 4];
const TREATMENT_TIMES = [25, 25, 35, 20, 25, 40, 25, 20, 30, 25];
const CONDITIONS = [
  "Multi-trauma",
  "Cardiac event",
  "Severe burns",
  "Fracture",
  "Respiratory failure",
  "Stroke",
  "Abdominal emergency",
  "Laceration",
  "Sepsis",
  "Head injury",
];

const NEEDS: ResourceRequest[] = [
  { nurse: 1, icu_bed: 1 },
  { nurse: 1, icu_bed: 1 },
  { doctor: 1, nurse: 1, bed: 1 },
  { doctor: 1, nurse: 1, bed: 1 },
  { nurse: 1, icu_bed: 1 },
  { doctor: 1, nurse: 1, bed: 1 },
  { nurse: 1, icu_bed: 1 },
  { nurse: 1, bed: 1 },
  { nurse: 1, icu_bed: 1 },
  { nurse: 1, icu_bed: 1 },
];

export function generateSurgePatients(
  surgeStart: number,
  count: number,
): SimPatient[] {
  const patients: SimPatient[] = [];
  for (let i = 0; i < count; i++) {
    const k = i % URGENCIES.length;
    patients.push({
      id: `SURGE-${String(i + 1).padStart(2, "0")}`,
      condition: `${CONDITIONS[k]} (surge)`,
      arrival_time: surgeStart + i,
      urgency: URGENCIES[k],
      treatment_time: TREATMENT_TIMES[k],
      required_resources: { ...NEEDS[k] },
      emergency: true,
    });
  }
  return patients;
}
