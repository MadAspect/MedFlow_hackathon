import { describe, expect, it } from "vitest";
import {
  DuplicatePatientError,
  createLocalDatabase,
  createMemoryStore,
  resourcesFromRow,
} from "@/lib/database";
import { DEMO_PATIENTS, DEMO_RESOURCES, DEMO_PARAMS, EXAMPLE_PATIENTS } from "@/lib/demo";
import { RunPreconditionError, executeRun, outputFromStoredRun, resetPatientStatuses } from "@/lib/runner";
import { DEFAULT_RESOURCES } from "@/lib/simulation";

const patient = (id: string) => ({ ...EXAMPLE_PATIENTS[0], patient_id: id });

describe("local database adapter", () => {
  it("keeps patients after a 'page refresh' (a new adapter over the same storage)", async () => {
    const store = createMemoryStore();
    await createLocalDatabase(store).insertPatients(EXAMPLE_PATIENTS);

    const afterRefresh = await createLocalDatabase(store).listPatients();
    expect(afterRefresh).toHaveLength(EXAMPLE_PATIENTS.length);
    expect(afterRefresh[0].status).toBe("waiting");
    expect(afterRefresh[0].id).toBeTruthy();
  });

  it("rejects duplicate patient IDs (case-insensitive) without partial writes", async () => {
    const db = createLocalDatabase(createMemoryStore());
    await db.insertPatients([patient("A1")]);
    await expect(db.insertPatients([patient("a1")])).rejects.toBeInstanceOf(DuplicatePatientError);
    await expect(db.insertPatients([patient("B1"), patient("B1")])).rejects.toBeInstanceOf(
      DuplicatePatientError,
    );
    expect(await db.listPatients()).toHaveLength(1);
  });

  it("deletes one patient and clears all", async () => {
    const db = createLocalDatabase(createMemoryStore());
    await db.insertPatients([patient("A1"), patient("A2")]);
    await db.deletePatient("A1");
    expect((await db.listPatients()).map((p) => p.patient_id)).toEqual(["A2"]);
    await db.clearPatients();
    expect(await db.listPatients()).toHaveLength(0);
  });

  it("returns the latest saved resource configuration", async () => {
    const store = createMemoryStore();
    const db = createLocalDatabase(store);
    expect(await db.getLatestResources()).toBeNull();
    await db.saveResources(DEFAULT_RESOURCES);
    await db.saveResources(DEMO_RESOURCES);
    const latest = await createLocalDatabase(store).getLatestResources();
    expect(resourcesFromRow(latest!)).toEqual(DEMO_RESOURCES);
  });
});

describe("simulation pipeline", () => {
  it("refuses to run without patients or resources", async () => {
    const db = createLocalDatabase(createMemoryStore());
    await expect(executeRun(db, {})).rejects.toBeInstanceOf(RunPreconditionError);
    await db.insertPatients([patient("A1")]);
    await expect(executeRun(db, {})).rejects.toThrow(/resource configuration/);
  });

  it("runs, saves history that survives a refresh, and updates patient statuses", async () => {
    const store = createMemoryStore();
    const db = createLocalDatabase(store);
    await db.insertPatients(DEMO_PATIENTS);
    await db.saveResources(DEMO_RESOURCES);

    const { output, stored, patients } = await executeRun(db, DEMO_PARAMS);
    expect(output.isPlaceholder).toBe(false);
    expect(stored.run.status).toBe("completed");
    expect(stored.result!.patients_treated).toBe(output.metrics.patients_treated);
    expect(patients.some((p) => p.status === "treated")).toBe(true);

    // "Refresh": brand-new adapter over the same storage.
    const fresh = createLocalDatabase(store);
    const runs = await fresh.listRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0].result!.average_waiting_time).toBeCloseTo(output.metrics.average_wait);

    const detail = await fresh.getRun(runs[0].run.id);
    const rebuilt = outputFromStoredRun(detail!)!;
    expect(rebuilt.metrics).toEqual(output.metrics);
    expect(rebuilt.patients).toHaveLength(output.patients.length);
    expect(rebuilt.timeline).toHaveLength(output.timeline.length);

    const persisted = await fresh.listPatients();
    expect(persisted.some((p) => p.status === "treated")).toBe(true);
    expect(persisted.find((p) => p.patient_id === "D03")!.priority_score).toBeGreaterThan(0);
  });

  it("excludes cancelled patients and can reset statuses", async () => {
    const db = createLocalDatabase(createMemoryStore());
    await db.insertPatients([patient("A1"), patient("A2")]);
    await db.saveResources(DEFAULT_RESOURCES);
    await db.setPatientStatus("A2", "cancelled");
    const { output } = await executeRun(db, { duration: 60 });
    expect(output.patients.map((p) => p.id)).toEqual(["A1"]);

    const reset = await resetPatientStatuses(db);
    expect(reset.find((p) => p.patient_id === "A1")!.status).toBe("waiting");
    expect(reset.find((p) => p.patient_id === "A2")!.status).toBe("cancelled");
  });
});
