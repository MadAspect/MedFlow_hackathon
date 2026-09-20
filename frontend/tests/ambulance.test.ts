import { describe, expect, it } from "vitest";
import {
  AMBULANCE_GRACE,
  SimulationInputError,
  ambulanceEta,
  analyse,
  emptyResourceSet,
  isInbound,
  runSimulation,
  type ResourceRequest,
  type ResourceSet,
  type SimPatient,
  type SimulationOutput,
} from "@/lib/simulation";

const P = (id: string, arrival: number, urgency: number, treatment: number, required: ResourceRequest = { doctor: 1 }): SimPatient => ({
  id,
  condition: "Test",
  arrival_time: arrival,
  urgency,
  treatment_time: treatment,
  required_resources: required,
});
/** An ambulance patient: the hospital is warned at `alert`, the ambulance reaches the door at `arrival`. */
const A = (id: string, alert: number, arrival: number, urgency: number, treatment: number, required?: ResourceRequest): SimPatient => ({
  ...P(id, arrival, urgency, treatment, required),
  ambulance: { alert_time: alert },
});
const R = (over: Partial<ResourceSet> = {}): ResourceSet => ({ ...emptyResourceSet(), ...over });
const byId = (out: SimulationOutput, id: string) => out.patients.find((p) => p.id === id)!;

describe("ambulance pre-alert", () => {
  // One doctor. Walk-in W arrives at 15 and needs 40 minutes; ambulance M is warned at 10 and arrives at 30.
  const scenario = [P("W", 15, 2, 40), A("M", 10, 30, 4, 20)];

  it("holds a non-urgent walk-in back so the ambulance patient is received on arrival", () => {
    const out = runSimulation(scenario, R({ doctor: 1 }), { strategy: "fcfs", duration: 120 });
    expect(byId(out, "M").start_time).toBe(30);
    expect(byId(out, "M").wait_time).toBe(0);
    expect(byId(out, "W").start_time).toBe(50); // waited for the ambulance patient
    expect(byId(out, "W").decision!.appointment_hold).toEqual({ minutes: 15, appointment_id: "M", kind: "ambulance" });
    expect(out.completed).toBe(true);
  });

  it("without pre-alerts the walk-in takes the doctor and the ambulance patient waits", () => {
    const out = runSimulation(scenario, R({ doctor: 1 }), { strategy: "fcfs", duration: 120, preAlert: false });
    expect(byId(out, "W").start_time).toBe(15);
    expect(byId(out, "M").start_time).toBe(55);
    expect(byId(out, "M").wait_time).toBe(25);
    expect(byId(out, "W").decision!.appointment_hold).toBeUndefined();
  });

  it("cannot act on a warning that has not been sent yet", () => {
    // W arrives at 5, before the alert at 10: the hospital does not know about M yet.
    const out = runSimulation([P("W", 5, 2, 40), A("M", 10, 30, 4, 20)], R({ doctor: 1 }), { strategy: "fcfs", duration: 120 });
    expect(byId(out, "W").start_time).toBe(5);
    expect(byId(out, "M").wait_time).toBe(15); // W runs until 45
  });

  it("never holds back a top-urgency walk-in", () => {
    const out = runSimulation([P("W", 15, 5, 40), A("M", 10, 30, 4, 20)], R({ doctor: 1 }), { strategy: "fcfs", duration: 120 });
    expect(byId(out, "W").start_time).toBe(15);
    expect(byId(out, "W").decision!.appointment_hold).toBeUndefined();
  });

  it("does not hold anything back when the walk-in finishes before the ambulance arrives", () => {
    const out = runSimulation([P("W", 15, 2, 10), A("M", 10, 30, 4, 20)], R({ doctor: 1 }), { strategy: "fcfs", duration: 120 });
    expect(byId(out, "W").start_time).toBe(15);
    expect(byId(out, "M").wait_time).toBe(0);
  });

  it("serves the arriving ambulance patient ahead of a queued non-urgent walk-in under every strategy", () => {
    for (const strategy of ["fcfs", "urgency", "dynamic", "hazard"] as const) {
      const out = runSimulation([P("BUSY", 0, 3, 30), P("W", 5, 2, 20), A("M", 10, 32, 3, 20)], R({ doctor: 1 }), { strategy, duration: 120 });
      expect(byId(out, "M").start_time, strategy).toBeLessThan(byId(out, "W").start_time!);
    }
  });

  it("uses the same reservation logic for two ambulances due together", () => {
    const out = runSimulation(
      [P("W", 15, 2, 60, { doctor: 2 }), A("M1", 5, 30, 4, 20, { doctor: 1 }), A("M2", 5, 30, 4, 20, { doctor: 1 })],
      R({ doctor: 2 }),
      { strategy: "fcfs", duration: 120 },
    );
    expect(byId(out, "M1").wait_time).toBe(0);
    expect(byId(out, "M2").wait_time).toBe(0);
    expect(byId(out, "W").start_time).toBe(50);
  });

  it("is deterministic and never mutates its input", () => {
    const before = JSON.stringify(scenario);
    const a = runSimulation(scenario, R({ doctor: 1 }), { strategy: "dynamic", duration: 120 });
    const b = runSimulation(scenario, R({ doctor: 1 }), { strategy: "dynamic", duration: 120 });
    expect(JSON.stringify(scenario)).toBe(before);
    expect(JSON.stringify(a.patients)).toBe(JSON.stringify(b.patients));
  });
});

describe("ambulance outcomes and metrics", () => {
  const out = runSimulation([P("W", 15, 2, 40), A("M", 10, 30, 4, 20)], R({ doctor: 1 }), { strategy: "fcfs", duration: 120 });

  it("flags ambulance outcomes and keeps the alert time", () => {
    expect(byId(out, "M").ambulance).toBe(true);
    expect(byId(out, "M").alert_time).toBe(10);
    expect(byId(out, "W").ambulance).toBe(false);
    expect(byId(out, "W").alert_time).toBeNull();
  });

  it("counts ambulance arrivals, on-arrival starts, waits and warning time", () => {
    expect(out.metrics.ambulance_total).toBe(1);
    expect(out.metrics.ambulance_on_arrival).toBe(1);
    expect(out.metrics.ambulance_average_wait).toBe(0);
    expect(out.metrics.ambulance_max_wait).toBe(0);
    expect(out.metrics.ambulance_average_lead).toBe(20);
  });

  it("keeps ambulance patients out of the walk-in average", () => {
    expect(out.metrics.walk_in_average_wait).toBe(35); // W arrived at 15 and started at 50
  });

  it("warns when an ambulance patient waited longer than the grace period", () => {
    const late = runSimulation([P("W", 15, 2, 40), A("M", 10, 30, 4, 20)], R({ doctor: 1 }), { strategy: "fcfs", duration: 120, preAlert: false });
    expect(late.metrics.ambulance_on_arrival).toBe(0);
    expect(late.warnings.find((w) => w.code === "ambulance_late")?.message).toContain(`more than ${AMBULANCE_GRACE} minutes`);
    expect(out.warnings.find((w) => w.code === "ambulance_late")).toBeUndefined();
  });

  it("reports zero ambulances for a run without any", () => {
    const plain = runSimulation([P("A", 0, 3, 10)], R({ doctor: 1 }), { duration: 30 });
    expect(plain.metrics.ambulance_total).toBe(0);
    expect(plain.warnings.find((w) => w.code === "ambulance_late")).toBeUndefined();
  });
});

describe("ambulance input validation", () => {
  const run = (p: SimPatient) => () => runSimulation([p], R({ doctor: 1 }), { duration: 60 });

  it("rejects a warning that comes after the arrival", () => {
    expect(run(A("M", 40, 30, 3, 10))).toThrow(SimulationInputError);
    expect(run(A("M", 40, 30, 3, 10))).toThrow(/pre-alert/);
  });

  it("rejects a negative or fractional alert time", () => {
    expect(run(A("M", -1, 30, 3, 10))).toThrow(SimulationInputError);
    expect(run(A("M", 2.5, 30, 3, 10))).toThrow(SimulationInputError);
  });

  it("rejects an absurdly long journey", () => {
    expect(run(A("M", 0, 1000, 3, 10))).toThrow(/journey/);
  });

  it("rejects a patient who is both an appointment and an ambulance arrival", () => {
    expect(run({ ...A("M", 0, 30, 3, 10), appointment: true })).toThrow(/both/);
  });

  it("accepts an alert exactly at the arrival minute (nothing to prepare)", () => {
    expect(run(A("M", 30, 30, 3, 10))).not.toThrow();
  });
});

describe("ambulance helpers", () => {
  it("computes the estimated travel time", () => {
    expect(ambulanceEta({ arrival_time: 42, alert_time: 30 })).toBe(12);
  });

  it("is inbound from the alert until the arrival, and not before or after", () => {
    const p = { arrival_time: 30, alert_time: 10 };
    expect(isInbound(p, 9)).toBe(false);
    expect(isInbound(p, 10)).toBe(true);
    expect(isInbound(p, 29)).toBe(true);
    expect(isInbound(p, 30)).toBe(false);
    expect(isInbound({ arrival_time: 30, alert_time: null }, 20)).toBe(false);
  });
});

describe("advice for ambulances", () => {
  it("compares the run with and without pre-alerts", () => {
    const a = analyse([P("W", 15, 2, 40), A("M", 10, 30, 4, 20)], R({ doctor: 1 }), { duration: 120 });
    const item = a.advice.find((x) => x.id === "ambulances");
    expect(item).toBeDefined();
    expect(item!.detail).toContain("With pre-alerts: 1 of 1 ambulance patients");
    expect(item!.detail).toContain("without: 0 of 1");
  });

  it("adds nothing when nobody arrives by ambulance", () => {
    const a = analyse([P("W", 0, 2, 20), P("X", 5, 3, 20)], R({ doctor: 1 }), { duration: 60 });
    expect(a.advice.find((x) => x.id === "ambulances")).toBeUndefined();
  });
});
