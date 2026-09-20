import { describe, expect, it } from "vitest";
import {
  SimulationInputError,
  emptyResourceSet,
  runSimulation,
  type ResourceRequest,
  type ResourceSet,
  type SimPatient,
  type StockConstraints,
  type StockRequirement,
} from "@/lib/simulation";

const P = (
  id: string,
  arrival: number,
  urgency: number,
  treatment: number,
  required: ResourceRequest = { doctor: 1 },
  stock: StockRequirement[] = [],
): SimPatient => ({
  id,
  condition: "Test",
  arrival_time: arrival,
  urgency,
  treatment_time: treatment,
  required_resources: required,
  ...(stock.length > 0 ? { stock_requirements: stock } : {}),
});

const R = (over: Partial<ResourceSet> = {}): ResourceSet => ({ ...emptyResourceSet(), doctor: 5, ...over });

const equip = (item_id: string, quantity = 1): StockRequirement => ({ item_type: "equipment", item_id, quantity });
const med = (item_id: string, quantity: number): StockRequirement => ({ item_type: "medicine", item_id, quantity });

const STOCK: StockConstraints = {
  medicines: { iv: { name: "IV sets", quantity: 100 } },
  equipment: { vent: { name: "Ventilator", units: 1 } },
};

const byId = (out: ReturnType<typeof runSimulation>, id: string) => out.patients.find((p) => p.id === id)!;

describe("stock constraints are opt-in", () => {
  it("ignores stock requirements entirely when no inventory is supplied", () => {
    const patients = [P("A", 0, 3, 10, { doctor: 1 }, [equip("vent")]), P("B", 0, 3, 10, { doctor: 1 }, [equip("vent")])];
    const plain = runSimulation(patients.map((p) => ({ ...p, stock_requirements: undefined })), R());
    const flagged = runSimulation(patients, R());
    expect(flagged.patients.map((p) => p.start_time)).toEqual(plain.patients.map((p) => p.start_time));
    expect(flagged.stock).toBeUndefined();
  });
});

describe("equipment", () => {
  const patients = [
    P("A", 0, 3, 10, { doctor: 1 }, [equip("vent")]),
    P("B", 0, 3, 10, { doctor: 1 }, [equip("vent")]),
    P("C", 0, 3, 10, { doctor: 1 }, [equip("vent")]),
  ];
  const out = runSimulation(patients, R(), { stock: STOCK });

  it("serialises patients on a single unit even though doctors are free", () => {
    expect(out.completed).toBe(true);
    expect(out.patients.map((p) => p.start_time).sort((a, b) => a! - b!)).toEqual([0, 10, 20]);
    expect(out.stock!.equipment[0].peak_in_use).toBe(1);
  });

  it("hands the unit back at the exact minute the treatment ends", () => {
    const first = out.patients.find((p) => p.start_time === 0)!;
    const second = out.patients.find((p) => p.start_time === 10)!;
    expect(first.end_time).toBe(10);
    expect(second.start_time).toBe(first.end_time);
  });

  it("records what held a patient back, in minutes", () => {
    const last = out.patients.find((p) => p.start_time === 20)!;
    expect(last.decision!.stock_blocked).toEqual([
      { item_type: "equipment", item_id: "vent", name: "Ventilator", minutes: 20 },
    ]);
    expect(out.stock!.equipment[0].blocked_patients).toBe(2);
    expect(out.warnings.some((w) => w.code === "stock_blocked")).toBe(true);
  });

  it("does not let a stock-blocked patient stop others from starting", () => {
    const mixed = runSimulation(
      [P("Vent", 0, 5, 10, { doctor: 1 }, [equip("vent")]), P("Vent2", 0, 4, 10, { doctor: 1 }, [equip("vent")]), P("Plain", 0, 1, 10)],
      R(),
      { stock: STOCK },
    );
    expect(byId(mixed, "Plain").start_time).toBe(0);
    expect(byId(mixed, "Vent2").start_time).toBe(10);
  });

  it("treats equipment under maintenance (0 operable units) as an impossible requirement", () => {
    const broken = runSimulation([P("A", 0, 3, 10, { doctor: 1 }, [equip("vent")]), P("B", 0, 3, 10)], R(), {
      stock: { ...STOCK, equipment: { vent: { name: "Ventilator", units: 0 } } },
    });
    expect(broken.completed).toBe(false);
    expect(broken.error).toMatch(/A needs 1 Ventilator but only 0 operable unit\(s\) exist/);
    expect(byId(broken, "B").status).toBe("treated");
    expect(byId(broken, "A").status).not.toBe("treated");
  });
});

describe("medicines", () => {
  it("consumes stock when a treatment starts and never lets it go negative", () => {
    const out = runSimulation(
      [P("A", 0, 3, 10, { doctor: 1 }, [med("iv", 40)]), P("B", 0, 3, 10, { doctor: 1 }, [med("iv", 40)]), P("C", 0, 3, 10, { doctor: 1 }, [med("iv", 40)])],
      R(),
      { stock: STOCK },
    );
    const iv = out.stock!.medicines[0];
    expect(iv.consumed).toBe(80);
    expect(iv.remaining).toBe(20);
    expect(iv.remaining).toBeGreaterThanOrEqual(0);
    expect(out.patients.filter((p) => p.status === "treated")).toHaveLength(2);
  });

  it("stops with an explicit error instead of looping or claiming everyone was treated", () => {
    const out = runSimulation(
      [P("A", 0, 3, 10, { doctor: 1 }, [med("iv", 60)]), P("B", 0, 3, 10, { doctor: 1 }, [med("iv", 60)])],
      R(),
      { stock: STOCK },
    );
    expect(out.completed).toBe(false);
    expect(out.error).toMatch(/needs 60 IV sets but only 40 remain \(stock is not replenished during a run\)/);
    expect(out.metrics.patients_remaining).toBe(1);
  });

  it("reports an item that is not in the inventory at all", () => {
    const out = runSimulation([P("A", 0, 3, 10, { doctor: 1 }, [med("ghost", 1)]), P("B", 0, 3, 10)], R(), { stock: STOCK });
    expect(out.completed).toBe(false);
    expect(out.error).toMatch(/A needs 1 ghost but that medicine is not in the inventory/);
    expect(byId(out, "B").status).toBe("treated");
  });

  it("rejects malformed requirements up front", () => {
    expect(() => runSimulation([P("A", 0, 3, 10, { doctor: 1 }, [med("iv", 0)])], R(), { stock: STOCK })).toThrow(SimulationInputError);
    expect(() => runSimulation([P("A", 0, 3, 10, { doctor: 1 }, [{ item_type: "food" as never, item_id: "x", quantity: 1 }])], R(), { stock: STOCK })).toThrow(SimulationInputError);
  });
});

describe("atomic allocation", () => {
  it("takes nothing when any one requirement is short", () => {
    const out = runSimulation(
      [P("Urgent", 0, 5, 10, { doctor: 1, bed: 1 }, [med("ghost", 1)]), P("Other", 0, 1, 10, { doctor: 1, bed: 1 })],
      R({ doctor: 1, bed: 1 }),
      { stock: STOCK },
    );
    // Urgent fits every resource but not the stock, so it must not hold the doctor or the bed.
    expect(byId(out, "Other").start_time).toBe(0);
    expect(byId(out, "Other").decision!.available_before.doctor).toBe(1);
    expect(byId(out, "Urgent").decision).toBeNull();
  });

  it("never gives two patients the same equipment unit at the same time", () => {
    const many = Array.from({ length: 6 }, (_, i) => P(`P${i}`, i, 3, 7, { doctor: 1 }, [equip("vent")]));
    const out = runSimulation(many, R(), { stock: STOCK });
    const intervals = out.patients.map((p) => [p.start_time!, p.end_time!]).sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < intervals.length; i++) expect(intervals[i][0]).toBeGreaterThanOrEqual(intervals[i - 1][1]);
    expect(out.completed).toBe(true);
  });

  it("is deterministic", () => {
    const patients = [P("A", 0, 4, 12, { doctor: 1 }, [equip("vent"), med("iv", 10)]), P("B", 3, 2, 9, { doctor: 1 }, [equip("vent")]), P("C", 5, 5, 6)];
    const a = runSimulation(patients, R(), { stock: STOCK });
    const b = runSimulation(patients, R(), { stock: STOCK });
    expect(a).toEqual(b);
  });
});

describe("staff availability", () => {
  it("a change never touches a treatment that is already running", () => {
    const out = runSimulation(
      [P("A", 0, 3, 30), P("B", 0, 3, 30), P("C", 5, 3, 30)],
      R({ doctor: 2 }),
      { availability: [{ time: 10, resource: "doctor", delta: -1 }] },
    );
    expect(byId(out, "A").end_time).toBe(30);
    expect(byId(out, "B").end_time).toBe(30);
    // Only one doctor is left afterwards, so C is next, and nobody else is running with it.
    expect(byId(out, "C").start_time).toBe(30);
    expect(out.completed).toBe(true);
  });

  it("history before the change is identical with or without it", () => {
    const patients = [P("A", 0, 3, 20), P("B", 2, 4, 20), P("C", 4, 2, 20), P("D", 6, 5, 20), P("E", 30, 3, 20), P("F", 45, 3, 20)];
    const base = runSimulation(patients, R({ doctor: 2 }));
    const changed = runSimulation(patients, R({ doctor: 2 }), { availability: [{ time: 40, resource: "doctor", delta: -1 }] });
    for (const p of base.patients) {
      if (p.start_time !== null && p.start_time < 40) expect(byId(changed, p.id).start_time).toBe(p.start_time);
    }
  });

  it("removing a doctor delays later patients and adding one back resumes them", () => {
    const patients = [P("A", 0, 3, 20), P("B", 0, 3, 20), P("C", 50, 3, 20), P("D", 50, 3, 20)];
    const full = runSimulation(patients, R({ doctor: 2 }));
    const short = runSimulation(patients, R({ doctor: 2 }), { availability: [{ time: 30, resource: "doctor", delta: -1 }] });
    const back = runSimulation(patients, R({ doctor: 2 }), {
      availability: [{ time: 30, resource: "doctor", delta: -1 }, { time: 60, resource: "doctor", delta: 1 }],
    });
    expect(full.metrics.actual_completion_time).toBe(70);
    expect(short.metrics.actual_completion_time).toBe(90);
    expect(byId(back, "D").start_time).toBe(60);
    expect(back.completed).toBe(true);
  });

  it("waits for a later return instead of declaring the run stuck", () => {
    const out = runSimulation([P("A", 0, 3, 10)], R({ doctor: 0 }), { availability: [{ time: 20, resource: "doctor", delta: 1 }] });
    expect(out.completed).toBe(true);
    expect(byId(out, "A").start_time).toBe(20);
  });

  it("explains when staffing leaves a patient with no doctor, and does not loop", () => {
    const out = runSimulation([P("A", 0, 3, 10)], R({ doctor: 1 }), { availability: [{ time: 0, resource: "doctor", delta: -1 }] });
    expect(out.completed).toBe(false);
    expect(out.error).toMatch(/A needs 1 doctors but only 0 are available after staff changes/);
  });

  it("never lets capacity go below zero", () => {
    const out = runSimulation([P("A", 0, 3, 10, { bed: 1 })], R({ doctor: 1, bed: 1 }), {
      availability: [{ time: 0, resource: "doctor", delta: -3 }],
    });
    expect(out.timeline.every((p) => p.capacity.doctor >= 0)).toBe(true);
  });

  it("rejects a malformed change", () => {
    expect(() => runSimulation([P("A", 0, 3, 10)], R(), { availability: [{ time: -1, resource: "doctor", delta: 1 }] })).toThrow(SimulationInputError);
  });
});

describe("patients added while a run is in progress", () => {
  const base = [P("A", 0, 3, 20), P("B", 5, 4, 20), P("C", 10, 2, 20), P("D", 15, 5, 20)];
  const resources = R({ doctor: 1 });
  const before = runSimulation(base, resources);
  const live = P("LIVE", 25, 4, 15);
  const after = runSimulation([...base, live], resources);

  it("cannot be treated before it arrives", () => {
    expect(byId(after, "LIVE").start_time).toBeGreaterThanOrEqual(25);
  });

  it("is in the final metrics and the run still finishes", () => {
    expect(after.completed).toBe(true);
    expect(after.metrics.total_patients).toBe(before.metrics.total_patients + 1);
    expect(after.metrics.patients_treated).toBe(after.metrics.total_patients);
    expect(byId(after, "LIVE").status).toBe("treated");
  });

  it("is visible in the queue at its arrival minute", () => {
    expect(after.timeline[25].queue_length + after.timeline[25].in_treatment).toBeGreaterThan(0);
    const waiting = after.patients.filter((p) => p.arrival_time <= 25 && (p.start_time ?? Infinity) > 25);
    expect(waiting.map((p) => p.id)).toContain("LIVE");
  });

  it("leaves everything that started before its arrival untouched", () => {
    for (const p of before.patients) {
      if (p.start_time !== null && p.start_time < 25) expect(byId(after, p.id).start_time).toBe(p.start_time);
    }
  });

  it("is never treated twice", () => {
    expect(after.patients.filter((p) => p.id === "LIVE")).toHaveLength(1);
    expect(() => runSimulation([...base, live, live], resources)).toThrow(/Duplicate patient id/);
  });
});
