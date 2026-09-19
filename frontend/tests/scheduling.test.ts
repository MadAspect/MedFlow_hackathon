import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CONTRAST_MESSAGE,
  CONTRAST_PARAMS,
  CONTRAST_PATIENTS,
  CONTRAST_RESOURCES,
  DEMO_PARAMS,
  DEMO_PATIENTS,
  DEMO_RESOURCES,
} from "@/lib/demo";
import { runRecordsFromOutput, type StoredRun } from "@/lib/database";
import { outputFromStoredRun } from "@/lib/runner";
import {
  DEFAULT_WEIGHTS,
  RESOURCE_KEYS,
  SAME_ORDER_MESSAGE,
  compareNormalVsEfficient,
  compareStrategies,
  emptyResourceSet,
  improvementPercent,
  objectiveScore,
  recommendResource,
  runAllStrategies,
  runSimulation,
  scoreBreakdown,
  treatmentOrder,
  type ResourceRequest,
  type ResourceSet,
  type SimPatient,
  type SimulationOutput,
  type Strategy,
} from "@/lib/simulation";

const P = (
  id: string,
  arrival: number,
  urgency: number,
  treatment: number,
  required: ResourceRequest = { doctor: 1 },
): SimPatient => ({
  id,
  condition: "Test",
  arrival_time: arrival,
  urgency,
  treatment_time: treatment,
  required_resources: required,
});

const R = (over: Partial<ResourceSet> = {}): ResourceSet => ({ ...emptyResourceSet(), ...over });

const toSim = (rows: typeof CONTRAST_PATIENTS): SimPatient[] =>
  rows.map((p) => ({
    id: p.patient_id,
    condition: p.condition,
    arrival_time: p.arrival_time,
    urgency: p.urgency,
    treatment_time: p.treatment_time,
    required_resources: { ...p.required_resources },
  }));

const contrastPatients = () => toSim(CONTRAST_PATIENTS);

const byId = (out: SimulationOutput) => Object.fromEntries(out.patients.map((p) => [p.id, p]));
const run = (strategy: Strategy, patients: SimPatient[], resources: ResourceSet, duration = 500) =>
  runSimulation(patients, resources, { strategy, duration });

// One doctor is busy with X until minute 100, so everyone else queues behind it.
const blocked = (...rest: SimPatient[]) => [P("X", 0, 3, 100), ...rest];

describe("First-Come, First-Served", () => {
  it("chooses the earliest feasible arrival", () => {
    // BIG (arrives first) needs the busy doctor, so it is not feasible at minute 5.
    // ICU is free, so the later-arriving ICU-only patient is the earliest FEASIBLE one.
    const out = run(
      "fcfs",
      [P("X", 0, 3, 50, { doctor: 1 }), P("BIG", 1, 3, 10, { doctor: 1, icu_bed: 1 }), P("ICU", 5, 3, 10, { icu_bed: 1 })],
      R({ doctor: 1, icu_bed: 1 }),
    );
    expect(byId(out).ICU.start_time).toBe(5);
    expect(byId(out).BIG.start_time).toBe(50);
  });

  it("breaks equal arrival times by lower patient id", () => {
    const out = run("fcfs", blocked(P("B2", 5, 1, 10), P("B1", 5, 1, 10)), R({ doctor: 1 }));
    expect(treatmentOrder(out)).toEqual(["X", "B1", "B2"]);
  });

  it("ignores urgency and waiting time", () => {
    const out = run("fcfs", blocked(P("LOW", 1, 1, 10), P("HIGH", 2, 5, 10)), R({ doctor: 1 }));
    expect(treatmentOrder(out)).toEqual(["X", "LOW", "HIGH"]);
  });
});

describe("Urgency Only", () => {
  it("chooses the highest urgency", () => {
    const out = run("urgency", blocked(P("LOW", 1, 1, 10), P("HIGH", 2, 5, 10), P("MID", 3, 3, 10)), R({ doctor: 1 }));
    expect(treatmentOrder(out)).toEqual(["X", "HIGH", "MID", "LOW"]);
  });

  it("ignores waiting time however long a patient has waited", () => {
    // LOW waits ~200 minutes; HIGH has just arrived. Urgency Only still picks HIGH.
    const patients = [P("X", 0, 3, 200), P("LOW", 1, 1, 10), P("HIGH", 199, 5, 10)];
    const out = run("urgency", patients, R({ doctor: 1 }));
    expect(treatmentOrder(out)).toEqual(["X", "HIGH", "LOW"]);
  });

  it("breaks urgency ties by earliest arrival, then id", () => {
    const out = run("urgency", blocked(P("C", 7, 4, 10), P("B", 5, 4, 10), P("A", 5, 4, 10)), R({ doctor: 1 }));
    expect(treatmentOrder(out)).toEqual(["X", "A", "B", "C"]);
  });
});

describe("Dynamic Priority", () => {
  const patients = [P("X", 0, 3, 200), P("LOW", 1, 1, 10), P("HIGH", 199, 5, 10)];

  it("calculates waiting time at the decision point and stores the score on every patient", () => {
    const out = run("dynamic", patients, R({ doctor: 1 }));
    const low = byId(out).LOW;
    expect(low.decision!.time).toBe(200);
    expect(low.decision!.score.waiting_time).toBe(200 - 1);
    const s = low.decision!.score;
    const risk = (1 / 5) * (1 - Math.exp(-199 / 30));
    expect(s.total).toBeCloseTo(5 * 1 + 0.35 * 199 + 2 * risk + 3 * 0);
    for (const p of out.patients) {
      expect(Number.isFinite(p.priority_score)).toBe(true);
      expect(p.priority_score).toBeCloseTo(p.decision!.score.total);
    }
  });

  it("includes the emergency flag term", () => {
    const s = scoreBreakdown({ ...P("E", 0, 2, 10), emergency: true }, 10, DEFAULT_WEIGHTS);
    expect(s.emergency).toBeCloseTo(3);
    expect(s.total).toBeCloseTo(5 * 2 + 0.35 * 10 + 2 * s.risk_value + 3);
  });

  it("scores differently from Urgency Only and can choose a different patient", () => {
    const urgency = run("urgency", patients, R({ doctor: 1 }));
    const dynamic = run("dynamic", patients, R({ doctor: 1 }));
    // Urgency Only would rank on 5·urgency alone; Dynamic adds the waiting-time bonus.
    expect(byId(dynamic).LOW.decision!.score.total).toBeGreaterThan(5 * 1);
    expect(treatmentOrder(urgency)).toEqual(["X", "HIGH", "LOW"]);
    expect(treatmentOrder(dynamic)).toEqual(["X", "LOW", "HIGH"]);
  });

  it("prevents indefinite starvation of a low-urgency patient", () => {
    // One doctor; an urgent patient arrives every 10 minutes for 300 minutes.
    const stream: SimPatient[] = [P("X", 0, 5, 10), P("LOW", 1, 1, 10)];
    for (let i = 1; i <= 30; i++) stream.push(P(`U${String(i).padStart(2, "0")}`, i * 10, 5, 10));
    const urgency = run("urgency", stream, R({ doctor: 1 }));
    const dynamic = run("dynamic", stream, R({ doctor: 1 }));
    const lastUrgent = "U30";
    // Urgency Only makes LOW wait behind the entire stream...
    expect(byId(urgency).LOW.start_time!).toBeGreaterThan(byId(urgency)[lastUrgent].start_time!);
    // ...while the waiting-time term lets LOW overtake fresh urgent arrivals.
    expect(byId(dynamic).LOW.start_time!).toBeLessThan(byId(dynamic)[lastUrgent].start_time!);
    expect(byId(dynamic).LOW.start_time!).toBeLessThan(byId(urgency).LOW.start_time!);
  });
});

describe("bottlenecks and time advancement", () => {
  it("a bottleneck leaves patients waiting instead of ending the run", () => {
    const out = run("fcfs", [P("A", 0, 3, 10), P("B", 0, 3, 10), P("C", 0, 3, 10)], R({ doctor: 1 }), 5);
    expect(out.timeline[0].queue_length).toBe(2); // B and C wait for the doctor
    expect(out.timeline[0].bottleneck).toBe("doctor");
    expect(out.completed).toBe(true);
    expect(out.metrics.patients_treated).toBe(3);
    expect(out.metrics.bottlenecks[0].resource).toBe("doctor");
    expect(out.metrics.bottlenecks[0].blocked_patients).toBe(2);
    expect(out.metrics.bottlenecks[0].blocked_patient_minutes).toBe(10 + 20);
  });

  it("advances time to the next treatment completion, not minute by minute", () => {
    const out = run("fcfs", [P("A", 0, 3, 25), P("B", 0, 3, 40), P("C", 1, 3, 7)], R({ doctor: 1 }));
    const o = byId(out);
    expect(o.A.end_time).toBe(25);
    expect(o.B.decision!.time).toBe(25); // started exactly when A finished
    expect(o.C.decision!.time).toBe(65);
    expect(out.metrics.actual_completion_time).toBe(72);
  });

  it("completed treatments release every allocated resource at once", () => {
    const need = { doctor: 1, nurse: 2, icu_bed: 1 };
    const out = run("fcfs", [P("A", 0, 3, 30, need), P("B", 1, 3, 30, need)], R({ doctor: 1, nurse: 2, icu_bed: 1 }));
    expect(byId(out).B.start_time).toBe(30);
    expect(out.timeline[29].in_use).toEqual({ ...emptyResourceSet(), ...need });
    // ...and after the last treatment nothing is still allocated.
    expect(out.timeline[out.timeline.length - 1].in_use).toEqual(emptyResourceSet());
  });

  it("treats waiting patients after resources are released", () => {
    const out = run("dynamic", blocked(P("W1", 1, 2, 10), P("W2", 2, 2, 10)), R({ doctor: 1 }));
    expect(out.patients.every((p) => p.status === "treated")).toBe(true);
    expect(byId(out).W1.start_time).toBe(100);
  });

  it("continues beyond the configured duration when necessary", () => {
    const out = runSimulation([P("A", 0, 3, 60), P("B", 0, 3, 60)], R({ doctor: 1 }), { duration: 60 });
    expect(out.metrics.configured_duration).toBe(60);
    expect(out.metrics.actual_completion_time).toBe(120);
    expect(out.timeline).toHaveLength(121);
    expect(out.completed).toBe(true);
  });

  it("handles very long treatments without stepping through every minute", () => {
    const out = run("fcfs", [P("A", 0, 3, 100000), P("B", 1, 3, 100000)], R({ doctor: 1 }), 10);
    expect(out.metrics.actual_completion_time).toBe(200000);
  });
});

describe("completion guarantee and invariants", () => {
  function randomScenario(seed: number, feasible: boolean) {
    let s = seed;
    const rand = () => {
      s = (s * 1664525 + 1013904223) % 4294967296;
      return s / 4294967296;
    };
    const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
    const patients: SimPatient[] = [];
    const count = int(5, 40);
    for (let i = 0; i < count; i++) {
      const need: ResourceRequest = {};
      for (const k of RESOURCE_KEYS) if (rand() < 0.4) need[k] = int(1, 2);
      if (Object.keys(need).length === 0) need.doctor = 1;
      patients.push(P(`R${String(i).padStart(2, "0")}`, int(0, 80), int(1, 5), int(5, 40), need));
    }
    const lo = feasible ? 2 : 0;
    const resources = R({
      doctor: int(lo, 4),
      nurse: int(lo, 6),
      bed: int(lo, 5),
      icu_bed: int(lo, 3),
      operating_room: int(lo, 2),
    });
    return { patients, resources };
  }

  it("every patient is eventually treated whenever the needs fit the hospital", () => {
    for (let seed = 1; seed <= 30; seed++) {
      const { patients, resources } = randomScenario(seed, true);
      for (const out of Object.values(runAllStrategies(patients, resources, { duration: 30 }))) {
        expect(out.completed).toBe(true);
        expect(out.error).toBeNull();
        expect(out.metrics.patients_treated).toBe(patients.length);
        expect(out.metrics.patients_remaining).toBe(0);
        expect(out.timeline[out.timeline.length - 1].queue_length).toBe(0);
        expect(out.timeline[out.timeline.length - 1].in_treatment).toBe(0);
      }
    }
  });

  it("never reports success with untreated patients, never goes negative, never allocates twice", () => {
    for (let seed = 100; seed < 140; seed++) {
      const { patients, resources } = randomScenario(seed, seed % 2 === 0);
      const outs = runAllStrategies(patients, resources, {
        duration: 60,
        emergencySurge: seed % 3 === 0,
        resourceFailure: seed % 4 === 0,
        failedResource: RESOURCE_KEYS[seed % 5],
        failureStart: 25,
        failureUnits: 1,
      });
      for (const out of Object.values(outs)) {
        const untreated = out.patients.filter((p) => p.status !== "treated").length;
        if (out.completed) {
          expect(untreated).toBe(0);
          expect(out.error).toBeNull();
        } else {
          expect(untreated).toBeGreaterThan(0);
          expect(out.error).toBeTruthy();
        }
        // No patient allocated twice: unique, gap-free decision sequence numbers.
        const seqs = out.patients
          .filter((p) => p.decision)
          .map((p) => p.decision!.seq)
          .sort((a, b) => a - b);
        expect(seqs).toEqual(seqs.map((_, i) => i));
        // Resource counts are never negative and never above nominal capacity.
        for (const point of out.timeline) {
          for (const k of RESOURCE_KEYS) {
            expect(point.in_use[k]).toBeGreaterThanOrEqual(0);
            expect(point.in_use[k]).toBeLessThanOrEqual(out.resources[k]);
          }
        }
        for (const p of out.patients) {
          if (p.decision) {
            for (const k of RESOURCE_KEYS) expect(p.decision.available_before[k]).toBeGreaterThanOrEqual(0);
          }
          // A patient is never both waiting and treated.
          if (p.start_time !== null) expect(p.status).toBe("treated");
        }
        expect(out.metrics.resource_overload).toBe(0);
      }
    }
  });

  it("impossible requirements produce an explicit error, not a success", () => {
    const out = run("dynamic", [P("A", 0, 5, 10, { icu_bed: 2 }), P("B", 0, 3, 10, { doctor: 1 })], R({ icu_bed: 1, doctor: 1 }));
    expect(out.completed).toBe(false);
    expect(out.error).toMatch(/A needs 2 icu beds but only 1 exist/i);
    expect(out.metrics.patients_remaining).toBe(1);
    expect(out.metrics.objective_score).toBeGreaterThanOrEqual(10000);
    expect(byId(out).B.status).toBe("treated"); // the feasible patient is still treated
    expect(out.warnings.some((w) => w.code === "simulation_incomplete" && w.level === "critical")).toBe(true);
  });

  it("reports an error when a failure leaves a patient with too little capacity", () => {
    const out = runSimulation([P("A", 50, 5, 10, { icu_bed: 2 })], R({ icu_bed: 2 }), {
      resourceFailure: true,
      failedResource: "icu_bed",
      failureStart: 10,
      failureUnits: 1,
    });
    expect(out.completed).toBe(false);
    expect(out.error).toMatch(/remain after the failure/);
  });

  it("zero resources is an explicit error", () => {
    const out = run("fcfs", [P("A", 0, 3, 10)], R());
    expect(out.completed).toBe(false);
    expect(out.error).toBeTruthy();
  });
});

describe("normal vs efficient comparison", () => {
  const params = { duration: 60 };

  it("runs FCFS and Dynamic Priority on identical, unmodified input", () => {
    const patients = contrastPatients();
    const snapshot = JSON.stringify(patients);
    for (const p of patients) {
      Object.freeze(p.required_resources);
      Object.freeze(p);
    }
    const c = compareNormalVsEfficient(patients, CONTRAST_RESOURCES, params);
    expect(JSON.stringify(patients)).toBe(snapshot); // input not mutated
    expect(c.normal.strategy).toBe("fcfs");
    expect(c.efficient.strategy).toBe("dynamic");
    const key = (o: SimulationOutput) =>
      o.patients
        .map((p) => `${p.id}:${p.arrival_time}:${p.urgency}:${p.treatment_time}:${JSON.stringify(p.required_resources)}`)
        .sort();
    expect(key(c.normal)).toEqual(key(c.efficient));
    expect(c.normal.resources).toEqual(c.efficient.resources);
  });

  it("takes every value from two real simulation runs", () => {
    const patients = contrastPatients();
    const c = compareNormalVsEfficient(patients, CONTRAST_RESOURCES, params);
    const n = runSimulation(patients, CONTRAST_RESOURCES, { ...params, strategy: "fcfs" }).metrics;
    const e = runSimulation(patients, CONTRAST_RESOURCES, { ...params, strategy: "dynamic" }).metrics;
    const row = (key: string) => c.rows.find((r) => r.key === key)!;
    expect(row("avg_wait").normal).toBe(n.average_wait);
    expect(row("avg_wait").efficient).toBe(e.average_wait);
    expect(row("critical_wait").normal).toBe(n.critical_wait_total);
    expect(row("critical_wait").efficient).toBe(e.critical_wait_total);
    expect(row("completion").efficient).toBe(e.actual_completion_time);
    expect(row("util_icu_bed").normal).toBe(n.resource_utilization.icu_bed);
    expect(row("objective").normal).toBe(n.objective_score);
    expect(row("objective").efficient).toBe(e.objective_score);
    expect(row("objective").difference).toBe(e.objective_score - n.objective_score);
    expect(row("bottleneck").normalText).toBe("ICU beds");
    // Every required table row is present, in order.
    expect(c.rows.map((r) => r.label)).toEqual([
      "Patients treated",
      "Patients remaining",
      "Actual completion time",
      "Total waiting time",
      "Average waiting time",
      "Maximum waiting time",
      "Critical-patient waiting time",
      "Doctor utilization",
      "Nurse utilization",
      "Bed utilization",
      "ICU utilization",
      "Operating-room utilization",
      "Bottleneck resource",
      "Objective score",
    ]);
  });

  it("uses the specified improvement formulas", () => {
    expect(improvementPercent(200, 150, "lower")).toBeCloseTo(25);
    expect(improvementPercent(150, 200, "lower")).toBeCloseTo(-33.3333, 3);
    expect(improvementPercent(0.5, 0.75, "higher")).toBeCloseTo(50);
    expect(improvementPercent(0, 0, "lower")).toBe(0);
    expect(improvementPercent(0, 1, "higher")).toBeCloseTo((1 / 0.0001) * 100);
    const c = compareNormalVsEfficient(contrastPatients(), CONTRAST_RESOURCES, params);
    const wait = c.rows.find((r) => r.key === "total_wait")!;
    const expected = ((wait.normal! - wait.efficient!) / Math.max(Math.abs(wait.normal!), 0.0001)) * 100;
    expect(wait.improvementPct).toBeCloseTo(expected);
  });

  it("computes the objective score from the specified weights", () => {
    expect(
      objectiveScore({ total_waiting_time: 100, critical_wait_total: 10, patients_remaining: 2, resource_overload: 1, maximum_wait: 40 }),
    ).toBe(100 + 40 + 20000 + 10000 + 20);
    const out = run("fcfs", [P("A", 0, 5, 10), P("B", 0, 5, 10)], R({ doctor: 1 }));
    // waits 0 and 10: total 10, critical total 10, max 10, nothing remaining or overloaded
    expect(out.metrics.objective_score).toBe(10 + 4 * 10 + 0.5 * 10);
  });

  it("fills the explanation template from the calculated runs", () => {
    const c = compareNormalVsEfficient(contrastPatients(), CONTRAST_RESOURCES, params);
    const n = c.normal.metrics;
    const e = c.efficient.metrics;
    const f = (x: number) => String(Math.round(x * 10) / 10);
    expect(c.explanation).toBe(
      [
        "The normal system uses First-Come, First-Served scheduling.",
        "The efficient system uses Dynamic Priority scheduling, which combines urgency and waiting time.",
        "",
        `The efficient system treated ${e.patients_treated} patients and completed the run in ${e.actual_completion_time} minutes.`,
        `Average waiting time changed from ${f(n.average_wait)} to ${f(e.average_wait)} minutes.`,
        `Critical-patient waiting time changed from ${f(n.critical_wait_total)} to ${f(e.critical_wait_total)} minutes.`,
        "The main bottleneck was ICU beds.",
      ].join("\n"),
    );
  });

  it("flags identical orders with the required message", () => {
    // Patients never overlap, so every policy must choose the same order.
    const patients = [P("A", 0, 3, 10), P("B", 20, 3, 10)];
    const c = compareNormalVsEfficient(patients, R({ doctor: 1 }), params);
    expect(c.sameOrder).toBe(true);
    const lab = compareStrategies(runAllStrategies(patients, R({ doctor: 1 }), params));
    expect(lab.sameOrderMessage).toBe(SAME_ORDER_MESSAGE);
    expect(SAME_ORDER_MESSAGE).toBe("These strategies produced the same order for this scenario.");
  });

  it("recommends a configuration by actually re-running each candidate", () => {
    const patients = contrastPatients();
    const rec = recommendResource(patients, CONTRAST_RESOURCES, params);
    expect(rec.candidates).toHaveLength(5);
    for (const cand of rec.candidates) {
      const direct = runSimulation(patients, cand.configuration, { ...params, strategy: "dynamic" });
      expect(cand.objective).toBe(direct.metrics.objective_score);
      expect(cand.configuration[cand.resource]).toBe(CONTRAST_RESOURCES[cand.resource] + 1);
    }
    expect(rec.best?.resource).toBe("icu_bed"); // the single ICU bed is the only constraint
    expect(rec.best!.objective).toBe(Math.min(...rec.candidates.map((c) => c.objective)));
    expect(rec.label).toBe("Best tested configuration");
  });
});

describe("contrast scenario", () => {
  it("contains the specified competing patients and an ICU constraint", () => {
    const [a, b, c, d] = CONTRAST_PATIENTS;
    expect([a.arrival_time, a.urgency, a.treatment_time]).toEqual([0, 2, 20]);
    expect([b.arrival_time, b.urgency, b.treatment_time]).toEqual([1, 5, 20]);
    expect([c.arrival_time, c.urgency, c.treatment_time]).toEqual([2, 1, 10]);
    expect([d.arrival_time, d.urgency, d.treatment_time]).toEqual([3, 4, 15]);
    expect(CONTRAST_RESOURCES.icu_bed).toBe(1);
    expect(CONTRAST_PATIENTS.every((p) => p.required_resources.icu_bed)).toBe(true);
    expect(new Set(CONTRAST_PATIENTS.map((p) => p.treatment_time)).size).toBeGreaterThan(1);
    expect(CONTRAST_MESSAGE).toBe(
      "This scenario is designed to make the scheduling trade-offs visible. It does not change the algorithms.",
    );
  });

  it("makes all three policies decide differently, and runs past the planned duration", () => {
    const outs = runAllStrategies(contrastPatients(), CONTRAST_RESOURCES, CONTRAST_PARAMS);
    const order = (s: Strategy) => treatmentOrder(outs[s]).join(",");
    expect(order("fcfs")).toBe("A,B,C,D,E,F,G");
    expect(order("urgency")).not.toBe(order("fcfs"));
    expect(order("dynamic")).not.toBe(order("fcfs"));
    expect(order("dynamic")).not.toBe(order("urgency"));
    for (const out of Object.values(outs)) {
      expect(out.completed).toBe(true);
      expect(out.metrics.actual_completion_time).toBeGreaterThan(60);
    }
    // The urgent patient D overtakes the earlier, low-urgency C under Urgency Only.
    expect(byId(outs.urgency).D.start_time!).toBeLessThan(byId(outs.urgency).C.start_time!);
    expect(byId(outs.fcfs).C.start_time!).toBeLessThan(byId(outs.fcfs).D.start_time!);
  });
});

describe("determinism and no AI", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("repeated runs with the same input are identical", () => {
    const patients = toSim(DEMO_PATIENTS);
    const a = runAllStrategies(patients, DEMO_RESOURCES, DEMO_PARAMS);
    const b = runAllStrategies(patients, DEMO_RESOURCES, DEMO_PARAMS);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const c1 = compareNormalVsEfficient(patients, DEMO_RESOURCES, DEMO_PARAMS);
    const c2 = compareNormalVsEfficient(patients, DEMO_RESOURCES, DEMO_PARAMS);
    expect(JSON.stringify(c1)).toBe(JSON.stringify(c2));
  });

  it("makes no network calls during simulation, comparison or recommendation", () => {
    const trap = vi.fn(() => {
      throw new Error("network call during simulation");
    });
    vi.stubGlobal("fetch", trap);
    vi.stubGlobal("XMLHttpRequest", trap);
    vi.stubGlobal("WebSocket", trap);
    const patients = contrastPatients();
    runAllStrategies(patients, CONTRAST_RESOURCES, CONTRAST_PARAMS);
    compareNormalVsEfficient(patients, CONTRAST_RESOURCES, CONTRAST_PARAMS);
    recommendResource(patients, CONTRAST_RESOURCES, CONTRAST_PARAMS);
    expect(trap).not.toHaveBeenCalled();
  });

  it("the simulation sources contain no AI, network or randomness", () => {
    const dir = join(__dirname, "..", "lib", "simulation");
    const forbidden =
      /openai|anthropic|gemini|langchain|tensorflow|onnx|\bllm\b|Math\.random|fetch\s*\(|XMLHttpRequest|WebSocket|axios|supabase/i;
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts"))) {
      const source = readFileSync(join(dir, file), "utf8");
      expect(source, `${file} must not use AI, network or randomness`).not.toMatch(forbidden);
    }
    const pkg = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf8"));
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).join(" ");
    expect(deps).not.toMatch(/openai|anthropic|gemini|langchain|tensorflow|onnx|transformers/i);
  });
});

describe("saved runs from earlier versions", () => {
  it("are normalised on load: completion fields are derived, incomplete runs are flagged", () => {
    const out = runSimulation([P("A", 0, 5, 10)], R({ doctor: 1 }), { duration: 60 });
    const rec = runRecordsFromOutput(out);
    const legacy: Record<string, unknown> = { ...rec.result.metrics };
    for (const k of [
      "configured_duration",
      "actual_completion_time",
      "total_waiting_time",
      "critical_wait_total",
      "resource_overload",
      "objective_score",
    ]) {
      delete legacy[k];
    }
    const stored = {
      run: { ...rec.run, id: "run-1", created_at: "2026-01-01T00:00:00Z" },
      result: { ...rec.result, metrics: legacy },
      allocations: rec.allocations,
    } as unknown as StoredRun;
    const restored = outputFromStoredRun(stored)!;
    expect(restored.metrics.configured_duration).toBe(60);
    expect(restored.metrics.actual_completion_time).toBe(60);
    expect(restored.metrics.objective_score).toBe(out.metrics.objective_score);
    expect(restored.completed).toBe(true);

    legacy.patients_remaining = 2;
    const partial = outputFromStoredRun({ ...stored, result: { ...rec.result, metrics: legacy } } as unknown as StoredRun)!;
    expect(partial.completed).toBe(false);
    expect(partial.error).toMatch(/2 patient\(s\) were not treated/);
  });
});
