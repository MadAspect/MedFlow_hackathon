import { afterEach, describe, expect, it } from "vitest";
import { createLocalDatabase, createMemoryStore, mergeRequirements } from "@/lib/database";
import { EXAMPLE_EQUIPMENT, EXAMPLE_MEDICINES, createEquipment, createMedicine, stockConstraintsEnabled } from "@/lib/inventory";
import { executeRun, outputFromStoredRun } from "@/lib/runner";
import { DEFAULT_RESOURCES } from "@/lib/simulation";
import { EXAMPLE_STAFF, changeAvailability } from "@/lib/staff";

const NOW = "2026-05-01T10:00:00.000Z";

const patient = (id: string, arrival: number, treatment = 10, urgency = 3, required = { doctor: 1 }) => ({
  patient_id: id,
  condition: "Test",
  arrival_time: arrival,
  urgency,
  treatment_time: treatment,
  required_resources: required,
});

async function seed(resources = { ...DEFAULT_RESOURCES, doctor: 2 }) {
  const store = createMemoryStore();
  const db = createLocalDatabase(store);
  await db.saveResources(resources);
  return { store, db };
}

const FLAG = "NEXT_PUBLIC_ENABLE_STOCK_CONSTRAINTS";
afterEach(() => {
  delete process.env[FLAG];
});

describe("stock and staff persistence (browser-storage fallback)", () => {
  it("keeps medicines, equipment and staff across a page refresh", async () => {
    const { store, db } = await seed();
    await db.saveMedicine(EXAMPLE_MEDICINES[0]);
    await db.saveEquipment(EXAMPLE_EQUIPMENT[0]);
    await db.saveStaff(EXAMPLE_STAFF[0]);

    const fresh = createLocalDatabase(store);
    expect((await fresh.listMedicines()).map((m) => m.id)).toEqual(["iv_sets"]);
    expect((await fresh.listEquipment()).map((e) => e.id)).toEqual(["ventilator"]);
    expect((await fresh.listStaff()).map((s) => s.id)).toEqual(["D01"]);
  });

  it("edits in place and removes", async () => {
    const { db } = await seed();
    await db.saveMedicine(EXAMPLE_MEDICINES[0]);
    await db.saveMedicine({ ...EXAMPLE_MEDICINES[0], quantity: 7 });
    expect(await db.listMedicines()).toHaveLength(1);
    expect((await db.listMedicines())[0].quantity).toBe(7);
    await db.deleteMedicine("iv_sets");
    expect(await db.listMedicines()).toEqual([]);
  });

  it("records availability changes as history, newest first", async () => {
    const { db } = await seed();
    await db.addStaffEvent({ staff_id: "D01", previous_status: "available", new_status: "on_leave", effective_time: 30, reason: "sick" });
    await db.addStaffEvent({ staff_id: "D01", previous_status: "on_leave", new_status: "available", effective_time: 90, reason: "" });
    const events = await db.listStaffEvents();
    expect(events.map((e) => e.new_status)).toEqual(["available", "on_leave"]);
    expect(events[1]).toMatchObject({ effective_time: 30, reason: "sick" });
    expect(events[0].id).not.toBe(events[1].id);
  });

  it("stores what each patient needs and drops it when the patient goes", async () => {
    const { db } = await seed();
    await db.insertPatients([patient("P1", 0), patient("P2", 0)]);
    await db.setStockRequirements("P1", [
      { item_type: "equipment", item_id: "ventilator", quantity: 1 },
      { item_type: "medicine", item_id: "iv_sets", quantity: 2 },
      { item_type: "medicine", item_id: "iv_sets", quantity: 3 },
    ]);
    await db.setStockRequirements("P2", [{ item_type: "medicine", item_id: "iv_sets", quantity: 1 }]);
    const rows = await db.listStockRequirements();
    expect(rows.find((r) => r.patient_id === "P1" && r.item_id === "iv_sets")?.quantity_required).toBe(5); // merged
    expect(rows).toHaveLength(3);

    await db.setStockRequirements("P1", []); // clearing
    expect((await db.listStockRequirements()).map((r) => r.patient_id)).toEqual(["P2"]);
    await db.deletePatient("P2");
    expect(await db.listStockRequirements()).toEqual([]);
  });

  it("merges repeated lines and ignores zero quantities", () => {
    expect(
      mergeRequirements([
        { item_type: "medicine", item_id: "a", quantity: 1 },
        { item_type: "medicine", item_id: "a", quantity: 2 },
        { item_type: "equipment", item_id: "a", quantity: 1 },
        { item_type: "medicine", item_id: "b", quantity: 0 },
      ]),
    ).toEqual([
      { item_type: "medicine", item_id: "a", quantity: 3 },
      { item_type: "equipment", item_id: "a", quantity: 1 },
    ]);
  });
});

describe("the feature flag", () => {
  it("is off unless it is exactly 'true'", () => {
    expect(stockConstraintsEnabled()).toBe(false);
    process.env[FLAG] = "yes";
    expect(stockConstraintsEnabled()).toBe(false);
    process.env[FLAG] = "true";
    expect(stockConstraintsEnabled()).toBe(true);
  });

  async function twoVentilatorPatients() {
    const { db } = await seed();
    await db.saveEquipment(createEquipment({ name: "Ventilator", category: "Respiratory", quantity: 1, minimum_threshold: 0 }, "vent", NOW));
    await db.insertPatients([patient("P1", 0), patient("P2", 0)]);
    for (const id of ["P1", "P2"]) await db.setStockRequirements(id, [{ item_type: "equipment", item_id: "vent", quantity: 1 }]);
    return db;
  }

  it("leaves the existing simulation untouched while it is off", async () => {
    const db = await twoVentilatorPatients();
    const { output } = await executeRun(db, {});
    expect(output.patients.map((p) => p.start_time)).toEqual([0, 0]); // two doctors, stock ignored
    expect(output.stock).toBeUndefined();
    expect(output.params.stock).toBeUndefined();
  });

  it("applies stock once it is on, and the stored run remembers the snapshot", async () => {
    process.env[FLAG] = "true";
    const db = await twoVentilatorPatients();
    const { output, stored } = await executeRun(db, {});
    expect(output.patients.map((p) => p.start_time).sort()).toEqual([0, 10]);
    expect(output.params.stock?.equipment.vent.units).toBe(1);

    const reopened = outputFromStoredRun((await db.getRun(stored.run.id))!)!;
    expect(reopened.params.stock?.equipment.vent.units).toBe(1);
    expect(reopened.patients.find((p) => p.start_time === 10)?.stock_requirements).toEqual([{ item_type: "equipment", item_id: "vent", quantity: 1 }]);
  });

  it("never writes a run's consumption back to the inventory, so re-running is repeatable", async () => {
    process.env[FLAG] = "true";
    const { db } = await seed();
    await db.saveMedicine(createMedicine({ name: "IV sets", category: "Infusion", quantity: 10, minimum_threshold: 2, unit: "sets" }, "iv", NOW));
    await db.insertPatients([patient("P1", 0)]);
    await db.setStockRequirements("P1", [{ item_type: "medicine", item_id: "iv", quantity: 4 }]);
    const first = await executeRun(db, {});
    const second = await executeRun(db, {});
    expect(first.output.stock!.medicines[0].remaining).toBe(6);
    expect(second.output.stock!.medicines[0].remaining).toBe(6);
    expect((await db.listMedicines())[0].quantity).toBe(10);
  });

  it("reports a stock shortage as an explicit error, not a silent success", async () => {
    process.env[FLAG] = "true";
    const { db } = await seed();
    await db.insertPatients([patient("P1", 0)]);
    await db.setStockRequirements("P1", [{ item_type: "medicine", item_id: "missing", quantity: 1 }]);
    const { output } = await executeRun(db, {});
    expect(output.completed).toBe(false);
    expect(output.error).toMatch(/not in the inventory/);
  });
});

describe("the roster drives capacity", () => {
  it("removes a unit for each doctor or nurse who is not available when a run starts", async () => {
    const { db } = await seed({ ...DEFAULT_RESOURCES, doctor: 2 });
    await db.insertPatients([patient("P1", 0, 20), patient("P2", 0, 20)]);
    const doctors = EXAMPLE_STAFF.filter((s) => s.role === "doctor").slice(0, 2);
    for (const d of doctors) await db.saveStaff(d);

    expect((await executeRun(db, {})).output.patients.map((p) => p.start_time)).toEqual([0, 0]);

    await db.saveStaff(changeAvailability(doctors[0], "on_leave", 0, "leave", NOW).staff);
    const { output } = await executeRun(db, {});
    expect(output.resources.doctor).toBe(1);
    expect(output.patients.map((p) => p.start_time).sort()).toEqual([0, 20]);
  });
});

describe("adding a patient to a run in progress", () => {
  it("re-runs from the same starting conditions: history is unchanged, the newcomer is treated", async () => {
    const { db } = await seed({ ...DEFAULT_RESOURCES, doctor: 1 });
    await db.insertPatients([patient("A", 0, 20), patient("B", 5, 20), patient("C", 10, 20)]);
    const first = await executeRun(db, {});

    await db.insertPatients([patient("LIVE", 30, 10)]);
    const second = await executeRun(db, first.output.params, undefined, { resources: first.output.resources });

    expect(second.output.completed).toBe(true);
    expect(second.output.metrics.total_patients).toBe(4);
    for (const p of first.output.patients) {
      if (p.start_time !== null && p.start_time < 30) {
        expect(second.output.patients.find((q) => q.id === p.id)?.start_time).toBe(p.start_time);
      }
    }
    const live = second.output.patients.find((p) => p.id === "LIVE")!;
    expect(live.start_time).toBeGreaterThanOrEqual(30);
    expect(live.status).toBe("treated");
    // saved to history like any other run
    expect((await db.listRuns()).length).toBe(2);
    expect((await db.listPatients()).filter((p) => p.patient_id === "LIVE")).toHaveLength(1);
  });

  it("carries a mid-run staffing change through the stored parameters", async () => {
    const { db } = await seed({ ...DEFAULT_RESOURCES, doctor: 2 });
    await db.insertPatients([patient("A", 0, 30), patient("B", 0, 30), patient("C", 5, 30)]);
    const first = await executeRun(db, {});
    const change = changeAvailability(EXAMPLE_STAFF[0], "unavailable", 10, "called away", NOW).availability!;
    const second = await executeRun(db, { ...first.output.params, availability: [change] }, undefined, { resources: first.output.resources });

    const reopened = outputFromStoredRun((await db.getRun(second.stored.run.id))!)!;
    expect(reopened.params.availability).toEqual([change]);
    expect(second.output.patients.find((p) => p.id === "A")?.end_time).toBe(30);
    expect(second.output.patients.find((p) => p.id === "C")?.start_time).toBe(30);
  });
});
