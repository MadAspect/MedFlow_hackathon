import { describe, expect, it } from "vitest";
import {
  HAZARD_PARAMS,
  STRATEGIES,
  baseRate,
  cumulativeHarm,
  emptyResourceSet,
  footprint,
  harmRate,
  hazardScore,
  resourcePrices,
  runAllStrategies,
  runSimulation,
  treatmentOrder,
  type ResourceRequest,
  type ResourceSet,
  type SimPatient,
} from "@/lib/simulation";
import { DEMO_PARAMS, DEMO_PATIENTS, DEMO_RESOURCES } from "@/lib/demo";

const P = (
  id: string,
  arrival: number,
  urgency: number,
  treatment: number,
  required: ResourceRequest = { doctor: 1 },
  emergency = false,
): SimPatient => ({
  id,
  condition: "Test",
  arrival_time: arrival,
  urgency,
  treatment_time: treatment,
  required_resources: required,
  emergency,
});

const R = (over: Partial<ResourceSet> = {}): ResourceSet => ({ ...emptyResourceSet(), ...over });

const run = (patients: SimPatient[], resources: ResourceSet) =>
  runSimulation(patients, resources, { strategy: "hazard", duration: 60 });

const toSim = (p: (typeof DEMO_PATIENTS)[number]): SimPatient => ({
  id: p.patient_id,
  condition: p.condition,
  arrival_time: p.arrival_time,
  urgency: p.urgency,
  treatment_time: p.treatment_time,
  required_resources: { ...p.required_resources },
});

describe("Harm-Density Index: the maths", () => {
  it("is registered as a fourth strategy", () => {
    expect(STRATEGIES).toContain("hazard");
  });

  it("multiplies the base harm rate by B for every urgency level and for the emergency flag", () => {
    const B = HAZARD_PARAMS.levelFactor;
    expect(baseRate(1, false)).toBe(1);
    for (let u = 2; u <= 5; u++) expect(baseRate(u, false) / baseRate(u - 1, false)).toBeCloseTo(B);
    expect(baseRate(3, true)).toBeCloseTo(baseRate(4, false));
  });

  it("is the derivative of the cumulative harm (numerical check)", () => {
    const h = 1e-4;
    for (const w of [1, 5, 30, 90]) {
      const slope = (cumulativeHarm(3, false, w + h) - cumulativeHarm(3, false, w - h)) / (2 * h);
      expect(slope).toBeCloseTo(harmRate(3, false, w), 3);
    }
    expect(cumulativeHarm(4, false, 0)).toBe(0);
  });

  it("increases the harm rate with waiting, without bound", () => {
    let prev = harmRate(1, false, 0);
    for (const w of [10, 60, 600, 6000]) {
      const now = harmRate(1, false, w);
      expect(now).toBeGreaterThan(prev);
      prev = now;
    }
    expect(prev).toBeGreaterThan(harmRate(5, true, 0)); // a routine patient eventually out-hurts a fresh emergency
  });

  it("prices a resource up as the queue asks for more of it", () => {
    const cap = R({ doctor: 2, bed: 4 });
    const light = resourcePrices([P("a", 0, 3, 10, { doctor: 1 })], cap);
    const heavy = resourcePrices([P("a", 0, 3, 10, { doctor: 1 }), P("b", 0, 3, 10, { doctor: 3 })], cap);
    expect(light.doctor).toBeCloseTo(1 + 1 / 2);
    expect(heavy.doctor).toBeCloseTo(1 + 4 / 2);
    expect(heavy.bed).toBe(1); // nobody wants beds: no scarcity premium
  });

  it("footprint scales with treatment time and with how contested the resource is", () => {
    const cap = R({ doctor: 2 });
    const prices = resourcePrices([P("a", 0, 3, 30)], cap);
    const short = footprint(P("a", 0, 3, 30), prices, cap);
    const long = footprint(P("b", 0, 3, 60), prices, cap);
    expect(long).toBeCloseTo(2 * short);
    const pricier = footprint(P("a", 0, 3, 30), { ...prices, doctor: prices.doctor * 2 }, cap);
    expect(pricier).toBeCloseTo(2 * short);
  });

  it("returns index = harm rate ÷ footprint and exposes every part", () => {
    const cap = R({ doctor: 3, bed: 5 });
    const p = P("a", 10, 4, 45, { doctor: 1, bed: 1 }, true);
    const prices = resourcePrices([p], cap);
    const s = hazardScore(p, 40, prices, cap);
    const hz = s.hazard!;
    expect(s.waiting_time).toBe(30);
    expect(hz.base_rate).toBeCloseTo(baseRate(4, true));
    expect(hz.harm_rate).toBeCloseTo(harmRate(4, true, 30));
    expect(hz.footprint).toBeCloseTo(footprint(p, prices, cap));
    expect(hz.index).toBeCloseTo(hz.harm_rate / hz.footprint);
    expect(s.total).toBe(hz.index);
    expect(Number.isFinite(s.total)).toBe(true);
  });
});

describe("Harm-Density Index: scheduling behaviour", () => {
  const one = R({ doctor: 1 });

  it("treats a critical patient before a routine one of the same size", () => {
    const out = run([P("ROUTINE", 0, 1, 20), P("CRIT", 0, 5, 20)], one);
    expect(treatmentOrder(out)).toEqual(["CRIT", "ROUTINE"]);
  });

  it("prefers the quicker case when urgency is equal (harm relieved per resource-minute)", () => {
    const out = run([P("LONG", 0, 3, 90), P("QUICK", 0, 3, 10)], one);
    expect(treatmentOrder(out)).toEqual(["QUICK", "LONG"]);
  });

  it("never starves a routine patient behind a stream of critical arrivals", () => {
    const stream = Array.from({ length: 12 }, (_, i) => P(`C${i}`, i * 10, 5, 10));
    const patients = [P("ROUTINE", 0, 1, 10), ...stream];
    const hazard = run(patients, one);
    const urgency = runSimulation(patients, one, { strategy: "urgency", duration: 60 });
    const routineStart = (o: typeof hazard) => o.patients.find((p) => p.id === "ROUTINE")!.start_time!;
    expect(routineStart(hazard)).toBeLessThan(routineStart(urgency));
    expect(routineStart(hazard)).toBeLessThan(120); // treated before the stream is over
  });

  it("is deterministic: the same input gives the identical order twice", () => {
    const a = treatmentOrder(run(DEMO_PATIENTS.map(toSim), DEMO_RESOURCES));
    const b = treatmentOrder(run(DEMO_PATIENTS.map(toSim), DEMO_RESOURCES));
    expect(a).toEqual(b);
  });

  it("treats everybody and never exceeds capacity on the demo data", () => {
    const out = runSimulation(DEMO_PATIENTS.map(toSim), DEMO_RESOURCES, { ...DEMO_PARAMS, strategy: "hazard" });
    expect(out.completed).toBe(true);
    expect(out.metrics.patients_remaining).toBe(0);
    expect(out.metrics.resource_overload).toBe(0);
    for (const p of out.patients) {
      expect(p.decision!.score.hazard).toBeDefined();
      expect(p.priority_score).toBeCloseTo(p.decision!.score.hazard!.index);
    }
  });

  it("runs alongside the other three strategies in runAllStrategies", () => {
    const all = runAllStrategies(DEMO_PATIENTS.map(toSim), DEMO_RESOURCES, DEMO_PARAMS);
    expect(Object.keys(all).sort()).toEqual([...STRATEGIES].sort());
    expect(all.hazard.strategy).toBe("hazard");
  });
});
