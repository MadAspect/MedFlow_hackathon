import { describe, expect, it } from "vitest";
import { CONDITIONS } from "@/lib/constants";
import { EXAMPLE_EQUIPMENT, EXAMPLE_MEDICINES } from "@/lib/inventory";
import { runSimulation } from "@/lib/simulation";
import { TREATMENT_PROTOCOLS, protocolFor, suggestStock } from "@/lib/treatments";

const ids = (r: { item_type: string; item_id: string }[]) => r.map((x) => `${x.item_type}:${x.item_id}`);

describe("treatment protocols", () => {
  it("has a protocol for every condition a patient can be given", () => {
    for (const c of CONDITIONS) expect(TREATMENT_PROTOCOLS[c].length).toBeGreaterThan(0);
  });

  it("only refers to items that exist in the example inventory", () => {
    const medicines = new Set(EXAMPLE_MEDICINES.map((m) => m.id));
    const equipment = new Set(EXAMPLE_EQUIPMENT.map((e) => e.id));
    for (const c of CONDITIONS) {
      for (const line of TREATMENT_PROTOCOLS[c]) {
        expect((line.type === "medicine" ? medicines : equipment).has(line.item)).toBe(true);
        expect(Number.isInteger(line.quantity) && line.quantity > 0).toBe(true);
      }
    }
  });

  it("asks for a ventilator only for critical multi-trauma", () => {
    expect(ids(suggestStock("Multi-trauma", 3, EXAMPLE_MEDICINES, EXAMPLE_EQUIPMENT).requirements)).not.toContain("equipment:ventilator");
    expect(ids(suggestStock("Multi-trauma", 4, EXAMPLE_MEDICINES, EXAMPLE_EQUIPMENT).requirements)).toContain("equipment:ventilator");
  });

  it("is deterministic and gives nothing for a condition without a protocol", () => {
    const a = suggestStock("Cardiac event", 5, EXAMPLE_MEDICINES, EXAMPLE_EQUIPMENT);
    expect(suggestStock("Cardiac event", 5, EXAMPLE_MEDICINES, EXAMPLE_EQUIPMENT)).toEqual(a);
    expect(protocolFor("Cardiac event (surge)", 5)).toEqual([]);
  });

  it("skips items the hospital does not stock and reports them", () => {
    const noVentilator = EXAMPLE_EQUIPMENT.filter((e) => e.id !== "ventilator");
    const { requirements, missing } = suggestStock("Respiratory failure", 5, EXAMPLE_MEDICINES, noVentilator);
    expect(ids(requirements)).not.toContain("equipment:ventilator");
    expect(missing).toContain("ventilator");
  });

  it("matches items by name when the ids are custom", () => {
    const custom = [{ id: "uuid-1", name: "IV Sets" }, { id: "uuid-2", name: "Gloves" }];
    const { requirements } = suggestStock("Laceration", 2, custom, []);
    expect(requirements).toEqual([{ item_type: "medicine", item_id: "uuid-2", quantity: 2 }]);
  });

  it("changes the schedule once the simulation enforces the requests", () => {
    const patient = (id: string) => ({
      id,
      condition: "Respiratory failure",
      arrival_time: 0,
      urgency: 5,
      treatment_time: 10,
      required_resources: { doctor: 1 },
      stock_requirements: suggestStock("Respiratory failure", 5, EXAMPLE_MEDICINES, EXAMPLE_EQUIPMENT).requirements,
    });
    const resources = { doctor: 2, nurse: 0, bed: 0, icu_bed: 0, operating_room: 0 };
    const stock = {
      medicines: Object.fromEntries(EXAMPLE_MEDICINES.map((m) => [m.id, { name: m.name, quantity: m.quantity }])),
      equipment: { ventilator: { name: "Ventilator", units: 1 }, cardiac_monitor: { name: "Cardiac monitor", units: 10 } },
    };
    const free = runSimulation([patient("A"), patient("B")], resources, { strategy: "fcfs" });
    const limited = runSimulation([patient("A"), patient("B")], resources, { strategy: "fcfs", stock });
    expect(free.patients.map((p) => p.start_time)).toEqual([0, 0]);
    expect(limited.patients.map((p) => p.start_time)).toEqual([0, 10]); // one ventilator, so the second patient waits
  });
});
