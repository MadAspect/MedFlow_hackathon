import type { Condition } from "./constants";
import type { StockRequirementInput } from "./database";
import type { Equipment, Medicine } from "./inventory";

/**
 * Standard treatment protocols: what a patient with a given condition normally needs from stock.
 *
 * A patient's requests start from this list, so they are never blank by accident, and they are
 * still an ordinary editable list: the picker can add, remove or change any line. The list is
 * deterministic (same condition, urgency and inventory always give the same answer) and is only a
 * starting point for a synthetic simulation, not clinical guidance.
 */

export interface ProtocolItem {
  type: StockRequirementInput["item_type"];
  /** Inventory id the example stock uses; also matched against item names ("iv_sets" ~ "IV sets"). */
  item: string;
  quantity: number;
  /** Only requested from this urgency up (e.g. a ventilator is for critical cases). */
  minUrgency?: number;
}

const med = (item: string, quantity: number, minUrgency?: number): ProtocolItem => ({ type: "medicine", item, quantity, minUrgency });
const eq = (item: string, quantity: number, minUrgency?: number): ProtocolItem => ({ type: "equipment", item, quantity, minUrgency });

export const TREATMENT_PROTOCOLS: Record<Condition, ProtocolItem[]> = {
  "Cardiac event": [eq("cardiac_monitor", 1), eq("defibrillator", 1, 4), med("ecg_electrodes", 5), med("iv_sets", 1), med("gloves", 2)],
  Stroke: [eq("cardiac_monitor", 1), med("iv_sets", 1), med("saline_bags", 1), med("oxygen_masks", 1, 4), med("gloves", 2)],
  "Multi-trauma": [eq("ventilator", 1, 4), eq("cardiac_monitor", 1), med("iv_sets", 2), med("saline_bags", 2), med("syringes", 2), med("gloves", 4)],
  "Respiratory failure": [eq("ventilator", 1), eq("cardiac_monitor", 1, 4), med("oxygen_masks", 1), med("syringes", 1), med("gloves", 2)],
  Sepsis: [eq("cardiac_monitor", 1, 4), med("iv_sets", 2), med("saline_bags", 2), med("syringes", 2), med("gloves", 2)],
  Fracture: [med("syringes", 1), med("gloves", 2)],
  "Abdominal emergency": [eq("cardiac_monitor", 1, 4), med("iv_sets", 1), med("saline_bags", 1), med("syringes", 2), med("gloves", 3)],
  "Head injury": [eq("cardiac_monitor", 1), med("iv_sets", 1), med("oxygen_masks", 1), med("gloves", 2)],
  "Severe burns": [med("iv_sets", 2), med("saline_bags", 3), med("oxygen_masks", 1), med("syringes", 2), med("gloves", 4)],
  Laceration: [med("syringes", 1), med("gloves", 2)],
  "Minor illness": [med("gloves", 1)],
  "Routine check": [med("gloves", 1)],
};

/** The protocol for a condition at this urgency. Conditions without a protocol (e.g. surge cases) get none. */
export function protocolFor(condition: string, urgency: number): ProtocolItem[] {
  const list = (TREATMENT_PROTOCOLS as Record<string, ProtocolItem[] | undefined>)[condition] ?? [];
  return list.filter((i) => urgency >= (i.minUrgency ?? 1));
}

const normalise = (s: string) => s.toLowerCase().replace(/[_\s-]+/g, " ").trim();

function find<T extends { id: string; name: string }>(list: T[], item: string): T | undefined {
  return list.find((x) => x.id === item) ?? list.find((x) => normalise(x.name) === normalise(item));
}

export interface StockSuggestion {
  requirements: StockRequirementInput[];
  /** Protocol items this hospital does not stock, so they could not be requested. */
  missing: string[];
}

/** Resolve a condition's protocol against the actual inventory. Items the hospital does not have are skipped. */
export function suggestStock(
  condition: string,
  urgency: number,
  medicines: Pick<Medicine, "id" | "name">[],
  equipment: Pick<Equipment, "id" | "name">[],
): StockSuggestion {
  const requirements: StockRequirementInput[] = [];
  const missing: string[] = [];
  for (const line of protocolFor(condition, urgency)) {
    const found = find(line.type === "medicine" ? medicines : equipment, line.item);
    if (found) requirements.push({ item_type: line.type, item_id: found.id, quantity: line.quantity });
    else missing.push(normalise(line.item));
  }
  return { requirements, missing };
}
