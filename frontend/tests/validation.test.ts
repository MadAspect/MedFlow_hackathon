import { describe, expect, it } from "vitest";
import {
  parseNumberField,
  validatePatient,
  validateResources,
  validateSimulationControls,
} from "@/lib/validation";

const valid = {
  patient_id: "P100",
  condition: "Fracture",
  arrival_time: 5,
  urgency: 3,
  treatment_time: 20,
  required_resources: { doctor: 1, bed: 1 },
};

const errorsOf = (input: unknown, existing: string[] = []) => {
  const r = validatePatient(input, existing);
  return r.ok ? {} : r.errors;
};

describe("patient validation", () => {
  it("accepts a valid patient and drops zero-unit resources", () => {
    const r = validatePatient({ ...valid, required_resources: { doctor: 1, nurse: 0 } });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.required_resources).toEqual({ doctor: 1 });
  });

  it("rejects an empty patient ID", () => {
    expect(errorsOf({ ...valid, patient_id: "   " }).patient_id).toMatch(/required/i);
  });

  it("rejects unsafe characters in the patient ID", () => {
    expect(errorsOf({ ...valid, patient_id: "P1'; DROP TABLE" }).patient_id).toBeDefined();
  });

  it("detects duplicate patient IDs, ignoring case", () => {
    expect(errorsOf(valid, ["P100"]).patient_id).toMatch(/already exists/);
    expect(errorsOf({ ...valid, patient_id: "p100" }, ["P100"]).patient_id).toMatch(/already exists/);
    expect(validatePatient(valid, ["P101"]).ok).toBe(true);
  });

  it("rejects negative or missing arrival time", () => {
    expect(errorsOf({ ...valid, arrival_time: -1 }).arrival_time).toMatch(/negative/);
    expect(errorsOf({ ...valid, arrival_time: parseNumberField("") }).arrival_time).toBeDefined();
    expect(errorsOf({ ...valid, arrival_time: 1.5 }).arrival_time).toMatch(/whole/);
  });

  it("only allows urgency from 1 to 5", () => {
    expect(errorsOf({ ...valid, urgency: 0 }).urgency).toBeDefined();
    expect(errorsOf({ ...valid, urgency: 6 }).urgency).toBeDefined();
    expect(errorsOf({ ...valid, urgency: 2.5 }).urgency).toBeDefined();
    for (const u of [1, 2, 3, 4, 5]) expect(validatePatient({ ...valid, urgency: u }).ok).toBe(true);
  });

  it("requires treatment time greater than zero", () => {
    expect(errorsOf({ ...valid, treatment_time: 0 }).treatment_time).toMatch(/greater than zero/);
    expect(errorsOf({ ...valid, treatment_time: -5 }).treatment_time).toBeDefined();
  });

  it("requires at least one resource", () => {
    expect(errorsOf({ ...valid, required_resources: {} }).required_resources).toMatch(/at least one/i);
    expect(errorsOf({ ...valid, required_resources: { doctor: 0 } }).required_resources).toBeDefined();
  });

  it("rejects unknown resources and conditions outside the list", () => {
    expect(errorsOf({ ...valid, required_resources: { helicopter: 1 } }).required_resources).toMatch(/Unknown/);
    expect(errorsOf({ ...valid, condition: "<script>" }).condition).toBeDefined();
  });

  it("parses form fields safely", () => {
    expect(parseNumberField(" 12 ")).toBe(12);
    expect(parseNumberField("")).toBeNaN();
    expect(parseNumberField("abc")).toBeNaN();
  });
});

describe("resource validation", () => {
  const ok = { doctor: 5, nurse: 10, bed: 20, icu_bed: 5, operating_room: 2 };

  it("accepts the default configuration and zeros", () => {
    expect(validateResources(ok).ok).toBe(true);
    expect(validateResources({ ...ok, doctor: 0 }).ok).toBe(true);
  });

  it("rejects negative counts", () => {
    const r = validateResources({ ...ok, icu_bed: -1 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.icu_bed).toMatch(/negative/);
  });

  it("rejects non-integers and missing values", () => {
    expect(validateResources({ ...ok, nurse: 2.5 }).ok).toBe(false);
    expect(validateResources({ ...ok, bed: NaN }).ok).toBe(false);
  });
});

describe("simulation controls validation", () => {
  it("bounds duration and start times", () => {
    const ok = { duration: 60, surgeStart: 20, failureStart: 35, failureUnits: 1 };
    expect(validateSimulationControls(ok).ok).toBe(true);
    expect(validateSimulationControls({ ...ok, duration: 0 }).ok).toBe(false);
    expect(validateSimulationControls({ ...ok, surgeStart: -1 }).ok).toBe(false);
    expect(validateSimulationControls({ ...ok, failureUnits: 0 }).ok).toBe(false);
  });
});
