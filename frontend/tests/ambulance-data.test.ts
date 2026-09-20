import { describe, expect, it } from "vitest";
import { createLocalDatabase, createMemoryStore } from "@/lib/database";
import { DEMO_PARAMS, DEMO_PATIENTS, DEMO_RESOURCES, EXAMPLE_AMBULANCES, EXAMPLE_APPOINTMENTS, EXAMPLE_PATIENTS } from "@/lib/demo";
import { CSV_COLUMNS, outcomesToCsv } from "@/lib/export";
import { executeRun, outputFromStoredRun, toSimPatients } from "@/lib/runner";
import { MAX_AMBULANCE_MINUTES, RESOURCE_KEYS, runSimulation } from "@/lib/simulation";
import { validateAmbulance } from "@/lib/validation";

const form = (over: Record<string, unknown> = {}) => ({
  patient_id: "M001",
  condition: "Cardiac event",
  dispatch_time: 20,
  eta: 12,
  urgency: 5,
  treatment_time: 30,
  required_resources: { doctor: 1, icu_bed: 1 },
  ...over,
});

describe("validateAmbulance", () => {
  it("turns dispatch time plus travel time into the arrival and keeps the alert", () => {
    const r = validateAmbulance(form());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.arrival_time).toBe(32);
      expect(r.data.alert_time).toBe(20);
      expect(r.data.required_resources).toEqual({ doctor: 1, icu_bed: 1 });
    }
  });

  it("does not flag it as an appointment", () => {
    const r = validateAmbulance(form());
    expect(r.ok && r.data.appointment).toBeFalsy();
  });

  it("rejects bad timing on the fields the form shows", () => {
    const zero = validateAmbulance(form({ eta: 0 }));
    expect(!zero.ok && zero.errors.eta).toMatch(/at least 1 minute/);
    const negative = validateAmbulance(form({ dispatch_time: -5 }));
    expect(!negative.ok && negative.errors.dispatch_time).toMatch(/cannot be negative/);
    const long = validateAmbulance(form({ eta: MAX_AMBULANCE_MINUTES + 1 }));
    expect(!long.ok && long.errors.eta).toMatch(/limited to/);
    const fractional = validateAmbulance(form({ eta: 2.5 }));
    expect(!fractional.ok && fractional.errors.eta).toMatch(/whole number/);
  });

  it("does not report an arrival-time error for the timing fields", () => {
    const r = validateAmbulance(form({ dispatch_time: Number.NaN, eta: Number.NaN }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.arrival_time).toBeUndefined();
      expect(Object.keys(r.errors).sort()).toEqual(["dispatch_time", "eta"]);
    }
  });

  it("reports every problem at once, patient fields included", () => {
    const r = validateAmbulance(form({ eta: 0, urgency: 9, patient_id: "" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(["eta", "patient_id", "urgency"]);
  });

  it("rejects a duplicate id, ignoring case", () => {
    const r = validateAmbulance(form({ patient_id: "m001" }), ["M001"]);
    expect(!r.ok && r.errors.patient_id).toMatch(/already exists/);
  });

  it("copes with input that is not an object", () => {
    expect(validateAmbulance(null).ok).toBe(false);
    expect(validateAmbulance("nonsense").ok).toBe(false);
  });
});

describe("ambulance patients through storage and runs", () => {
  it("stores the alert time and hands it to the simulation", async () => {
    const db = createLocalDatabase(createMemoryStore());
    await db.insertPatients([...EXAMPLE_PATIENTS.slice(0, 2), ...EXAMPLE_AMBULANCES.slice(0, 1)]);
    const rows = await db.listPatients();
    const sim = toSimPatients(rows);
    expect(sim.find((p) => p.id === "M001")!.ambulance).toEqual({ alert_time: 8 });
    expect(sim.find((p) => p.id === "P001")!.ambulance).toBeUndefined();
  });

  it("does not send an ambulance for a cancelled patient", async () => {
    const db = createLocalDatabase(createMemoryStore());
    await db.insertPatients(EXAMPLE_AMBULANCES.slice(0, 1));
    await db.setPatientStatus("M001", "cancelled");
    expect(toSimPatients(await db.listPatients())).toEqual([]);
  });

  it("re-opens a saved run with its ambulance flags, alert times and metrics", async () => {
    const db = createLocalDatabase(createMemoryStore());
    await db.insertPatients([...EXAMPLE_PATIENTS, ...EXAMPLE_AMBULANCES]);
    await db.saveResources(DEMO_RESOURCES);
    const { output } = await executeRun(db, { strategy: "dynamic", duration: 120 });
    expect(output.metrics.ambulance_total).toBe(EXAMPLE_AMBULANCES.length);

    const [saved] = await db.listRuns();
    expect(saved.run.parameters.ambulances).toEqual(Object.fromEntries(EXAMPLE_AMBULANCES.map((p) => [p.patient_id, p.alert_time])));

    const rebuilt = outputFromStoredRun((await db.getRun(saved.run.id))!)!;
    const amb = rebuilt.patients.filter((p) => p.ambulance);
    expect(amb.map((p) => p.id).sort()).toEqual(EXAMPLE_AMBULANCES.map((p) => p.patient_id).sort());
    expect(amb.every((p) => typeof p.alert_time === "number")).toBe(true);
    expect(rebuilt.patients.find((p) => p.id === "P001")!.ambulance).toBe(false);
    expect(rebuilt.metrics.ambulance_total).toBe(output.metrics.ambulance_total);
  });

  it("still opens a run saved before ambulances existed", async () => {
    const db = createLocalDatabase(createMemoryStore());
    await db.insertPatients(EXAMPLE_PATIENTS);
    await db.saveResources(DEMO_RESOURCES);
    await executeRun(db, { strategy: "dynamic", duration: 120 });
    const [saved] = await db.listRuns();
    const detail = (await db.getRun(saved.run.id))!;
    delete detail.run.parameters.ambulances; // what an older run looks like
    const rebuilt = outputFromStoredRun(detail)!;
    expect(rebuilt.patients.every((p) => p.ambulance === false && p.alert_time === null)).toBe(true);
  });
});

describe("ambulance CSV export", () => {
  it("has an ambulance_alert column filled only for ambulance arrivals", () => {
    const out = runSimulation(
      toSimPatients([
        { ...EXAMPLE_PATIENTS[2], id: "1", status: "waiting", priority_score: 0, created_at: "" },
        { ...EXAMPLE_AMBULANCES[0], id: "2", status: "waiting", priority_score: 0, created_at: "" },
      ]),
      DEMO_RESOURCES,
      { duration: 60 },
    );
    const col = CSV_COLUMNS.indexOf("ambulance_alert");
    expect(col).toBeGreaterThan(-1);
    const rows = outcomesToCsv(out).trimEnd().split("\n").slice(1).map((l) => l.split(","));
    expect(rows.find((r) => r[0] === "M001")![col]).toBe("8");
    expect(rows.find((r) => r[0] === "P003")![col]).toBe("");
  });
});

describe("example and demo ambulances", () => {
  it("example ambulances are valid, warn before arriving and never clash with other examples", () => {
    const ids = new Set([...EXAMPLE_PATIENTS, ...EXAMPLE_APPOINTMENTS].map((p) => p.patient_id.toLowerCase()));
    for (const p of EXAMPLE_AMBULANCES) {
      expect(p.alert_time, p.patient_id).toBeLessThan(p.arrival_time);
      expect(ids.has(p.patient_id.toLowerCase()), p.patient_id).toBe(false);
      expect(p.appointment).toBeUndefined();
      expect(RESOURCE_KEYS.some((k) => p.required_resources[k])).toBe(true);
    }
    expect(new Set(EXAMPLE_AMBULANCES.map((p) => p.patient_id)).size).toBe(EXAMPLE_AMBULANCES.length);
  });

  it("the one-click demo still has 25 patients, four of them by ambulance, all valid to run", () => {
    expect(DEMO_PATIENTS).toHaveLength(25);
    const amb = DEMO_PATIENTS.filter((p) => p.alert_time != null);
    expect(amb.map((p) => p.patient_id)).toEqual(["D07", "D12", "D20", "D23"]);
    for (const p of amb) expect(p.alert_time!).toBeLessThan(p.arrival_time);

    const rows = DEMO_PATIENTS.map((p, i) => ({ ...p, id: String(i), status: "waiting" as const, priority_score: 0, created_at: "" }));
    for (const preAlert of [true, false]) {
      const out = runSimulation(toSimPatients(rows), DEMO_RESOURCES, { ...DEMO_PARAMS, preAlert });
      expect(out.completed).toBe(true);
      expect(out.metrics.ambulance_total).toBe(4);
    }
  });
});
