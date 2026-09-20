import { describe, expect, it } from "vitest";
import {
  RESOURCE_KEYS,
  analyse,
  emptyResourceSet,
  runAllStrategies,
  runSimulation,
  treatmentOrder,
  type ResourceRequest,
  type ResourceSet,
  type SimPatient,
  type Strategy,
} from "@/lib/simulation";

/**
 * One block per requirement of the MedFlow section of the Hack-a-Matics brochure.
 * Each test drives the real engine; nothing is mocked or hardcoded.
 */

const P = (id: string, arrival: number, urgency: number, treatment: number, required: ResourceRequest = { doctor: 1 }): SimPatient => ({
  id,
  condition: "Test",
  arrival_time: arrival,
  urgency,
  treatment_time: treatment,
  required_resources: required,
});
const R = (over: Partial<ResourceSet> = {}): ResourceSet => ({ ...emptyResourceSet(), ...over });
const run = (strategy: Strategy, patients: SimPatient[], resources: ResourceSet, extra = {}) =>
  runSimulation(patients, resources, { strategy, duration: 100, ...extra });
const byId = (o: ReturnType<typeof runSimulation>) => Object.fromEntries(o.patients.map((p) => [p.id, p]));

describe("core requirements", () => {
  it("represents incoming patients with different urgency levels", () => {
    const out = run("dynamic", [1, 2, 3, 4, 5].map((u) => P(`U${u}`, u, u, 5)), R({ doctor: 5 }));
    expect(out.patients.map((p) => p.urgency)).toEqual([1, 2, 3, 4, 5]);
    expect(() => run("dynamic", [P("X", 0, 6, 5)], R({ doctor: 1 }))).toThrow(/urgency/);
  });

  it("maintains a patient queue that grows and drains", () => {
    const out = run("fcfs", [P("A", 0, 3, 10), P("B", 0, 3, 10), P("C", 0, 3, 10)], R({ doctor: 1 }));
    expect(Math.max(...out.timeline.map((t) => t.queue_length))).toBe(2);
    expect(out.timeline.at(-1)!.queue_length).toBe(0);
    expect(out.metrics.peak_queue_length).toBe(2);
  });

  it("tracks available resources per minute against capacity", () => {
    const out = run("fcfs", [P("A", 0, 3, 10, { doctor: 1, bed: 1 })], R({ doctor: 2, bed: 1 }));
    const t5 = out.timeline[5];
    expect(t5.in_use.doctor).toBe(1);
    expect(t5.capacity.doctor - t5.in_use.doctor).toBe(1);
    expect(out.timeline[15].in_use.doctor).toBe(0);
  });

  it("assigns beds, doctors and other resources together, and releases them", () => {
    const out = run("fcfs", [P("A", 0, 3, 10, { doctor: 1, nurse: 2, bed: 1 })], R({ doctor: 1, nurse: 2, bed: 1 }));
    const a = byId(out).A;
    expect(a.decision!.required).toEqual({ doctor: 1, nurse: 2, bed: 1 });
    expect(out.timeline[a.end_time!].in_use).toEqual(emptyResourceSet());
  });

  it("prioritizes urgent cases", () => {
    const patients = [P("blocker", 0, 3, 20), P("low", 1, 1, 5), P("high", 2, 5, 5)];
    const u = byId(run("urgency", patients, R({ doctor: 1 })));
    expect(u.high.start_time).toBeLessThan(u.low.start_time!);
    // First-come, first-served ignores urgency
    const f = byId(run("fcfs", patients, R({ doctor: 1 })));
    expect(f.low.start_time).toBeLessThan(f.high.start_time!);
  });

  it("accounts for waiting time: wait = start − arrival", () => {
    const out = run("fcfs", [P("A", 0, 3, 10), P("B", 4, 3, 10)], R({ doctor: 1 }));
    expect(byId(out).B.wait_time).toBe(6);
    expect(out.metrics.total_waiting_time).toBe(6);
    expect(out.metrics.average_wait).toBe(3);
    expect(out.metrics.maximum_wait).toBe(6);
  });

  it("prevents resource conflicts and never exceeds capacity", () => {
    const patients = Array.from({ length: 12 }, (_, i) => P(`P${i}`, i % 4, 1 + (i % 5), 7 + (i % 3), { doctor: 1, bed: 1 + (i % 2) }));
    for (const s of ["fcfs", "urgency", "dynamic"] as const) {
      const out = run(s, patients, R({ doctor: 2, bed: 3 }));
      for (const t of out.timeline) for (const k of RESOURCE_KEYS) expect(t.in_use[k]).toBeLessThanOrEqual(t.capacity[k]);
      expect(out.metrics.resource_overload).toBe(0);
      expect(new Set(out.patients.map((p) => p.id)).size).toBe(out.patients.length);
      expect(out.patients.every((p) => p.status === "treated")).toBe(true);
    }
  });

  it("calculates resource utilization", () => {
    const out = run("fcfs", [P("A", 0, 3, 50)], R({ doctor: 1, nurse: 2 }), { duration: 100 });
    expect(out.metrics.resource_utilization.doctor).toBeCloseTo(0.5);
    expect(out.metrics.resource_utilization.nurse).toBe(0);
  });

  it("exposes the dashboard metrics", () => {
    const m = run("dynamic", [P("A", 0, 5, 10)], R({ doctor: 1 })).metrics;
    for (const k of ["patients_treated", "patients_remaining", "average_wait", "maximum_wait", "critical_wait", "peak_queue_length", "resource_utilization", "bottlenecks", "objective_score", "actual_completion_time", "configured_duration"]) {
      expect(m).toHaveProperty(k);
    }
  });
});

describe("bonus requirements", () => {
  it("simulates an emergency surge", () => {
    const res = R({ doctor: 3, nurse: 3, bed: 3, icu_bed: 2 });
    const base = run("dynamic", [P("A", 0, 3, 10)], res);
    const surge = run("dynamic", [P("A", 0, 3, 10)], res, { emergencySurge: true, surgeStart: 5, surgeCount: 6 });
    expect(surge.patients.length).toBe(base.patients.length + 6);
    expect(surge.patients.filter((p) => p.emergency).every((p) => p.id.startsWith("SURGE-"))).toBe(true);
    expect(surge.metrics.actual_completion_time).toBeGreaterThan(base.metrics.actual_completion_time);
  });

  it("models ICU capacity constraints: ICU patients serialize on one ICU bed", () => {
    const out = run("fcfs", [P("I1", 0, 5, 20, { icu_bed: 1 }), P("I2", 0, 5, 20, { icu_bed: 1 })], R({ icu_bed: 1 }));
    expect(byId(out).I2.start_time).toBe(20);
    expect(out.metrics.bottlenecks[0].resource).toBe("icu_bed");
  });

  it("simulates unexpected resource failures", () => {
    const patients = [P("A", 0, 3, 30, { icu_bed: 1 }), P("B", 0, 3, 30, { icu_bed: 1 })];
    const out = run("fcfs", patients, R({ icu_bed: 2 }), { resourceFailure: true, failedResource: "icu_bed", failureStart: 0, failureUnits: 1 });
    expect(byId(out).B.start_time).toBe(30);
    expect(out.timeline[10].capacity.icu_bed).toBe(1);
  });

  it("compares scheduling strategies on identical data", () => {
    const patients = [P("blocker", 0, 3, 20), P("low", 1, 1, 5), P("high", 2, 5, 5)];
    const all = runAllStrategies(patients, R({ doctor: 1 }), { duration: 100 });
    const orders = (["fcfs", "urgency", "dynamic"] as const).map((s) => treatmentOrder(all[s]).join(","));
    expect(orders[0]).toBe("blocker,low,high");
    expect(orders[1]).toBe("blocker,high,low");
    for (const s of ["fcfs", "urgency", "dynamic"] as const) expect(all[s].patients.map((p) => p.arrival_time)).toEqual([0, 1, 2]);
  });

  it("urgency-only starves a long-waiting low-urgency patient; waiting-time-aware dynamic priority does not", () => {
    // One doctor is busy until minute 200. L has waited 200 min; H just arrived and is more urgent.
    const patients = [P("X", 0, 3, 200), P("L", 1, 1, 10), P("H", 190, 5, 10)];
    const urgency = byId(run("urgency", patients, R({ doctor: 1 }), { duration: 300 }));
    const dynamic = byId(run("dynamic", patients, R({ doctor: 1 }), { duration: 300 }));
    expect(urgency.H.start_time).toBe(200);
    expect(urgency.L.start_time).toBe(210);
    expect(dynamic.L.start_time).toBe(200);
    expect(dynamic.L.decision!.score.waiting).toBeGreaterThan(0);
  });

  it("stores the dynamic priority score terms for the explanation panel", () => {
    const d = byId(run("dynamic", [P("A", 0, 4, 10)], R({ doctor: 1 }))).A.decision!.score;
    expect(d.total).toBeCloseTo(d.urgency + d.waiting + d.risk + d.emergency);
    expect(d.urgency).toBe(5 * 4);
  });

  it("analyse() gives the whole comparison in one call", () => {
    const a = analyse([P("A", 0, 3, 10), P("B", 0, 5, 10)], R({ doctor: 1 }), { duration: 60 });
    expect(a.comparison.rows).toHaveLength(4); // fcfs, urgency, dynamic, hazard
    expect(a.recommendation.candidates).toHaveLength(RESOURCE_KEYS.length);
  });
});

describe("bottlenecks and completion", () => {
  it("waiting for a bottleneck never ends the run; every patient is eventually treated beyond the configured duration", () => {
    const patients = Array.from({ length: 8 }, (_, i) => P(`P${i}`, 0, 3, 30));
    const out = run("dynamic", patients, R({ doctor: 1 }), { duration: 20 });
    expect(out.completed).toBe(true);
    expect(out.metrics.patients_remaining).toBe(0);
    expect(out.metrics.configured_duration).toBe(20);
    expect(out.metrics.actual_completion_time).toBe(240);
  });

  it("an impossible request is reported, not silently dropped", () => {
    const out = run("dynamic", [P("A", 0, 3, 10, { icu_bed: 3 })], R({ icu_bed: 1 }));
    expect(out.completed).toBe(false);
    expect(out.error).toBeTruthy();
  });

  it("repeated runs give byte-identical results and do not leak state between strategies", () => {
    const patients = [P("A", 0, 2, 12), P("B", 1, 5, 9), P("C", 2, 3, 7)];
    const snapshot = JSON.stringify(patients);
    const first = JSON.stringify(runAllStrategies(patients, R({ doctor: 1 }), { duration: 50 }));
    const second = JSON.stringify(runAllStrategies(patients, R({ doctor: 1 }), { duration: 50 }));
    expect(second).toBe(first);
    expect(JSON.stringify(patients)).toBe(snapshot);
  });
});
