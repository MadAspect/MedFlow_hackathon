import { describe, expect, it } from "vitest";
import { DEFAULT_RESOURCES } from "@/lib/simulation/resources";
import { runSimulation, type PatientOutcome, type SimPatient } from "@/lib/simulation";
import {
  EXAMPLE_STAFF,
  StaffError,
  alignRoster,
  assignmentsAt,
  changeAvailability,
  createStaff,
  effectiveResources,
  filterStaff,
  generateStaff,
  isAssignable,
  isOpenSlot,
  summarizeStaff,
  updateStaff,
  type StaffMember,
} from "@/lib/staff";

const NOW = "2026-05-01T10:00:00.000Z";
const LATER = "2026-05-01T11:00:00.000Z";

const doctor = (id = "D01", extra: Partial<Parameters<typeof createStaff>[0]> = {}) =>
  createStaff({ name: "Dr. Test", role: "doctor", department: "ER", shift_start: "08:00", shift_end: "20:00", ...extra }, id, NOW);

describe("staff records", () => {
  it("creates and edits a member, trimming text and stamping times", () => {
    const s = createStaff({ name: "  Dr. Test ", role: "doctor", department: " ER ", specialization: "  ", shift_start: "08:00", shift_end: "20:00" }, "D01", NOW);
    expect(s).toMatchObject({ name: "Dr. Test", department: "ER", specialization: null, availability_status: "available", created_at: NOW });
    const edited = updateStaff(s, { department: "ICU", specialization: "Critical care" }, LATER);
    expect(edited).toMatchObject({ department: "ICU", specialization: "Critical care", created_at: NOW, updated_at: LATER });
    expect(s.department).toBe("ER");
  });

  it("rejects bad input", () => {
    expect(() => doctor("D1", { name: "" })).toThrow(StaffError);
    expect(() => doctor("D1", { department: " " })).toThrow(/Department is required/);
    expect(() => doctor("D1", { shift_start: "8am" })).toThrow(/Shift times/);
    expect(() => doctor("D1", { shift_end: "25:00" })).toThrow(/Shift times/);
    expect(() => doctor("D1", { role: "wizard" as never })).toThrow(/valid role/);
  });

  it("filters by role, department, status and text", () => {
    const list = EXAMPLE_STAFF;
    expect(filterStaff(list, { role: "doctor" })).toHaveLength(5);
    expect(filterStaff(list, { department: "ICU" }).every((s) => s.department === "ICU")).toBe(true);
    expect(filterStaff(list, { query: "cardio" }).map((s) => s.id)).toEqual(["D02"]);
    expect(filterStaff(list, { status: "on_leave" })).toHaveLength(0);
  });
});

describe("availability changes", () => {
  it("only available staff can be assigned", () => {
    for (const status of ["busy", "on_leave", "unavailable", "training"] as const) {
      expect(isAssignable({ availability_status: status })).toBe(false);
    }
    expect(isAssignable({ availability_status: "available" })).toBe(true);
  });

  it("marking a doctor unavailable removes one doctor from the effective time on", () => {
    const change = changeAvailability(doctor(), "on_leave", 40, "sick", LATER);
    expect(change.staff.availability_status).toBe("on_leave");
    expect(change.event).toEqual({ staff_id: "D01", previous_status: "available", new_status: "on_leave", effective_time: 40, reason: "sick" });
    expect(change.availability).toEqual({ time: 40, resource: "doctor", delta: -1, staff_id: "D01", reason: "sick" });
  });

  it("marking them available again adds the unit back", () => {
    const off = changeAvailability(doctor(), "unavailable", 0, "", LATER).staff;
    expect(changeAvailability(off, "available", 90, "", LATER).availability).toMatchObject({ time: 90, resource: "doctor", delta: 1 });
  });

  it("moving between two off-duty statuses changes nothing for the engine", () => {
    const off = changeAvailability(doctor(), "on_leave", 0, "", LATER).staff;
    expect(changeAvailability(off, "training", 10, "", LATER).availability).toBeNull();
    expect(changeAvailability(doctor(), "available", 10, "", LATER).availability).toBeNull();
  });

  it("technicians are recorded but the engine has no resource for them", () => {
    const tech = createStaff({ name: "T", role: "technician", department: "Lab", shift_start: "08:00", shift_end: "16:00" }, "T1", NOW);
    const change = changeAvailability(tech, "unavailable", 5, "", LATER);
    expect(change.staff.availability_status).toBe("unavailable");
    expect(change.availability).toBeNull();
  });

  it("does not mutate the original and rejects bad times", () => {
    const s = doctor();
    changeAvailability(s, "on_leave", 5, "", LATER);
    expect(s.availability_status).toBe("available");
    expect(() => changeAvailability(s, "on_leave", -1, "", LATER)).toThrow(StaffError);
    expect(() => changeAvailability(s, "on_leave", 1.5, "", LATER)).toThrow(StaffError);
    expect(() => changeAvailability(s, "asleep" as never, 1, "", LATER)).toThrow(StaffError);
  });
});

describe("effective resources", () => {
  it("an untouched example roster leaves the configured capacity alone", () => {
    expect(effectiveResources(DEFAULT_RESOURCES, EXAMPLE_STAFF)).toEqual(DEFAULT_RESOURCES);
  });

  it("takes off one unit per doctor or nurse who is not available, never below zero", () => {
    const staff: StaffMember[] = EXAMPLE_STAFF.map((s) => (["D01", "D02", "N01"].includes(s.id) ? { ...s, availability_status: "on_leave" as const } : s));
    expect(effectiveResources(DEFAULT_RESOURCES, staff)).toEqual({ ...DEFAULT_RESOURCES, doctor: 3, nurse: 9 });
    expect(effectiveResources({ ...DEFAULT_RESOURCES, doctor: 1 }, staff).doctor).toBe(0);
  });

  it("leaving a technician off changes no engine resource", () => {
    const staff = EXAMPLE_STAFF.map((s) => (s.id === "T01" ? { ...s, availability_status: "unavailable" as const } : s));
    expect(effectiveResources(DEFAULT_RESOURCES, staff)).toEqual(DEFAULT_RESOURCES);
  });
});

describe("roster follows the Resources headcount", () => {
  const names = (list: StaffMember[], role: string) => list.filter((s) => s.role === role).map((s) => s.id);

  it("matches the configured doctors and nurses exactly, filling gaps with open positions", () => {
    const { scheduled, surplus } = alignRoster(EXAMPLE_STAFF.filter((s) => s.id !== "D05" && s.role !== "nurse"), DEFAULT_RESOURCES);
    expect(names(scheduled, "doctor")).toEqual(["D01", "D02", "D03", "D04", "open-doctor-5"]);
    expect(names(scheduled, "nurse")).toHaveLength(10);
    expect(scheduled.filter((s) => s.role === "nurse").every(isOpenSlot)).toBe(true);
    expect(surplus).toEqual([]);
  });

  it("keeps named staff beyond the headcount on the list but does not schedule them", () => {
    const { scheduled, surplus } = alignRoster(EXAMPLE_STAFF, { ...DEFAULT_RESOURCES, doctor: 3, nurse: 10 });
    expect(names(scheduled, "doctor")).toEqual(["D01", "D02", "D03"]);
    expect(names(surplus, "doctor")).toEqual(["D04", "D05"]);
    // Technicians are not part of the engine's headcount.
    expect(names(scheduled, "technician")).toEqual(["T01", "T02"]);
  });

  it("a doctor beyond the headcount being off does not take capacity away", () => {
    const staff = EXAMPLE_STAFF.map((s) => (s.id === "D05" ? { ...s, availability_status: "on_leave" as const } : s));
    expect(effectiveResources({ ...DEFAULT_RESOURCES, doctor: 3 }, staff).doctor).toBe(3);
    expect(effectiveResources(DEFAULT_RESOURCES, staff).doctor).toBe(4);
  });

  it("an open position counts as an available unit, and a change to it moves capacity like anyone else", () => {
    expect(effectiveResources({ ...DEFAULT_RESOURCES, doctor: 8 }, EXAMPLE_STAFF).doctor).toBe(8);
    const open = alignRoster([], DEFAULT_RESOURCES).scheduled.find(isOpenSlot)!;
    expect(changeAvailability(open, "on_leave", 10, "", LATER).availability).toMatchObject({ resource: "doctor", delta: -1 });
    expect(changeAvailability(open, "on_leave", 10, "", LATER, false).availability).toBeNull();
  });
});

describe("availability affects future scheduling only", () => {
  const P = (id: string, arrival: number, treatment: number): SimPatient => ({
    id,
    condition: "Test",
    arrival_time: arrival,
    urgency: 3,
    treatment_time: treatment,
    required_resources: { doctor: 1 },
  });
  const resources = { ...DEFAULT_RESOURCES, doctor: 2 };
  const patients = [P("A", 0, 30), P("B", 0, 30), P("C", 20, 30), P("D", 60, 30)];

  it("a doctor marked unavailable mid-run is not given a new treatment, and finished work is unchanged", () => {
    const change = changeAvailability(doctor(), "unavailable", 10, "called away", LATER).availability!;
    const out = runSimulation(patients, resources, { availability: [change] });
    const byId = (id: string) => out.patients.find((p) => p.id === id)!;
    expect(byId("A").end_time).toBe(30); // was already treating, finishes as planned
    expect(byId("B").end_time).toBe(30);
    // one doctor left: C then D cannot overlap
    expect(byId("C").start_time).toBe(30);
    expect(out.completed).toBe(true);
    const cEnd = byId("C").end_time!;
    expect(byId("D").start_time!).toBeGreaterThanOrEqual(Math.max(60, cEnd));
  });
});

describe("who is treating whom (display)", () => {
  const outcome = (id: string, start: number, end: number, doctors: number, nurses = 0): PatientOutcome =>
    ({
      id,
      start_time: start,
      end_time: end,
      required_resources: { doctor: doctors, nurse: nurses },
    }) as PatientOutcome;

  it("maps in-treatment patients onto available staff in id order", () => {
    const map = assignmentsAt([outcome("P1", 0, 30, 1, 1), outcome("P2", 5, 30, 1)], EXAMPLE_STAFF, 10);
    expect(map.get("D01")).toEqual(["P1"]);
    expect(map.get("D02")).toEqual(["P2"]);
    expect(map.get("N01")).toEqual(["P1"]);
    expect(map.get("D03")).toBeUndefined();
  });

  it("ignores finished and not-yet-started treatments, and skips staff who are off", () => {
    const staff = EXAMPLE_STAFF.map((s) => (s.id === "D01" ? { ...s, availability_status: "on_leave" as const } : s));
    const map = assignmentsAt([outcome("P1", 0, 10, 1), outcome("P2", 20, 40, 1), outcome("P3", 5, 30, 1)], staff, 12);
    expect(map.get("D02")).toEqual(["P3"]);
    expect(map.has("D01")).toBe(false);
  });
});

describe("summary", () => {
  it("counts by status and role", () => {
    const staff: StaffMember[] = EXAMPLE_STAFF.map((s) => (s.id === "D01" ? { ...s, availability_status: "on_leave" as const } : s.id === "N01" ? { ...s, availability_status: "busy" as const } : s));
    const s = summarizeStaff(staff);
    expect(s).toMatchObject({ total: 17, available: 15, onLeave: 1, busy: 1 });
    expect(s.byRole.doctor).toEqual({ total: 5, available: 4 });
    expect(s.byRole.nurse).toEqual({ total: 10, available: 9 });
  });
});

describe("generateStaff", () => {
  const opts = { makeId: (() => { let n = 0; return () => `G${++n}`; })(), now: "2026-01-01T00:00:00.000Z" };

  it("gives every doctor a unique name and a profession", () => {
    const doctors = generateStaff("doctor", 30, opts);
    expect(doctors).toHaveLength(30);
    expect(new Set(doctors.map((d) => d.name)).size).toBe(30);
    expect(doctors.every((d) => d.name.startsWith("Dr. ") && d.role === "doctor" && d.specialization && d.department)).toBe(true);
  });

  it("does not reuse names already on the roster and is repeatable with a seeded rng", () => {
    const seeded = () => { let x = 7; return () => ((x = (x * 16807) % 2147483647) / 2147483647); };
    const a = generateStaff("nurse", 5, { ...opts, rng: seeded() });
    const b = generateStaff("nurse", 5, { ...opts, rng: seeded(), takenNames: a.map((n) => n.name) });
    expect(b.some((n) => a.map((x) => x.name.toLowerCase()).includes(n.name.toLowerCase()))).toBe(false);
  });
});
