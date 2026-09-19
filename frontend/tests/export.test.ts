import { describe, expect, it } from "vitest";
import { CSV_COLUMNS, outcomesToCsv } from "@/lib/export";
import { emptyResourceSet, runSimulation, type SimPatient } from "@/lib/simulation";

const P = (id: string, condition: string, arrival: number, urgency: number): SimPatient => ({
  id,
  condition,
  arrival_time: arrival,
  urgency,
  treatment_time: 10,
  required_resources: { doctor: 1, nurse: 2 },
});

const run = (patients: SimPatient[]) =>
  runSimulation(patients, { ...emptyResourceSet(), doctor: 1, nurse: 2 }, { strategy: "fcfs", duration: 60 });

describe("CSV export", () => {
  it("writes a header and one row per patient", () => {
    const csv = outcomesToCsv(run([P("A", "Fracture", 0, 3), P("B", "Cough", 1, 1)]));
    const lines = csv.trimEnd().split("\n");
    expect(lines[0]).toBe(CSV_COLUMNS.join(","));
    expect(lines).toHaveLength(3);
    // A starts at 0, B waits for the single doctor until minute 10.
    expect(lines[1]).toMatch(/^A,Fracture,3,0,0,10,0,10,treated,/);
    expect(lines[2]).toMatch(/^B,Cough,1,1,10,20,9,10,treated,/);
    expect(lines[2]).toContain("doctor:1 nurse:2");
  });

  it("quotes commas, quotes and newlines", () => {
    const csv = outcomesToCsv(run([P("A", 'Chest pain, "severe"\nnight', 0, 3)]));
    expect(csv).toContain('"Chest pain, ""severe""\nnight"');
  });

  it("neutralises spreadsheet formulas in user-typed text", () => {
    const csv = outcomesToCsv(run([P("A", "=HYPERLINK(\"http://x\")", 0, 3), P("B", "+1 call", 1, 2), P("C", "@SUM(A1)", 2, 2)]));
    for (const raw of ["'=HYPERLINK", "'+1 call", "'@SUM"]) expect(csv).toContain(raw);
    // No cell may begin with a formula character.
    for (const line of csv.split("\n").slice(1)) {
      for (const c of line.split(",")) expect(c).not.toMatch(/^[=+@]/);
    }
  });
});
