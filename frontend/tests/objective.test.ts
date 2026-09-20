import { describe, expect, it } from "vitest";
import {
  OBJECTIVE_WEIGHTS,
  emptyResourceSet,
  runSimulation,
  type ResourceRequest,
  type ResourceSet,
  type SimPatient,
} from "@/lib/simulation";

const P = (id: string, arrival: number, urgency: number, treatment: number, required: ResourceRequest = { doctor: 1 }): SimPatient => ({
  id,
  condition: "Test",
  arrival_time: arrival,
  urgency,
  treatment_time: treatment,
  required_resources: required,
});
const R = (over: Partial<ResourceSet> = {}): ResourceSet => ({ ...emptyResourceSet(), ...over });

describe("objective function", () => {
  it("documents every weight and includes completion time", () => {
    expect(OBJECTIVE_WEIGHTS).toEqual({
      totalWaiting: 1.0,
      criticalWaiting: 4.0,
      patientsRemaining: 10000.0,
      resourceOverload: 10000.0,
      maxWaiting: 0.5,
      completionTime: 0.5,
    });
  });

  it("a longer completion time raises the score when waits are equal", () => {
    // one patient, no waiting: score is exactly 0.5 * completion time
    const out = runSimulation([P("A", 0, 3, 40)], R({ doctor: 1 }), { strategy: "fcfs", duration: 60 });
    expect(out.metrics.objective_score).toBe(0.5 * 40);
  });
});

describe("staff shortage", () => {
  it("a doctor outage is reported as a staff shortage and delays patients", () => {
    const patients = [P("A", 0, 3, 20), P("B", 0, 3, 20), P("C", 0, 3, 20)];
    const base = runSimulation(patients, R({ doctor: 2 }), { strategy: "fcfs", duration: 100 });
    const short = runSimulation(patients, R({ doctor: 2 }), { strategy: "fcfs", duration: 100, resourceFailure: true, failedResource: "doctor", failureStart: 0, failureUnits: 1 });
    expect(short.warnings.find((w) => w.code === "failure")?.message).toMatch(/^Staff shortage: 1 × doctor unavailable from minute 0/);
    expect(short.metrics.actual_completion_time).toBeGreaterThan(base.metrics.actual_completion_time);
    expect(short.completed).toBe(true);
  });

  it("an equipment failure keeps the resource-failure wording", () => {
    const out = runSimulation([P("A", 0, 3, 10, { icu_bed: 1 })], R({ icu_bed: 2 }), { duration: 30, resourceFailure: true, failedResource: "icu_bed", failureStart: 5, failureUnits: 1 });
    expect(out.warnings.find((w) => w.code === "failure")?.message).toMatch(/^Resource failure:/);
  });
});
