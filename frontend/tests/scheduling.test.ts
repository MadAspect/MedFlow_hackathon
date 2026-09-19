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
  DECISION_CRITERIA,
  FCFS_NOTE,
  SAME_ORDER_MESSAGE,
  analyse,
  compareStrategies,
  emptyResourceSet,
  improvementPercent,
  objectiveScore,
  recommendResource,
  recommendStrategy,
  runAllStrategies,
  runSimulation,
  scoreBreakdown,
  treatmentOrder,
  waitByUrgency,
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

describe("reservation backfilling (protect blocked critical patients)", () => {
  // Two doctors. A stream of one-doctor patients (every 5 min, 10 min each) keeps both
  // busy, so two doctors are never free together, and BIG (critical) needs both.
  const stream = (): SimPatient[] => {
    const out: SimPatient[] = [P("BIG", 1, 5, 10, { doctor: 2 })];
    for (let i = 0; i <= 20; i++) out.push(P(`S${String(i).padStart(2, "0")}`, i * 5, 2, 10));
    return out;
  };
  const twoDoctors = R({ doctor: 2 });

  it("starves a multi-resource critical patient without it", () => {
    const out = runSimulation(stream(), twoDoctors, { strategy: "dynamic", duration: 60 });
    expect(byId(out).BIG.start_time!).toBeGreaterThan(100); // waits out the whole stream
  });

  it("starts the critical patient as soon as their resources can be freed", () => {
    const out = runSimulation(stream(), twoDoctors, { strategy: "dynamic", duration: 60, reservation: true });
    expect(byId(out).BIG.start_time).toBe(10); // the first doctor frees at 10; no later patient jumps ahead
    expect(out.completed).toBe(true);
  });

  it("is off by default, so existing results are unchanged", () => {
    const plain = runSimulation(stream(), twoDoctors, { strategy: "dynamic", duration: 60 });
    const off = runSimulation(stream(), twoDoctors, { strategy: "dynamic", duration: 60, reservation: false });
    expect(JSON.stringify(off.patients)).toBe(JSON.stringify(plain.patients));
    expect(JSON.stringify(off.metrics)).toBe(JSON.stringify(plain.metrics));
  });

  it("only protects a head that is critical, an emergency or past the safety limit", () => {
    const patients = stream().map((p) => (p.id === "BIG" ? { ...p, urgency: 2 } : p));
    const out = runSimulation(patients, twoDoctors, { strategy: "dynamic", duration: 60, reservation: true });
    // An urgency-2 head with no long wait gets no reservation, so it is not protected early.
    expect(byId(out).BIG.start_time!).toBeGreaterThan(30);
  });

  it("still lets patients fill gaps that cannot delay the reserved start", () => {
    // X holds the doctor until 50. BIG (critical, 2 doctors) is reserved for minute 50; a short
    // ICU-only patient fits now, finishes long before that, and may go first.
    const out = runSimulation(
      [P("X", 0, 3, 50), P("BIG", 1, 5, 10, { doctor: 2 }), P("ICU", 5, 1, 10, { icu_bed: 1 })],
      R({ doctor: 2, icu_bed: 1 }),
      { strategy: "dynamic", duration: 100, reservation: true },
    );
    expect(byId(out).ICU.start_time).toBe(5);
    expect(byId(out).BIG.start_time).toBe(50);
  });

  it("keeps every invariant on random scenarios: same completion, nothing over capacity", () => {
    for (let seed = 1; seed <= 40; seed++) {
      let s = seed;
      const rand = () => {
        s = (s * 1664525 + 1013904223) % 4294967296;
        return s / 4294967296;
      };
      const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
      const patients: SimPatient[] = [];
      for (let i = 0; i < int(10, 40); i++) {
        const need: ResourceRequest = {};
        for (const k of RESOURCE_KEYS) if (rand() < 0.4) need[k] = int(1, 2);
        if (Object.keys(need).length === 0) need.doctor = 1;
        patients.push(P(`R${String(i).padStart(2, "0")}`, int(0, 80), int(1, 5), int(5, 40), need));
      }
      const resources = R({ doctor: int(2, 4), nurse: int(2, 6), bed: int(2, 5), icu_bed: int(2, 3), operating_room: int(2, 2) });
      for (const strategy of ["fcfs", "urgency", "dynamic"] as const) {
        const params = {
          strategy,
          duration: 30,
          emergencySurge: seed % 3 === 0,
          resourceFailure: seed % 4 === 0,
          failedResource: RESOURCE_KEYS[seed % 5],
          failureStart: 25,
        };
        const out = runSimulation(patients, resources, { ...params, reservation: true });
        // A failure can legitimately leave a need above capacity; reservation must not change that.
        expect(out.completed, `seed ${seed} ${strategy}`).toBe(runSimulation(patients, resources, params).completed);
        expect(out.metrics.resource_overload).toBe(0);
        for (const point of out.timeline) {
          for (const k of RESOURCE_KEYS) expect(point.in_use[k]).toBeLessThanOrEqual(out.resources[k]);
        }
      }
    }
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

describe("strategy analysis, improvement formula and resource what-ifs", () => {
  const params = { duration: 60 };

  it("runs every strategy on identical, unmodified input", () => {
    const patients = contrastPatients();
    const snapshot = JSON.stringify(patients);
    for (const p of patients) {
      Object.freeze(p.required_resources);
      Object.freeze(p);
    }
    const a = analyse(patients, CONTRAST_RESOURCES, params);
    expect(JSON.stringify(patients)).toBe(snapshot); // input not mutated
    expect(a.outputs.fcfs.strategy).toBe("fcfs");
    expect(a.outputs.urgency.strategy).toBe("urgency");
    expect(a.outputs.dynamic.strategy).toBe("dynamic");
    const key = (o: SimulationOutput) =>
      o.patients
        .map((p) => `${p.id}:${p.arrival_time}:${p.urgency}:${p.treatment_time}:${JSON.stringify(p.required_resources)}`)
        .sort();
    expect(key(a.outputs.fcfs)).toEqual(key(a.outputs.dynamic));
    expect(key(a.outputs.fcfs)).toEqual(key(a.outputs.urgency));
    expect(a.outputs.fcfs.resources).toEqual(a.outputs.dynamic.resources);
  });

  it("takes every comparison value from real simulation runs", () => {
    const patients = contrastPatients();
    const a = analyse(patients, CONTRAST_RESOURCES, params);
    const row = (s: Strategy) => a.comparison.rows.find((r) => r.strategy === s)!;
    for (const s of ["fcfs", "urgency", "dynamic"] as const) {
      const m = runSimulation(patients, CONTRAST_RESOURCES, { ...params, strategy: s }).metrics;
      expect(row(s).avgWait).toBe(m.average_wait);
      expect(row(s).criticalWait).toBe(m.critical_wait);
      expect(row(s).maxWait).toBe(m.maximum_wait);
      expect(row(s).breaches).toBe(m.safety_threshold_breaches);
      expect(row(s).completion).toBe(m.actual_completion_time);
      expect(row(s).remaining).toBe(m.patients_remaining);
    }
    expect(a.comparison.rows.map((r) => r.strategy)).toEqual(["fcfs", "urgency", "dynamic"]);
  });

  it("uses the specified improvement formulas", () => {
    expect(improvementPercent(200, 150, "lower")).toBeCloseTo(25);
    expect(improvementPercent(150, 200, "lower")).toBeCloseTo(-33.3333, 3);
    expect(improvementPercent(0.5, 0.75, "higher")).toBeCloseTo(50);
    expect(improvementPercent(0, 0, "lower")).toBe(0);
    expect(improvementPercent(0, 1, "higher")).toBeCloseTo((1 / 0.0001) * 100);
    const rec = recommendResource(contrastPatients(), CONTRAST_RESOURCES, params);
    for (const c of rec.candidates) {
      const expected =
        ((rec.baseline.metrics.objective_score - c.objective) / Math.max(Math.abs(rec.baseline.metrics.objective_score), 0.0001)) * 100;
      expect(c.improvementPct).toBeCloseTo(expected);
    }
  });

  it("computes the objective score from the specified weights", () => {
    expect(
      objectiveScore({ total_waiting_time: 100, critical_wait_total: 10, patients_remaining: 2, resource_overload: 1, maximum_wait: 40 }),
    ).toBe(100 + 40 + 20000 + 10000 + 20);
    const out = run("fcfs", [P("A", 0, 5, 10), P("B", 0, 5, 10)], R({ doctor: 1 }));
    // waits 0 and 10: total 10, critical total 10, max 10, nothing remaining or overloaded
    expect(out.metrics.objective_score).toBe(10 + 4 * 10 + 0.5 * 10);
  });

  it("flags identical orders with the required message", () => {
    // Patients never overlap, so every policy must choose the same order.
    const patients = [P("A", 0, 3, 10), P("B", 20, 3, 10)];
    const lab = compareStrategies(runAllStrategies(patients, R({ doctor: 1 }), params));
    expect(lab.sameOrder).toHaveLength(3); // fcfs=urgency, fcfs=dynamic, urgency=dynamic
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
    expect(rec.strategy).toBe("dynamic"); // the default
    for (const cand of rec.candidates) {
      expect(cand.totalWaitSaved).toBe(rec.baseline.metrics.total_waiting_time - cand.output.metrics.total_waiting_time);
      expect(cand.criticalWaitSaved).toBe(rec.baseline.metrics.critical_wait_total - cand.output.metrics.critical_wait_total);
      expect(cand.completionSaved).toBe(rec.baseline.metrics.actual_completion_time - cand.output.metrics.actual_completion_time);
    }
  });

  it("can test the what-ifs under another strategy", () => {
    const patients = contrastPatients();
    const rec = recommendResource(patients, CONTRAST_RESOURCES, params, "fcfs");
    expect(rec.strategy).toBe("fcfs");
    expect(rec.baseline.strategy).toBe("fcfs");
    expect(rec.baseline.metrics.objective_score).toBe(run("fcfs", patients, CONTRAST_RESOURCES, 60).metrics.objective_score);
  });
});

describe("strategy verdict and advice", () => {
  // One doctor is busy with X until minute 100. Urgent C arrives after minor L.
  const oneDoctor = R({ doctor: 1 });
  const contested = () => blocked(P("L", 1, 1, 10), P("C", 2, 5, 10));
  const params = { duration: 200 };

  it("checks the criteria in a fixed priority order", () => {
    expect(DECISION_CRITERIA.map((c) => c.key)).toEqual(["remaining", "breaches", "critical", "max", "avg"]);
  });

  it("recommends the strategy that protects critical patients and names the trade-off", () => {
    const a = analyse(contested(), oneDoctor, params);
    const fcfs = a.outputs.fcfs.metrics;
    const dyn = a.outputs.dynamic.metrics;
    expect(fcfs.critical_wait).toBe(108); // C waits behind L
    expect(dyn.critical_wait).toBe(98); // C is treated first
    // Dynamic Priority and Urgency Only behave identically here; the tie keeps Dynamic Priority.
    expect(a.verdict.strategy).toBe("dynamic");
    expect(a.verdict.tie).toBe(false);
    expect(a.verdict.headline).toBe(
      "Dynamic Priority is recommended: it gives the shortest average wait for critical patients (98 min vs 108 min under First-Come, First-Served).",
    );
    expect(a.verdict.details).toEqual([
      "Trade-off compared with First-Come, First-Served: critical patients wait 10 min less on average and other patients wait 5 min more.",
    ]);
  });

  it("puts the safety limit ahead of critical-patient wait", () => {
    const outs = structuredClone(runAllStrategies(contested(), oneDoctor, params));
    expect(recommendStrategy(outs).strategy).toBe("dynamic");
    // First-Come, First-Served now has fewer patients past the safety limit, so it wins despite the worst critical wait.
    outs.fcfs.metrics.safety_threshold_breaches = 0;
    expect(recommendStrategy(outs).strategy).toBe("fcfs");
    // An unfinished run loses to a finished one before anything else is looked at.
    outs.fcfs.metrics.patients_remaining = 1;
    expect(recommendStrategy(outs).strategy).not.toBe("fcfs");
  });

  it("keeps First-Come, First-Served when nothing separates the strategies", () => {
    const a = analyse([P("A", 0, 3, 10), P("B", 20, 3, 10)], oneDoctor, params);
    expect(a.verdict.tie).toBe(true);
    expect(a.verdict.strategy).toBe("fcfs");
    expect(a.verdict.headline).toMatch(/^First-Come, First-Served is enough here/);
    expect(a.advice.map((i) => i.id)).toEqual(["copes"]);
    expect(a.advice[0].tone).toBe("green");
  });

  it("shows who waits, by urgency level, most urgent first", () => {
    const rows = waitByUrgency(runAllStrategies(contested(), oneDoctor, params));
    expect(rows.map((r) => r.urgency)).toEqual([5, 3, 1]);
    expect(rows[0]).toMatchObject({ urgency: 5, patients: 1, average: { fcfs: 108, urgency: 98, dynamic: 98 } });
    expect(rows[1].average).toEqual({ fcfs: 0, urgency: 0, dynamic: 0 });
    expect(rows[2].average).toEqual({ fcfs: 99, urgency: 109, dynamic: 109 }); // the price low-urgency patients pay
  });

  it("gives calculated advice, most urgent first", () => {
    const a = analyse(contested(), oneDoctor, params);
    const ids = a.advice.map((i) => i.id);
    expect(ids).toEqual(["safety-breaches", "add-resource", "dynamic-equals-urgency"]);
    expect(a.advice.map((i) => i.tone)).toEqual(["yellow", "green", "blue"]);
    expect(a.advice[0].title).toBe("2 patients waited longer than the 30-minute safety limit");
    expect(a.advice[1].title).toBe("Add 1 doctor");
    // The suggestion is backed by a real re-run with one more doctor.
    const withTwo = runSimulation(contested(), R({ doctor: 2 }), { ...params, strategy: "dynamic" }).metrics;
    expect(a.recommendation.best?.resource).toBe("doctor");
    expect(a.recommendation.best?.output.metrics.total_waiting_time).toBe(withTwo.total_waiting_time);
    expect(a.advice[1].detail).toContain(`total waiting falls by ${a.recommendation.best!.totalWaitSaved} min`);
  });

  it("flags unfinished runs as a problem before anything else", () => {
    const a = analyse([P("A", 0, 5, 10, { icu_bed: 2 }), P("B", 0, 3, 10)], R({ doctor: 1, icu_bed: 1 }), { duration: 60 });
    expect(a.advice[0]).toMatchObject({ id: "incomplete", tone: "red" });
    expect(a.advice[0].detail).toMatch(/needs 2 icu beds but only 1 exist/i);
  });

  it("says First-Come, First-Served is the most common and basic approach", () => {
    expect(FCFS_NOTE).toMatch(/most common and basic approach/);
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
    const c1 = analyse(patients, DEMO_RESOURCES, DEMO_PARAMS);
    const c2 = analyse(patients, DEMO_RESOURCES, DEMO_PARAMS);
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
    analyse(patients, CONTRAST_RESOURCES, CONTRAST_PARAMS);
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
