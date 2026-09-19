import { describe, expect, it } from "vitest";
import { DEMO_PARAMS, DEMO_PATIENTS, DEMO_RESOURCES } from "@/lib/demo";
import {
  DEFAULT_WEIGHTS,
  RESOURCE_KEYS,
  SimulationInputError,
  emptyResourceSet,
  generateSurgePatients,
  runAllStrategies,
  runEngine,
  runPlaceholderSimulation,
  runSimulation,
  scoreBreakdown,
  treatmentOrder,
  utilization,
  waitingTime,
  waitHistogram,
  type ResourceRequest,
  type ResourceSet,
  type SimPatient,
  type SimulationOutput,
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

const R = (over: Partial<ResourceSet> = {}): ResourceSet => ({
  ...emptyResourceSet(),
  ...over,
});

/** Independent replay: recompute usage per minute from start/end times only. */
function assertInvariants(out: SimulationOutput) {
  const { duration } = out.params;
  const started = out.patients.filter((p) => p.start_time !== null);

  // No duplicate allocation: every patient starts at most once.
  const ids = out.patients.map((p) => p.id);
  expect(new Set(ids).size).toBe(ids.length);
  const seqs = started.map((p) => p.decision!.seq);
  expect(new Set(seqs).size).toBe(seqs.length);

  for (let t = 0; t < duration; t++) {
    const used = emptyResourceSet();
    for (const p of started) {
      if (p.start_time! <= t && t < p.end_time!) {
        for (const k of RESOURCE_KEYS) used[k] += p.required_resources[k] ?? 0;
      }
    }
    const point = out.timeline[t];
    for (const k of RESOURCE_KEYS) {
      expect(used[k]).toBe(point.in_use[k]); // replay agrees with the engine
      expect(used[k]).toBeLessThanOrEqual(out.resources[k]); // Σ allocated <= capacity
      expect(point.in_use[k]).toBeLessThanOrEqual(point.capacity[k]);
      expect(point.capacity[k]).toBeLessThanOrEqual(out.resources[k]);
      expect(point.in_use[k]).toBeGreaterThanOrEqual(0);
    }
  }
}

describe("waiting time and score", () => {
  it("computes w_i(T) = T - a_i and never goes negative", () => {
    expect(waitingTime(30, 10)).toBe(20);
    expect(waitingTime(5, 10)).toBe(0);
  });

  it("splits S_i(T) into its weighted terms", () => {
    const s = scoreBreakdown({ ...P("A", 10, 5, 30), emergency: true }, 30, DEFAULT_WEIGHTS);
    expect(s.waiting_time).toBe(20);
    expect(s.urgency).toBeCloseTo(4 * 5);
    expect(s.waiting).toBeCloseTo(0.15 * 20);
    expect(s.risk_value).toBeCloseTo(1 - Math.exp(-20 / 30));
    expect(s.risk).toBeCloseTo(3 * (1 - Math.exp(-20 / 30)));
    expect(s.emergency).toBeCloseTo(2);
    expect(s.total).toBeCloseTo(s.urgency + s.waiting + s.risk + s.emergency);
  });
});

describe("utilization", () => {
  it("is used unit-minutes over capacity-minutes", () => {
    expect(utilization(60, 2, 60)).toBeCloseTo(0.5);
    expect(utilization(0, 2, 60)).toBe(0);
  });

  it("is 0 when capacity or duration is zero and capped at 1", () => {
    expect(utilization(10, 0, 60)).toBe(0);
    expect(utilization(10, 2, 0)).toBe(0);
    expect(utilization(500, 1, 10)).toBe(1);
  });

  it("matches a simple simulated run", () => {
    // 1 doctor busy for 30 of 60 minutes -> 50%
    const out = runSimulation([P("A", 0, 3, 30)], R({ doctor: 1 }), { duration: 60 });
    expect(out.metrics.resource_utilization.doctor).toBeCloseTo(0.5);
    expect(out.metrics.resource_utilization.nurse).toBe(0);
  });
});

describe("edge cases", () => {
  it("handles a simulation with no patients", () => {
    const out = runSimulation([], R({ doctor: 2 }), { duration: 30 });
    expect(out.patients).toHaveLength(0);
    expect(out.metrics.patients_treated).toBe(0);
    expect(out.metrics.average_wait).toBe(0);
    expect(out.metrics.maximum_wait).toBe(0);
    expect(out.timeline).toHaveLength(31);
    expect(out.warnings.some((w) => w.code === "no_patients")).toBe(true);
    assertInvariants(out);
  });

  it("handles a simulation with no resources", () => {
    const patients = [P("A", 0, 5, 10), P("B", 3, 2, 10)];
    const out = runSimulation(patients, R(), { duration: 60 });
    expect(out.metrics.patients_treated).toBe(0);
    expect(out.metrics.patients_remaining).toBe(2);
    expect(out.warnings.some((w) => w.code === "no_resources" && w.level === "critical")).toBe(true);
    expect(out.patients.every((p) => p.start_time === null)).toBe(true);
    assertInvariants(out);
  });

  it("never treats a patient who needs more than the hospital has", () => {
    const out = runSimulation([P("A", 0, 5, 10, { icu_bed: 2 })], R({ icu_bed: 1 }), {
      duration: 60,
    });
    expect(out.patients[0].start_time).toBeNull();
    expect(out.patients[0].status).toBe("critical_waiting");
    expect(out.warnings.some((w) => w.code === "unschedulable_icu_bed")).toBe(true);
  });

  it("marks patients arriving after the horizon as not arrived", () => {
    const out = runSimulation([P("A", 100, 3, 10)], R({ doctor: 1 }), { duration: 60 });
    expect(out.patients[0].status).toBe("not_arrived");
    expect(out.metrics.patients_arrived).toBe(0);
  });
});

describe("resource capacity and release", () => {
  it("releases a resource exactly when treatment completes", () => {
    const out = runSimulation(
      [P("A", 0, 3, 10), P("B", 0, 3, 10)],
      R({ doctor: 1 }),
      { strategy: "fcfs", duration: 60 },
    );
    const byId = Object.fromEntries(out.patients.map((p) => [p.id, p]));
    expect(byId.A.start_time).toBe(0);
    expect(byId.A.end_time).toBe(10);
    expect(byId.B.start_time).toBe(10); // starts the minute A releases the doctor
    expect(byId.B.wait_time).toBe(10);
    assertInvariants(out);
  });

  it("starts patients together only when every required resource fits", () => {
    const out = runSimulation(
      [P("A", 0, 3, 20, { doctor: 1, nurse: 2 }), P("B", 0, 3, 20, { doctor: 1, nurse: 2 })],
      R({ doctor: 2, nurse: 3 }),
      { strategy: "fcfs", duration: 60 },
    );
    const byId = Object.fromEntries(out.patients.map((p) => [p.id, p]));
    expect(byId.A.start_time).toBe(0);
    expect(byId.B.start_time).toBe(20); // doctors free, but only 1 nurse left
    assertInvariants(out);
  });

  it("skips a blocked higher-ranked patient and starts one that fits", () => {
    const out = runSimulation(
      [P("BIG", 0, 5, 30, { icu_bed: 1, doctor: 1 }), P("SMALL", 0, 1, 10, { doctor: 1 })],
      R({ doctor: 1, icu_bed: 0 }),
      { strategy: "urgency", duration: 60 },
    );
    const byId = Object.fromEntries(out.patients.map((p) => [p.id, p]));
    expect(byId.BIG.start_time).toBeNull();
    expect(byId.SMALL.start_time).toBe(0);
    expect(byId.SMALL.decision!.skipped.map((s) => s.id)).toEqual(["BIG"]);
    expect(byId.SMALL.decision!.skipped[0].blocked_by).toContain("icu_bed");
    expect(out.metrics.resource_conflicts).toBe(1);
  });

  it("never exceeds capacity in randomized scenarios (all strategies, surge and failure)", () => {
    let seed = 12345;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));

    for (let trial = 0; trial < 25; trial++) {
      const patients: SimPatient[] = [];
      for (let i = 0; i < int(5, 40); i++) {
        const need: ResourceRequest = {};
        for (const k of RESOURCE_KEYS) if (rand() < 0.4) need[k] = int(1, 2);
        if (Object.keys(need).length === 0) need.doctor = 1;
        patients.push(P(`R${i}`, int(0, 80), int(1, 5), int(5, 40), need));
      }
      const resources = R({
        doctor: int(0, 4),
        nurse: int(0, 6),
        bed: int(0, 5),
        icu_bed: int(0, 3),
        operating_room: int(0, 2),
      });
      const outs = runAllStrategies(patients, resources, {
        duration: 90,
        emergencySurge: true,
        surgeStart: 20,
        resourceFailure: true,
        failedResource: RESOURCE_KEYS[int(0, 4)],
        failureStart: int(0, 60),
        failureUnits: int(1, 2),
      });
      for (const out of Object.values(outs)) assertInvariants(out);
    }
  });
});

describe("scheduling policies", () => {
  // Doctor is the only resource. X occupies it, so the queue forms behind X.
  const queueBehindBlocker = (final: SimPatient[]) => [
    P("X", 0, 5, 200),
    P("B", 1, 1, 10), // low urgency, waits a very long time
    ...final,
  ];

  it("FCFS treats patients in arrival order regardless of urgency", () => {
    const patients = queueBehindBlocker([P("Y", 195, 5, 10)]);
    const out = runSimulation(patients, R({ doctor: 1 }), { strategy: "fcfs", duration: 300 });
    expect(treatmentOrder(out)).toEqual(["X", "B", "Y"]);
  });

  it("Urgency Only puts the most urgent waiting patient first", () => {
    const patients = queueBehindBlocker([P("Y", 195, 5, 10)]);
    const out = runSimulation(patients, R({ doctor: 1 }), { strategy: "urgency", duration: 300 });
    expect(treatmentOrder(out)).toEqual(["X", "Y", "B"]);
  });

  it("Urgency Only breaks ties by arrival time", () => {
    const out = runSimulation(
      [P("X", 0, 5, 20), P("L", 5, 3, 10), P("E", 2, 3, 10)],
      R({ doctor: 1 }),
      { strategy: "urgency", duration: 100 },
    );
    expect(treatmentOrder(out)).toEqual(["X", "E", "L"]);
  });

  it("Dynamic Priority lets a long wait outweigh a fresh urgent arrival", () => {
    const patients = queueBehindBlocker([P("Y", 195, 5, 10)]);
    const out = runSimulation(patients, R({ doctor: 1 }), { strategy: "dynamic", duration: 300 });
    expect(treatmentOrder(out)).toEqual(["X", "B", "Y"]);
    const b = out.patients.find((p) => p.id === "B")!;
    const y = out.patients.find((p) => p.id === "Y")!;
    expect(b.decision!.score.total).toBeGreaterThan(20); // beat a fresh urgency-5 arrival
    expect(b.decision!.score.waiting).toBeGreaterThan(y.decision!.score.waiting);
  });

  it("Dynamic Priority still favours urgency when waits are similar", () => {
    const out = runSimulation(
      [P("X", 0, 3, 20), P("LOW", 1, 1, 10), P("HIGH", 2, 5, 10)],
      R({ doctor: 1 }),
      { strategy: "dynamic", duration: 100 },
    );
    expect(treatmentOrder(out)).toEqual(["X", "HIGH", "LOW"]);
  });

  it("records the score components that explain each decision", () => {
    const out = runSimulation([P("A", 0, 4, 10)], R({ doctor: 1 }), { duration: 30 });
    const d = out.patients[0].decision!;
    expect(d.score.urgency).toBeCloseTo(16);
    expect(d.time).toBe(0);
    expect(d.available_before.doctor).toBe(1);
    expect(d.required).toEqual({ doctor: 1 });
  });

  it("is deterministic and does not mutate its input", () => {
    const patients = DEMO_PATIENTS.map((p) => ({
      id: p.patient_id,
      condition: p.condition,
      arrival_time: p.arrival_time,
      urgency: p.urgency,
      treatment_time: p.treatment_time,
      required_resources: p.required_resources,
    }));
    const before = JSON.stringify(patients);
    const a = runSimulation(patients, DEMO_RESOURCES, DEMO_PARAMS);
    const b = runSimulation(patients, DEMO_RESOURCES, DEMO_PARAMS);
    expect(a).toEqual(b);
    expect(JSON.stringify(patients)).toBe(before);
  });
});

describe("metrics", () => {
  it("computes waits, critical wait, threshold breaches and queue length", () => {
    const out = runSimulation(
      [P("A", 0, 4, 10), P("B", 0, 4, 10), P("C", 0, 1, 10)],
      R({ doctor: 1 }),
      { strategy: "fcfs", duration: 25, safetyThreshold: 5 },
    );
    // waits: A 0, B 10, C 20
    expect(out.metrics.patients_treated).toBe(2); // A (0-10), B (10-20); C starts at 20, ends 30
    expect(out.metrics.average_wait).toBeCloseTo(10);
    expect(out.metrics.maximum_wait).toBe(20);
    expect(out.metrics.critical_wait).toBeCloseTo(5); // A and B
    expect(out.metrics.safety_threshold_breaches).toBe(2);
    expect(out.metrics.patients_remaining).toBe(1);
    expect(out.metrics.queue_length_final).toBe(0);
    expect(out.metrics.peak_queue_length).toBe(2);
  });

  it("counts still-waiting patients with their wait so far", () => {
    const out = runSimulation([P("A", 0, 3, 100), P("B", 10, 3, 10)], R({ doctor: 1 }), {
      duration: 50,
    });
    const b = out.patients.find((p) => p.id === "B")!;
    expect(b.status).toBe("waiting");
    expect(b.wait_time).toBe(40);
  });

  it("builds a wait histogram", () => {
    const out = runSimulation([P("A", 0, 3, 10), P("B", 0, 3, 10)], R({ doctor: 1 }), {
      strategy: "fcfs",
      duration: 60,
    });
    const hist = waitHistogram(out.patients, 10);
    expect(hist.reduce((s, h) => s + h.count, 0)).toBe(2);
  });
});

describe("emergency surge", () => {
  const base = [P("A", 0, 3, 20, { doctor: 1, icu_bed: 1 })];
  const resources = R({ doctor: 2, nurse: 4, bed: 4, icu_bed: 1, operating_room: 1 });

  it("adds deterministic synthetic emergency arrivals from the surge start", () => {
    const surge = generateSurgePatients(20, 10);
    expect(surge).toHaveLength(10);
    expect(surge[0].arrival_time).toBe(20);
    expect(surge.every((p) => p.emergency)).toBe(true);
    expect(generateSurgePatients(20, 10)).toEqual(surge);
  });

  it("increases patient count and queue pressure", () => {
    const calm = runSimulation(base, resources, { duration: 60 });
    const surge = runSimulation(base, resources, {
      duration: 60,
      emergencySurge: true,
      surgeStart: 10,
    });
    expect(calm.metrics.total_patients).toBe(1);
    expect(surge.metrics.total_patients).toBe(11);
    expect(surge.metrics.peak_queue_length).toBeGreaterThan(calm.metrics.peak_queue_length);
    expect(surge.warnings.some((w) => w.code === "surge")).toBe(true);
    assertInvariants(surge);
  });

  it("gives surge patients the emergency term in the dynamic score", () => {
    const out = runSimulation([], resources, {
      emergencySurge: true,
      surgeStart: 0,
      duration: 30,
    });
    const started = out.patients.find((p) => p.decision)!;
    expect(started.decision!.score.emergency).toBeCloseTo(DEFAULT_WEIGHTS.delta);
  });
});

describe("resource failure", () => {
  const patients = [
    P("A", 0, 5, 30, { icu_bed: 1 }),
    P("B", 0, 5, 30, { icu_bed: 1 }),
    P("C", 40, 5, 20, { icu_bed: 1 }),
    P("D", 40, 5, 20, { icu_bed: 1 }),
  ];
  const resources = R({ icu_bed: 2 });

  it("takes the failed unit offline and reduces what can be treated", () => {
    const ok = runSimulation(patients, resources, { duration: 70, strategy: "fcfs" });
    const failed = runSimulation(patients, resources, {
      duration: 70,
      strategy: "fcfs",
      resourceFailure: true,
      failedResource: "icu_bed",
      failureStart: 10,
      failureUnits: 1,
    });
    expect(ok.metrics.patients_treated).toBe(4);
    // With one ICU bed after minute 30, C and D can no longer run in parallel.
    expect(failed.metrics.patients_treated).toBeLessThan(ok.metrics.patients_treated);
    expect(failed.metrics.maximum_wait).toBeGreaterThan(ok.metrics.maximum_wait);
    expect(failed.warnings.some((w) => w.code === "failure")).toBe(true);
    assertInvariants(failed);
  });

  it("keeps an occupied failing unit busy until it is freed, then removes it", () => {
    const out = runSimulation(patients, resources, {
      duration: 70,
      strategy: "fcfs",
      resourceFailure: true,
      failedResource: "icu_bed",
      failureStart: 10,
      failureUnits: 1,
    });
    expect(out.timeline[15].capacity.icu_bed).toBe(2); // both beds still in use
    expect(out.timeline[35].capacity.icu_bed).toBe(1); // one bed offline once freed
    const startsAfter = out.patients.filter((p) => p.start_time !== null && p.start_time >= 30);
    for (const p of startsAfter) {
      const concurrent = out.patients.filter(
        (q) => q.start_time !== null && q.start_time <= p.start_time! && q.end_time! > p.start_time!,
      );
      expect(concurrent.length).toBeLessThanOrEqual(1);
    }
  });

  it("caps failed units at the configured capacity", () => {
    const out = runSimulation(patients, R({ icu_bed: 1 }), {
      duration: 70,
      resourceFailure: true,
      failedResource: "icu_bed",
      failureStart: 0,
      failureUnits: 5,
    });
    assertInvariants(out);
    expect(out.patients.every((p) => p.start_time === null)).toBe(true);
  });
});

describe("input validation", () => {
  it("rejects negative resource counts", () => {
    expect(() => runSimulation([P("A", 0, 3, 10)], R({ doctor: -1 }))).toThrow(SimulationInputError);
    expect(() => runSimulation([P("A", 0, 3, 10)], R({ doctor: 1.5 }))).toThrow(SimulationInputError);
  });

  it("rejects invalid urgency, times, empty needs and duplicate ids", () => {
    const r = R({ doctor: 1 });
    expect(() => runSimulation([P("A", 0, 0, 10)], r)).toThrow(/urgency/);
    expect(() => runSimulation([P("A", 0, 6, 10)], r)).toThrow(/urgency/);
    expect(() => runSimulation([P("A", -1, 3, 10)], r)).toThrow(/arrival/);
    expect(() => runSimulation([P("A", 0, 3, 0)], r)).toThrow(/treatment/);
    expect(() => runSimulation([P("A", 0, 3, 10, {})], r)).toThrow(/resource/);
    expect(() => runSimulation([P("A", 0, 3, 10), P("A", 1, 3, 10)], r)).toThrow(/Duplicate/);
  });
});

describe("strategy comparison", () => {
  it("runs all strategies on identical input", () => {
    const patients = DEMO_PATIENTS.map((p) => ({
      id: p.patient_id,
      condition: p.condition,
      arrival_time: p.arrival_time,
      urgency: p.urgency,
      treatment_time: p.treatment_time,
      required_resources: p.required_resources,
    }));
    const outs = runAllStrategies(patients, DEMO_RESOURCES, DEMO_PARAMS);
    const arrivals = (o: SimulationOutput) =>
      o.patients.map((p) => `${p.id}:${p.arrival_time}:${p.urgency}:${p.treatment_time}`).sort();
    expect(arrivals(outs.fcfs)).toEqual(arrivals(outs.urgency));
    expect(arrivals(outs.fcfs)).toEqual(arrivals(outs.dynamic));
    expect(outs.fcfs.strategy).toBe("fcfs");
    expect(outs.urgency.strategy).toBe("urgency");
    expect(outs.dynamic.strategy).toBe("dynamic");
    expect(treatmentOrder(outs.dynamic)).not.toEqual(treatmentOrder(outs.fcfs));
    for (const out of Object.values(outs)) assertInvariants(out);
  });
});

describe("demo scenario", () => {
  const patients = DEMO_PATIENTS.map((p) => ({
    id: p.patient_id,
    condition: p.condition,
    arrival_time: p.arrival_time,
    urgency: p.urgency,
    treatment_time: p.treatment_time,
    required_resources: p.required_resources,
  }));

  it("has 25 patients with ICU and operating-room needs", () => {
    expect(DEMO_PATIENTS).toHaveLength(25);
    expect(DEMO_PATIENTS.filter((p) => p.required_resources.icu_bed).length).toBeGreaterThanOrEqual(3);
    expect(DEMO_PATIENTS.filter((p) => p.required_resources.operating_room).length).toBeGreaterThanOrEqual(1);
  });

  it("shows queue growth after the surge, an ICU bottleneck and a failure effect", () => {
    const out = runSimulation(patients, DEMO_RESOURCES, DEMO_PARAMS);
    expect(out.metrics.peak_queue_time).toBeGreaterThanOrEqual(20);
    expect(out.timeline[19].queue_length).toBeLessThan(out.metrics.peak_queue_length);
    expect(out.metrics.bottlenecks[0].resource).toBe("icu_bed");
    expect(out.metrics.resource_utilization.icu_bed).toBeGreaterThan(0.7);
    expect(out.timeline[59].capacity.icu_bed).toBeLessThan(2);

    const noFailure = runSimulation(patients, DEMO_RESOURCES, {
      ...DEMO_PARAMS,
      resourceFailure: false,
    });
    expect(out.metrics.average_wait).toBeGreaterThan(noFailure.metrics.average_wait);
    assertInvariants(out);
  });
});

describe("placeholder engine", () => {
  it("is always flagged as placeholder output", () => {
    const out = runPlaceholderSimulation([P("A", 0, 3, 10)], R({ doctor: 1 }), { duration: 30 });
    expect(out.isPlaceholder).toBe(true);
    expect(out.warnings[0].message).toMatch(/Placeholder simulation output/);
  });

  it("runEngine dispatches on mode", () => {
    const patients = [P("A", 0, 3, 10)];
    expect(runEngine(patients, R({ doctor: 1 }), { duration: 30 }, "placeholder").isPlaceholder).toBe(true);
    expect(runEngine(patients, R({ doctor: 1 }), { duration: 30 }, "real").isPlaceholder).toBe(false);
  });
});
