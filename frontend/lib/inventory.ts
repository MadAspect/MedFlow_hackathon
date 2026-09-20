import type { StockConstraints, StockRequirement } from "./simulation/types";

/**
 * Medicine and equipment stock.
 *
 * Everything here is pure and immutable: functions return new rows and throw InventoryError when
 * an operation would break an invariant (negative stock, more units in use than exist). Statuses
 * are always derived from the numbers, never stored, so they cannot drift from the data.
 */

export class InventoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InventoryError";
  }
}

export type MedicineStatus = "available" | "low" | "out_of_stock";
export type EquipmentStatus = "available" | "unavailable";
export type MaintenanceStatus = "operational" | "maintenance";

export interface Medicine {
  id: string;
  name: string;
  category: string;
  quantity: number;
  minimum_threshold: number;
  unit: string;
  /** ISO date (YYYY-MM-DD) or null. Shown as a warning once past; it does not change the status rules. */
  expiry_date: string | null;
  created_at: string;
  updated_at: string;
}

export interface Equipment {
  id: string;
  name: string;
  category: string;
  /** Total units owned. */
  quantity: number;
  /** Units that can be picked up right now. */
  available_quantity: number;
  /** Units held by a treatment right now. */
  in_use_quantity: number;
  maintenance_status: MaintenanceStatus;
  minimum_threshold: number;
  created_at: string;
  updated_at: string;
}

export interface MedicineInput {
  name: string;
  category: string;
  quantity: number;
  minimum_threshold: number;
  unit: string;
  expiry_date?: string | null;
}

export interface EquipmentInput {
  name: string;
  category: string;
  quantity: number;
  available_quantity?: number;
  in_use_quantity?: number;
  maintenance_status?: MaintenanceStatus;
  minimum_threshold: number;
}

const isWhole = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0;

function requireWhole(n: unknown, what: string): number {
  if (!isWhole(n)) throw new InventoryError(`${what} must be a whole number of 0 or more.`);
  return n;
}

function requireText(s: unknown, what: string): string {
  if (typeof s !== "string" || s.trim() === "") throw new InventoryError(`${what} is required.`);
  return s.trim();
}

function requireDate(s: string | null | undefined): string | null {
  if (s === undefined || s === null || s === "") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) {
    throw new InventoryError("Expiry date must look like 2027-01-31.");
  }
  return s;
}

// ---- status rules (deterministic) ---------------------------------------------------------

export function medicineStatus(m: Pick<Medicine, "quantity" | "minimum_threshold">): MedicineStatus {
  if (m.quantity <= 0) return "out_of_stock";
  if (m.quantity <= m.minimum_threshold) return "low";
  return "available";
}

export function equipmentStatus(
  e: Pick<Equipment, "available_quantity" | "maintenance_status">,
): EquipmentStatus {
  return e.available_quantity <= 0 || e.maintenance_status === "maintenance" ? "unavailable" : "available";
}

/** Equipment is running short when the free units are at or below its threshold (but it still works). */
export function equipmentLow(
  e: Pick<Equipment, "available_quantity" | "maintenance_status" | "minimum_threshold">,
): boolean {
  return equipmentStatus(e) === "available" && e.available_quantity <= e.minimum_threshold;
}

export function isExpired(m: Pick<Medicine, "expiry_date">, today: Date = new Date()): boolean {
  if (!m.expiry_date) return false;
  return m.expiry_date < today.toISOString().slice(0, 10);
}

export const MEDICINE_STATUS_LABEL: Record<MedicineStatus, string> = {
  available: "In stock",
  low: "Low stock",
  out_of_stock: "Out of stock",
};

export const EQUIPMENT_STATUS_LABEL: Record<EquipmentStatus, string> = {
  available: "Available",
  unavailable: "Unavailable",
};

// ---- medicines ----------------------------------------------------------------------------

export function createMedicine(input: MedicineInput, id: string, now: string): Medicine {
  return {
    id,
    name: requireText(input.name, "Name"),
    category: requireText(input.category, "Category"),
    quantity: requireWhole(input.quantity, "Quantity"),
    minimum_threshold: requireWhole(input.minimum_threshold, "Minimum threshold"),
    unit: requireText(input.unit, "Unit"),
    expiry_date: requireDate(input.expiry_date),
    created_at: now,
    updated_at: now,
  };
}

export function updateMedicine(m: Medicine, patch: Partial<MedicineInput>, now: string): Medicine {
  return {
    ...createMedicine(
      {
        name: patch.name ?? m.name,
        category: patch.category ?? m.category,
        quantity: patch.quantity ?? m.quantity,
        minimum_threshold: patch.minimum_threshold ?? m.minimum_threshold,
        unit: patch.unit ?? m.unit,
        expiry_date: patch.expiry_date === undefined ? m.expiry_date : patch.expiry_date,
      },
      m.id,
      m.created_at,
    ),
    updated_at: now,
  };
}

/** Takes stock out (a treatment using it). Refuses to go below zero. */
export function consumeMedicine(m: Medicine, amount: number, now: string): Medicine {
  requireWhole(amount, "Amount");
  if (amount > m.quantity) {
    throw new InventoryError(`Only ${m.quantity} ${m.unit} of ${m.name} left; ${amount} requested.`);
  }
  return { ...m, quantity: m.quantity - amount, updated_at: now };
}

export function restockMedicine(m: Medicine, amount: number, now: string): Medicine {
  requireWhole(amount, "Amount");
  return { ...m, quantity: m.quantity + amount, updated_at: now };
}

// ---- equipment ----------------------------------------------------------------------------

function checkEquipmentCounts(e: Pick<Equipment, "quantity" | "available_quantity" | "in_use_quantity" | "name">): void {
  if (e.available_quantity + e.in_use_quantity > e.quantity) {
    throw new InventoryError(
      `${e.name}: ${e.available_quantity} available + ${e.in_use_quantity} in use is more than the ${e.quantity} owned.`,
    );
  }
}

export function createEquipment(input: EquipmentInput, id: string, now: string): Equipment {
  const quantity = requireWhole(input.quantity, "Quantity");
  const in_use = requireWhole(input.in_use_quantity ?? 0, "Units in use");
  const equipment: Equipment = {
    id,
    name: requireText(input.name, "Name"),
    category: requireText(input.category, "Category"),
    quantity,
    available_quantity: requireWhole(input.available_quantity ?? quantity - in_use, "Available units"),
    in_use_quantity: in_use,
    maintenance_status: input.maintenance_status === "maintenance" ? "maintenance" : "operational",
    minimum_threshold: requireWhole(input.minimum_threshold, "Minimum threshold"),
    created_at: now,
    updated_at: now,
  };
  checkEquipmentCounts(equipment);
  return equipment;
}

export function updateEquipment(e: Equipment, patch: Partial<EquipmentInput>, now: string): Equipment {
  return {
    ...createEquipment(
      {
        name: patch.name ?? e.name,
        category: patch.category ?? e.category,
        quantity: patch.quantity ?? e.quantity,
        available_quantity: patch.available_quantity ?? e.available_quantity,
        in_use_quantity: patch.in_use_quantity ?? e.in_use_quantity,
        maintenance_status: patch.maintenance_status ?? e.maintenance_status,
        minimum_threshold: patch.minimum_threshold ?? e.minimum_threshold,
      },
      e.id,
      e.created_at,
    ),
    updated_at: now,
  };
}

export function setEquipmentAvailability(e: Equipment, available: number, now: string): Equipment {
  return updateEquipment(e, { available_quantity: available }, now);
}

export function markEquipmentMaintenance(e: Equipment, now: string): Equipment {
  return { ...e, maintenance_status: "maintenance", updated_at: now };
}

export function markEquipmentOperational(e: Equipment, now: string): Equipment {
  return { ...e, maintenance_status: "operational", updated_at: now };
}

/** A treatment picks units up. Refuses when they are not free or the equipment is in maintenance. */
export function reserveEquipment(e: Equipment, units: number, now: string): Equipment {
  requireWhole(units, "Units");
  if (e.maintenance_status === "maintenance") throw new InventoryError(`${e.name} is under maintenance.`);
  if (units > e.available_quantity) {
    throw new InventoryError(`Only ${e.available_quantity} ${e.name} available; ${units} requested.`);
  }
  return {
    ...e,
    available_quantity: e.available_quantity - units,
    in_use_quantity: e.in_use_quantity + units,
    updated_at: now,
  };
}

/** A treatment ends and hands its units back. */
export function releaseEquipment(e: Equipment, units: number, now: string): Equipment {
  requireWhole(units, "Units");
  if (units > e.in_use_quantity) {
    throw new InventoryError(`${e.name}: cannot release ${units}, only ${e.in_use_quantity} in use.`);
  }
  return {
    ...e,
    available_quantity: e.available_quantity + units,
    in_use_quantity: e.in_use_quantity - units,
    updated_at: now,
  };
}

// ---- overview, filtering, warnings ----------------------------------------------------------

export interface InventorySummary {
  medicineUnitsTotal: number;
  medicineItems: number;
  equipmentUnitsTotal: number;
  equipmentAvailableUnits: number;
  /** Medicines in stock plus equipment units that can be used right now. */
  availableStock: number;
  lowStock: number;
  outOfStock: number;
  equipmentInUse: number;
  equipmentUnderMaintenance: number;
  equipmentUnavailable: number;
}

export function summarizeInventory(medicines: Medicine[], equipment: Equipment[]): InventorySummary {
  const operable = equipment.filter((e) => e.maintenance_status !== "maintenance");
  const medicineUnitsTotal = medicines.reduce((s, m) => s + m.quantity, 0);
  const equipmentAvailableUnits = operable.reduce((s, e) => s + e.available_quantity, 0);
  return {
    medicineUnitsTotal,
    medicineItems: medicines.length,
    equipmentUnitsTotal: equipment.reduce((s, e) => s + e.quantity, 0),
    equipmentAvailableUnits,
    availableStock: medicineUnitsTotal + equipmentAvailableUnits,
    lowStock: medicines.filter((m) => medicineStatus(m) === "low").length + equipment.filter(equipmentLow).length,
    outOfStock:
      medicines.filter((m) => medicineStatus(m) === "out_of_stock").length +
      equipment.filter((e) => equipmentStatus(e) === "unavailable").length,
    equipmentInUse: equipment.reduce((s, e) => s + e.in_use_quantity, 0),
    equipmentUnderMaintenance: equipment.filter((e) => e.maintenance_status === "maintenance").length,
    equipmentUnavailable: equipment.filter((e) => equipmentStatus(e) === "unavailable").length,
  };
}

export interface StockFilter {
  query?: string;
  category?: string;
  status?: string;
}

const matches = (haystack: string[], query: string | undefined) => {
  const q = (query ?? "").trim().toLowerCase();
  return q === "" || haystack.some((h) => h.toLowerCase().includes(q));
};

export function filterMedicines(list: Medicine[], f: StockFilter): Medicine[] {
  return list.filter(
    (m) =>
      matches([m.name, m.category], f.query) &&
      (!f.category || m.category === f.category) &&
      (!f.status || medicineStatus(m) === f.status),
  );
}

export function filterEquipment(list: Equipment[], f: StockFilter): Equipment[] {
  return list.filter(
    (e) =>
      matches([e.name, e.category], f.query) &&
      (!f.category || e.category === f.category) &&
      (!f.status || equipmentStatus(e) === f.status || (f.status === "low" && equipmentLow(e))),
  );
}

export interface StockWarning {
  level: "warning" | "critical";
  item: string;
  message: string;
}

export function stockWarnings(medicines: Medicine[], equipment: Equipment[], today: Date = new Date()): StockWarning[] {
  const out: StockWarning[] = [];
  for (const m of medicines) {
    const status = medicineStatus(m);
    if (status === "out_of_stock") out.push({ level: "critical", item: m.name, message: `${m.name} is out of stock.` });
    else if (status === "low") {
      out.push({ level: "warning", item: m.name, message: `${m.name} is low: ${m.quantity} ${m.unit} left (minimum ${m.minimum_threshold}).` });
    }
    if (isExpired(m, today)) out.push({ level: "warning", item: m.name, message: `${m.name} expired on ${m.expiry_date}.` });
  }
  for (const e of equipment) {
    if (e.maintenance_status === "maintenance") {
      out.push({ level: "warning", item: e.name, message: `${e.name} is under maintenance.` });
    } else if (equipmentStatus(e) === "unavailable") {
      out.push({ level: "critical", item: e.name, message: `${e.name} has no units available.` });
    } else if (equipmentLow(e)) {
      out.push({ level: "warning", item: e.name, message: `${e.name} is running short: ${e.available_quantity} available (minimum ${e.minimum_threshold}).` });
    }
  }
  return out.sort((a, b) => (a.level === b.level ? 0 : a.level === "critical" ? -1 : 1));
}

// ---- simulation bridge --------------------------------------------------------------------------

/** Snapshot the engine works on. Equipment under maintenance contributes no units. */
export function toStockConstraints(medicines: Medicine[], equipment: Equipment[]): StockConstraints {
  return {
    medicines: Object.fromEntries(medicines.map((m) => [m.id, { name: m.name, quantity: m.quantity }])),
    equipment: Object.fromEntries(
      equipment.map((e) => [
        e.id,
        { name: e.name, units: e.maintenance_status === "maintenance" ? 0 : e.available_quantity },
      ]),
    ),
  };
}

export interface PatientStockRequirementRow {
  id: string;
  patient_id: string;
  item_type: StockRequirement["item_type"];
  item_id: string;
  quantity_required: number;
}

/** Turn stored requirement rows into the per-patient lists the engine reads. */
export function requirementsByPatient(rows: PatientStockRequirementRow[]): Map<string, StockRequirement[]> {
  const byPatient = new Map<string, StockRequirement[]>();
  for (const r of rows) {
    const list = byPatient.get(r.patient_id) ?? [];
    list.push({ item_type: r.item_type, item_id: r.item_id, quantity: r.quantity_required });
    byPatient.set(r.patient_id, list);
  }
  return byPatient;
}

/**
 * Stock constraints are opt-in so the existing simulation is unchanged until they are switched on.
 * Set NEXT_PUBLIC_ENABLE_STOCK_CONSTRAINTS=true (the NEXT_PUBLIC_ prefix is what lets the browser see it).
 */
export function stockConstraintsEnabled(): boolean {
  return process.env.NEXT_PUBLIC_ENABLE_STOCK_CONSTRAINTS === "true";
}

// ---- example data (from the friend prototype's default hospital) ---------------------------------

const EXAMPLE_TIME = "2026-01-01T00:00:00.000Z";

export const EXAMPLE_MEDICINES: Medicine[] = [
  ["iv_sets", "IV sets", "Infusion", 300, 110, "sets"],
  ["oxygen_masks", "Oxygen masks", "Respiratory", 140, 45, "masks"],
  ["syringes", "Syringes", "Consumables", 900, 260, "pcs"],
  ["gloves", "Gloves", "Consumables", 3200, 1000, "pairs"],
  ["saline_bags", "Saline bags", "Infusion", 260, 70, "bags"],
  ["ecg_electrodes", "ECG electrodes", "Cardiac", 400, 110, "pcs"],
].map(([id, name, category, quantity, minimum_threshold, unit]) => ({
  id: id as string,
  name: name as string,
  category: category as string,
  quantity: quantity as number,
  minimum_threshold: minimum_threshold as number,
  unit: unit as string,
  expiry_date: null,
  created_at: EXAMPLE_TIME,
  updated_at: EXAMPLE_TIME,
}));

export const EXAMPLE_EQUIPMENT: Equipment[] = [
  ["ventilator", "Ventilator", "Respiratory", 5, 1],
  ["cardiac_monitor", "Cardiac monitor", "Monitoring", 10, 2],
  ["defibrillator", "Defibrillator", "Cardiac", 3, 1],
].map(([id, name, category, quantity, minimum_threshold]) => ({
  id: id as string,
  name: name as string,
  category: category as string,
  quantity: quantity as number,
  available_quantity: quantity as number,
  in_use_quantity: 0,
  maintenance_status: "operational" as const,
  minimum_threshold: minimum_threshold as number,
  created_at: EXAMPLE_TIME,
  updated_at: EXAMPLE_TIME,
}));
