import { describe, expect, it } from "vitest";
import { runSimulation, type SimPatient } from "@/lib/simulation";
import { EXAMPLE_STAFF, changeAvailability } from "@/lib/staff";
import { doctorWorkloads, stockAt } from "@/lib/workload";

const resources = { doctor: 2, nurse: 0, bed: 0, icu_bed: 0, operating_room: 0 };
const stock = {
  medicines: { gloves: { name: "Gloves", quantity: 10 } },
  equipment: { ventilator: { name: "Ventilator", units: 1 } },
};

const patient = (id: string, arrival: number, extra: Partial<SimPatient> = {}): SimPatient => ({
  id,
  condition: "Respiratory failure",
  arrival_time: arrival,
  urgency: 4,
  treatment_time: 20,
  required_resources: { doctor: 1 },
  stock_requirements: [
    { item_type: "equipment", item_id: "ventilator", quantity: 1 },
    { item_type: "medicine", item_id: "gloves", quantity: 2 },
  ],
  ...extra,
});

describe("doctor workload", () => {
  const out = runSimulation([patient("A", 0), patient("B", 0)], resources, { strategy: "fcfs", stock });

  it("replays stock: medicine stays used, equipment comes back when the treatment ends", () => {
    // A runs 0-20 holding the only ventilator; B waits, then runs 20-40.
    expect(stockAt(out, 5)!.medicines.get("gloves")).toBe(8);
    expect(stockAt(out, 5)!.equipment.get("ventilator")).toBe(0);
    expect(stockAt(out, 25)!.medicines.get("gloves")).toBe(6);
    expect(stockAt(out, 25)!.equipment.get("ventilator")).toBe(0);
    expect(stockAt(out, 45)!.medicines.get("gloves")).toBe(6);
    expect(stockAt(out, 45)!.equipment.get("ventilator")).toBe(1);
  });

  it("lists each doctor's patient, time left and stock lines without a roster", () => {
    const rows = doctorWorkloads(out, [], 5);
    expect(rows.map((r) => r.name)).toEqual(["Doctor 1", "Doctor 2"]);
    expect(rows[0].state).toBe("treating");
    expect(rows[0].tasks[0]).toMatchObject({ patient: { id: "A" }, minutes_left: 15 });
    expect(rows[0].tasks[0].stock).toEqual([
      expect.objectContaining({ name: "Ventilator", quantity: 1, left: 0, total: 1 }),
      expect.objectContaining({ name: "Gloves", quantity: 2, left: 8, total: 10 }),
    ]);
    expect(rows[1].state).toBe("free"); // B is still waiting for the ventilator
  });

  it("uses roster names and shows an unavailable doctor as off duty", () => {
    const d02 = EXAMPLE_STAFF.find((s) => s.id === "D02")!;
    const away = changeAvailability(d02, "on_leave", 0, "", "2026-01-02T00:00:00.000Z").staff;
    const staff = EXAMPLE_STAFF.map((s) => (s.id === "D02" ? away : s));
    const rows = doctorWorkloads(out, staff, 5, { ...resources, doctor: 5 });
    expect(rows).toHaveLength(5);
    expect(rows.find((r) => r.id === "D01")).toMatchObject({ name: "Dr. Arjun Rao", state: "treating" });
    expect(rows.find((r) => r.id === "D02")!.state).toBe("off_duty");
  });

  it("lists exactly the doctors Resources counts: extra named doctors are left out, missing ones are open positions", () => {
    // Resources says 2 doctors but the roster has 5 named ones: only the first two work.
    expect(doctorWorkloads(out, EXAMPLE_STAFF, 5).map((r) => r.id)).toEqual(["D01", "D02"]);
    // Resources says 2 doctors and only one is named: the other is an open position.
    const one = EXAMPLE_STAFF.filter((s) => s.id === "D01");
    expect(doctorWorkloads(out, one, 5).map((r) => r.name)).toEqual(["Dr. Arjun Rao", "Doctor 2"]);
  });

  it("reports no stock lines when the run did not track stock", () => {
    const untracked = runSimulation([patient("A", 0)], resources, { strategy: "fcfs" });
    expect(stockAt(untracked, 5)).toBeNull();
    expect(doctorWorkloads(untracked, [], 5)[0].tasks[0].stock).toEqual([]);
  });
});
