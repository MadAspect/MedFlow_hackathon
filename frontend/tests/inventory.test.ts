import { describe, expect, it } from "vitest";
import {
  EXAMPLE_EQUIPMENT,
  EXAMPLE_MEDICINES,
  InventoryError,
  consumeMedicine,
  createEquipment,
  createMedicine,
  equipmentLow,
  equipmentStatus,
  filterEquipment,
  filterMedicines,
  isExpired,
  markEquipmentMaintenance,
  markEquipmentOperational,
  medicineStatus,
  releaseEquipment,
  requirementsByPatient,
  reserveEquipment,
  restockMedicine,
  setEquipmentAvailability,
  stockWarnings,
  summarizeInventory,
  toStockConstraints,
  updateEquipment,
  updateMedicine,
} from "@/lib/inventory";

const NOW = "2026-05-01T10:00:00.000Z";
const LATER = "2026-05-01T11:00:00.000Z";

const medicine = (quantity: number, minimum = 10) =>
  createMedicine({ name: "IV sets", category: "Infusion", quantity, minimum_threshold: minimum, unit: "sets" }, "iv", NOW);

const equipment = (over: Partial<Parameters<typeof createEquipment>[0]> = {}) =>
  createEquipment({ name: "Ventilator", category: "Respiratory", quantity: 4, minimum_threshold: 1, ...over }, "vent", NOW);

describe("medicine status rules", () => {
  it("is out of stock at zero, low at or below the threshold, otherwise available", () => {
    expect(medicineStatus(medicine(0))).toBe("out_of_stock");
    expect(medicineStatus(medicine(1))).toBe("low");
    expect(medicineStatus(medicine(10))).toBe("low");
    expect(medicineStatus(medicine(11))).toBe("available");
  });

  it("a zero threshold is only low at zero, which is out of stock", () => {
    expect(medicineStatus(medicine(1, 0))).toBe("available");
    expect(medicineStatus(medicine(0, 0))).toBe("out_of_stock");
  });

  it("follows the data when it is edited", () => {
    const m = medicine(50);
    expect(medicineStatus(m)).toBe("available");
    expect(medicineStatus(updateMedicine(m, { quantity: 8 }, LATER))).toBe("low");
    expect(medicineStatus(updateMedicine(m, { minimum_threshold: 60 }, LATER))).toBe("low");
  });
});

describe("medicine operations", () => {
  it("adds, edits and stamps times", () => {
    const m = medicine(50);
    expect(m.created_at).toBe(NOW);
    const edited = updateMedicine(m, { quantity: 70, name: "  IV sets (large) " }, LATER);
    expect(edited).toMatchObject({ quantity: 70, name: "IV sets (large)", created_at: NOW, updated_at: LATER });
    expect(m.quantity).toBe(50); // the original is untouched
  });

  it("refuses negative, fractional and missing values", () => {
    expect(() => medicine(-1)).toThrow(InventoryError);
    expect(() => medicine(1.5)).toThrow(InventoryError);
    expect(() => createMedicine({ name: " ", category: "x", quantity: 1, minimum_threshold: 0, unit: "u" }, "a", NOW)).toThrow(/Name is required/);
    expect(() => updateMedicine(medicine(5), { quantity: -3 }, LATER)).toThrow(InventoryError);
  });

  it("never lets stock go negative when consumed", () => {
    const m = medicine(5);
    expect(consumeMedicine(m, 5, LATER).quantity).toBe(0);
    expect(() => consumeMedicine(m, 6, LATER)).toThrow(/Only 5 sets of IV sets left; 6 requested/);
    expect(restockMedicine(m, 10, LATER).quantity).toBe(15);
  });

  it("validates the expiry date and flags expired stock without changing the status rules", () => {
    expect(() => createMedicine({ name: "A", category: "c", quantity: 1, minimum_threshold: 0, unit: "u", expiry_date: "next week" }, "a", NOW)).toThrow(/Expiry date/);
    const old = createMedicine({ name: "A", category: "c", quantity: 20, minimum_threshold: 5, unit: "u", expiry_date: "2026-01-01" }, "a", NOW);
    expect(isExpired(old, new Date("2026-05-01"))).toBe(true);
    expect(isExpired({ expiry_date: null })).toBe(false);
    expect(medicineStatus(old)).toBe("available");
    expect(stockWarnings([old], [], new Date("2026-05-01")).map((w) => w.message)).toEqual(["A expired on 2026-01-01."]);
  });
});

describe("equipment status rules", () => {
  it("is unavailable with no free units or under maintenance, available otherwise", () => {
    expect(equipmentStatus(equipment())).toBe("available");
    expect(equipmentStatus(equipment({ available_quantity: 0 }))).toBe("unavailable");
    expect(equipmentStatus(equipment({ maintenance_status: "maintenance" }))).toBe("unavailable");
  });

  it("marks maintenance and back", () => {
    const e = equipment();
    const down = markEquipmentMaintenance(e, LATER);
    expect(equipmentStatus(down)).toBe("unavailable");
    expect(equipmentStatus(markEquipmentOperational(down, LATER))).toBe("available");
  });

  it("is low when the free units are at or below the threshold but it still works", () => {
    expect(equipmentLow(equipment({ available_quantity: 1 }))).toBe(true);
    expect(equipmentLow(equipment({ available_quantity: 2 }))).toBe(false);
    expect(equipmentLow(equipment({ available_quantity: 0 }))).toBe(false); // unavailable, not low
  });

  it("keeps available + in use within the units owned", () => {
    expect(() => equipment({ available_quantity: 3, in_use_quantity: 2 })).toThrow(/more than the 4 owned/);
    expect(() => setEquipmentAvailability(equipment({ in_use_quantity: 2, available_quantity: 2 }), 3, LATER)).toThrow(InventoryError);
    expect(setEquipmentAvailability(equipment(), 2, LATER).available_quantity).toBe(2);
    expect(updateEquipment(equipment(), { quantity: 6 }, LATER).quantity).toBe(6);
  });
});

describe("reserving and releasing equipment", () => {
  it("moves units between available and in use", () => {
    const held = reserveEquipment(equipment(), 3, LATER);
    expect(held).toMatchObject({ available_quantity: 1, in_use_quantity: 3, quantity: 4 });
    const back = releaseEquipment(held, 3, LATER);
    expect(back).toMatchObject({ available_quantity: 4, in_use_quantity: 0 });
  });

  it("refuses to over-reserve, over-release or use equipment in maintenance", () => {
    expect(() => reserveEquipment(equipment(), 5, LATER)).toThrow(/Only 4 Ventilator available/);
    expect(() => releaseEquipment(equipment(), 1, LATER)).toThrow(/only 0 in use/);
    expect(() => reserveEquipment(markEquipmentMaintenance(equipment(), LATER), 1, LATER)).toThrow(/under maintenance/);
  });
});

describe("summary, filtering and warnings", () => {
  const medicines = [medicine(100), createMedicine({ name: "Gloves", category: "Consumables", quantity: 5, minimum_threshold: 20, unit: "pairs" }, "gl", NOW), createMedicine({ name: "Saline", category: "Infusion", quantity: 0, minimum_threshold: 20, unit: "bags" }, "sa", NOW)];
  const kit = [
    equipment({ quantity: 4, in_use_quantity: 1, available_quantity: 3 }),
    createEquipment({ name: "Monitor", category: "Monitoring", quantity: 2, minimum_threshold: 0, maintenance_status: "maintenance" }, "mon", NOW),
  ];

  it("counts the totals the dashboard shows", () => {
    const s = summarizeInventory(medicines, kit);
    expect(s.medicineUnitsTotal).toBe(105);
    expect(s.equipmentUnitsTotal).toBe(6);
    expect(s.equipmentAvailableUnits).toBe(3); // the monitor's 2 units are in maintenance
    expect(s.availableStock).toBe(108);
    expect(s.lowStock).toBe(1); // gloves
    expect(s.outOfStock).toBe(2); // saline + the monitor
    expect(s.equipmentInUse).toBe(1);
    expect(s.equipmentUnderMaintenance).toBe(1);
  });

  it("searches and filters", () => {
    expect(filterMedicines(medicines, { query: "glo" }).map((m) => m.id)).toEqual(["gl"]);
    expect(filterMedicines(medicines, { category: "Infusion" }).map((m) => m.id)).toEqual(["iv", "sa"]);
    expect(filterMedicines(medicines, { status: "low" }).map((m) => m.id)).toEqual(["gl"]);
    expect(filterMedicines(medicines, { status: "out_of_stock", query: "sal" }).map((m) => m.id)).toEqual(["sa"]);
    expect(filterEquipment(kit, { status: "unavailable" }).map((e) => e.id)).toEqual(["mon"]);
    expect(filterEquipment(kit, { query: "vent" }).map((e) => e.id)).toEqual(["vent"]);
  });

  it("warns, critical first, with the numbers in the message", () => {
    const w = stockWarnings(medicines, kit);
    expect(w[0].level).toBe("critical");
    expect(w.map((x) => x.message)).toContain("Gloves is low: 5 pairs left (minimum 20).");
    expect(w.map((x) => x.message)).toContain("Saline is out of stock.");
    expect(w.map((x) => x.message)).toContain("Monitor is under maintenance.");
  });
});

describe("simulation bridge", () => {
  it("gives the engine operable units only", () => {
    const kit = [equipment({ available_quantity: 3, in_use_quantity: 1 }), createEquipment({ name: "Monitor", category: "M", quantity: 2, minimum_threshold: 0, maintenance_status: "maintenance" }, "mon", NOW)];
    expect(toStockConstraints([medicine(40)], kit)).toEqual({
      medicines: { iv: { name: "IV sets", quantity: 40 } },
      equipment: { vent: { name: "Ventilator", units: 3 }, mon: { name: "Monitor", units: 0 } },
    });
  });

  it("groups stored requirement rows by patient", () => {
    const map = requirementsByPatient([
      { id: "1", patient_id: "P1", item_type: "equipment", item_id: "vent", quantity_required: 1 },
      { id: "2", patient_id: "P1", item_type: "medicine", item_id: "iv", quantity_required: 4 },
      { id: "3", patient_id: "P2", item_type: "medicine", item_id: "iv", quantity_required: 2 },
    ]);
    expect(map.get("P1")).toEqual([
      { item_type: "equipment", item_id: "vent", quantity: 1 },
      { item_type: "medicine", item_id: "iv", quantity: 4 },
    ]);
    expect(map.get("P2")).toHaveLength(1);
  });

  it("ships example data that satisfies its own invariants", () => {
    expect(EXAMPLE_MEDICINES.every((m) => medicineStatus(m) === "available")).toBe(true);
    expect(EXAMPLE_EQUIPMENT.every((e) => e.available_quantity + e.in_use_quantity <= e.quantity)).toBe(true);
  });
});
