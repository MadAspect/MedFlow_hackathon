import { describe, expect, it } from "vitest";
import { createLocalDatabase, createMemoryStore, patientInsertRow } from "@/lib/database";
import { DEMO_APPOINTMENTS, DEMO_PARAMS, DEMO_PATIENTS, DEMO_RESOURCES } from "@/lib/demo";
import { executeRun } from "@/lib/runner";
import { defaultParams } from "@/lib/simulation";

describe("demo scenario", () => {
  it("includes appointments and ambulance arrivals", () => {
    expect(DEMO_APPOINTMENTS.length).toBeGreaterThan(0);
    expect(DEMO_APPOINTMENTS.every((p) => p.appointment)).toBe(true);
    expect(DEMO_PATIENTS.filter((p) => p.alert_time != null).length).toBeGreaterThan(0);
  });

  it("simulates to completion with appointments and ambulances flowing through the engine", async () => {
    const db = createLocalDatabase(createMemoryStore());
    await db.saveResources(DEMO_RESOURCES);
    await db.insertPatients([...DEMO_PATIENTS, ...DEMO_APPOINTMENTS]);
    const { output } = await executeRun(db, defaultParams(DEMO_PARAMS));
    expect(output.completed).toBe(true);
    expect(output.patients.filter((p) => p.appointment).length).toBe(DEMO_APPOINTMENTS.length);
    expect(output.patients.filter((p) => p.alert_time != null).length).toBeGreaterThan(0);
  });
});

describe("patientInsertRow", () => {
  it("never leaves appointment or alert_time out, so mixed batches cannot write nulls", () => {
    const plain = patientInsertRow(DEMO_PATIENTS.find((p) => p.alert_time == null)!);
    expect(plain.appointment).toBe(false);
    expect(plain.alert_time).toBeNull();
    expect(patientInsertRow(DEMO_APPOINTMENTS[0]).appointment).toBe(true);
    expect(patientInsertRow(DEMO_PATIENTS.find((p) => p.alert_time != null)!).alert_time).toBeGreaterThanOrEqual(0);
  });
});
