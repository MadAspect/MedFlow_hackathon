import { describe, expect, it } from "vitest";
import { createLocalDatabase, createMemoryStore } from "@/lib/database";
import { DEMO_PARAMS, DEMO_PATIENTS, DEMO_RESOURCES, EXAMPLE_APPOINTMENTS, EXAMPLE_PATIENTS } from "@/lib/demo";
import { executeRun, outputFromStoredRun, toSimPatients } from "@/lib/runner";
import {
  APPOINTMENT_GRACE,
  analyse,
  checkSlot,
  emptyResourceSet,
  runSimulation,
  slotIsFree,
  slotLabel,
  suggestSlot,
  treatmentOrder,
  type Booking,
  type ResourceRequest,
  type SimPatient,
} from "@/lib/simulation";
import { outcomesToCsv } from "@/lib/export";
import { validateAppointment } from "@/lib/validation";

const P = (
  id: string,
  arrival: number,
  urgency: number,
  treatment: number,
  required: ResourceRequest = { doctor: 1 },
  appointment = false,
): SimPatient => ({
  id,
  condition: "Test",
  arrival_time: arrival,
  urgency,
  treatment_time: treatment,
  required_resources: required,
  ...(appointment ? { appointment: true } : {}),
});

const ONE_DOCTOR = { ...emptyResourceSet(), doctor: 1 };
const byId = (out: ReturnType<typeof runSimulation>, id: string) => out.patients.find((p) => p.id === id)!;

describe("appointments in the simulation", () => {
  // One doctor. A long walk-in arrives first; a short appointment is booked for minute 30.
  const walkIn = P("W", 0, 2, 60);
  const appt = P("A", 30, 1, 20, { doctor: 1 }, true);

  it("holds a non-urgent walk-in back so a booked slot starts on time", () => {
    const out = runSimulation([walkIn, appt], ONE_DOCTOR, { strategy: "fcfs" });
    expect(byId(out, "A").start_time).toBe(30);
    expect(byId(out, "A").wait_time).toBe(0);
    expect(byId(out, "W").start_time).toBe(50); // waited for the slot
    expect(byId(out, "W").decision!.appointment_hold).toEqual({ minutes: 30, appointment_id: "A", kind: "appointment" });
    expect(out.completed).toBe(true);
    expect(out.metrics.appointments_total).toBe(1);
    expect(out.metrics.appointments_on_time).toBe(1);
  });

  it("lets the walk-in run first, and the appointment start late, when protection is off", () => {
    const out = runSimulation([walkIn, appt], ONE_DOCTOR, { strategy: "fcfs", protectAppointments: false });
    expect(byId(out, "W").start_time).toBe(0);
    expect(byId(out, "A").start_time).toBe(60);
    expect(byId(out, "A").wait_time).toBe(30);
    expect(out.metrics.appointments_on_time).toBe(0);
    expect(out.metrics.appointment_average_delay).toBe(30);
    expect(out.warnings.some((w) => w.code === "appointments_late")).toBe(true);
  });

  it("is on by default", () => {
    const out = runSimulation([walkIn, appt], ONE_DOCTOR);
    expect(out.params.protectAppointments).toBe(true);
    expect(byId(out, "A").wait_time).toBe(0);
  });

  it("never holds back a critical walk-in", () => {
    const out = runSimulation([P("W", 0, 5, 60), appt], ONE_DOCTOR, { strategy: "fcfs" });
    expect(byId(out, "W").start_time).toBe(0);
    expect(byId(out, "A").wait_time).toBe(30);
    expect(byId(out, "W").decision!.appointment_hold).toBeUndefined();
  });

  it("gives a critical walk-in up to the grace period of slack, but no more", () => {
    // Slot at 30. A critical walk-in that ends by 40 (slot + 10) cannot push A past the limit...
    const fits = runSimulation([P("W", 0, 4, 40), appt], ONE_DOCTOR, { strategy: "fcfs" });
    expect(byId(fits, "W").start_time).toBe(0);
    expect(byId(fits, "A").wait_time).toBe(APPOINTMENT_GRACE);
    expect(fits.metrics.appointments_on_time).toBe(1);
    // ...but one that would run longer is held back so the appointment still starts within 10 minutes.
    const long = runSimulation([P("W", 0, 4, 60), appt], ONE_DOCTOR, { strategy: "fcfs" });
    expect(byId(long, "A").wait_time).toBeLessThanOrEqual(APPOINTMENT_GRACE);
    expect(byId(long, "W").decision!.appointment_hold).toBeDefined();
  });

  it("gives a surge emergency the same slack, and never holds one of top urgency", () => {
    const routine = runSimulation([{ ...walkIn, emergency: true }, appt], ONE_DOCTOR, { strategy: "fcfs" });
    expect(byId(routine, "A").wait_time).toBeLessThanOrEqual(APPOINTMENT_GRACE);
    const top = runSimulation([{ ...P("W", 0, 5, 60), emergency: true }, appt], ONE_DOCTOR, { strategy: "fcfs" });
    expect(byId(top, "W").start_time).toBe(0);
  });

  it("does not hold a walk-in that finishes before the slot", () => {
    const out = runSimulation([P("W", 0, 2, 25), appt], ONE_DOCTOR, { strategy: "fcfs" });
    expect(byId(out, "W").start_time).toBe(0);
    expect(byId(out, "A").start_time).toBe(30);
  });

  it("does not hold a walk-in when there is room for both", () => {
    const out = runSimulation([walkIn, appt], { ...emptyResourceSet(), doctor: 2 }, { strategy: "fcfs" });
    expect(byId(out, "W").start_time).toBe(0);
    expect(byId(out, "A").start_time).toBe(30);
  });

  it("keeps protecting a slot from a walk-in that has already waited past the safety limit", () => {
    // C (critical) occupies the only doctor until minute 45; W has waited 44 min by then, past
    // the 30-minute limit. Waiting long does not entitle W to take a booked slot.
    const list = [P("C", 0, 5, 45), P("W", 1, 2, 60), P("A", 60, 1, 20, { doctor: 1 }, true)];
    for (const safetyThreshold of [30, 100]) {
      const out = runSimulation(list, ONE_DOCTOR, { strategy: "fcfs", safetyThreshold });
      expect(byId(out, "A").wait_time).toBe(0);
      expect(byId(out, "W").start_time).toBe(80);
    }
  });

  it("reserves resources for a due appointment so smaller walk-ins cannot keep taking them", () => {
    // Two doctors. A needs both at minute 10 but one is busy with X until 40. Short walk-ins
    // would take the free doctor each time; the reservation stops that.
    const two = { ...emptyResourceSet(), doctor: 2 };
    const list = [
      P("X", 0, 5, 40),
      P("A", 10, 1, 10, { doctor: 2 }, true),
      P("W1", 5, 2, 8),
      P("W2", 12, 2, 8),
      P("W3", 20, 2, 8),
      P("W4", 28, 2, 8),
    ];
    const out = runSimulation(list, two, { strategy: "fcfs" });
    expect(byId(out, "A").start_time).toBe(40);
    const off = runSimulation(list, two, { strategy: "fcfs", protectAppointments: false });
    expect(byId(off, "A").start_time).toBeGreaterThanOrEqual(byId(out, "A").start_time!);
  });

  it("keeps every appointment within the grace period on a busy day that has room", () => {
    // Many non-critical walk-ins plus booked appointments, in a hospital that can hold them all.
    const res = { doctor: 4, nurse: 8, bed: 10, icu_bed: 3, operating_room: 2 };
    const sim = (p: (typeof EXAMPLE_PATIENTS)[number]): SimPatient => ({
      id: p.patient_id,
      condition: p.condition,
      arrival_time: p.arrival_time,
      urgency: p.urgency,
      treatment_time: p.treatment_time,
      required_resources: p.required_resources,
      ...(p.appointment ? { appointment: true } : {}),
    });
    const everyone = [...EXAMPLE_PATIENTS.filter((p) => p.urgency <= 3), ...EXAMPLE_APPOINTMENTS].map(sim);
    for (const strategy of ["fcfs", "urgency", "dynamic"] as const) {
      const out = runSimulation(everyone, res, { strategy, duration: 120 });
      expect(out.completed).toBe(true);
      expect(out.metrics.appointment_max_delay!).toBeLessThanOrEqual(APPOINTMENT_GRACE);
      expect(out.metrics.appointments_on_time).toBe(EXAMPLE_APPOINTMENTS.length);
    }
  });

  it("serves a due appointment ahead of a non-urgent walk-in that was waiting", () => {
    // Urgency Only would normally pick W (urgency 3) over A (urgency 1) at minute 30.
    const list = [P("C", 0, 5, 30), P("W", 5, 3, 10), P("A", 30, 1, 10, { doctor: 1 }, true)];
    const on = runSimulation(list, ONE_DOCTOR, { strategy: "urgency" });
    expect(treatmentOrder(on)).toEqual(["C", "A", "W"]);
    expect(byId(on, "A").wait_time).toBe(0);

    const off = runSimulation(list, ONE_DOCTOR, { strategy: "urgency", protectAppointments: false });
    expect(treatmentOrder(off)).toEqual(["C", "W", "A"]);
    expect(byId(off, "A").wait_time).toBe(10);
  });

  it("changes nothing when nobody is booked", () => {
    const patients = toSimPatients(
      EXAMPLE_PATIENTS.map((p, i) => ({ ...p, id: String(i), status: "waiting" as const, priority_score: 0, created_at: "" })),
    );
    for (const strategy of ["fcfs", "urgency", "dynamic"] as const) {
      const on = runSimulation(patients, DEMO_RESOURCES, { ...DEMO_PARAMS, strategy, protectAppointments: true });
      const off = runSimulation(patients, DEMO_RESOURCES, { ...DEMO_PARAMS, strategy, protectAppointments: false });
      expect(treatmentOrder(on)).toEqual(treatmentOrder(off));
      expect(on.metrics.total_waiting_time).toBe(off.metrics.total_waiting_time);
      expect(on.metrics.appointments_total).toBe(0);
    }
  });

  it("stays deterministic, always finishes, and never overloads a resource", () => {
    const asSim = (p: (typeof DEMO_PATIENTS)[number]): SimPatient => ({
      id: p.patient_id,
      condition: p.condition,
      arrival_time: p.arrival_time,
      urgency: p.urgency,
      treatment_time: p.treatment_time,
      required_resources: p.required_resources,
      ...(p.appointment ? { appointment: true } : {}),
    });
    const mixed = [...DEMO_PATIENTS, ...EXAMPLE_APPOINTMENTS].map(asSim);
    for (const strategy of ["fcfs", "urgency", "dynamic"] as const) {
      const a = runSimulation(mixed, DEMO_RESOURCES, { ...DEMO_PARAMS, strategy });
      const b = runSimulation(mixed, DEMO_RESOURCES, { ...DEMO_PARAMS, strategy });
      expect(a.completed).toBe(true);
      expect(a.metrics.resource_overload).toBe(0);
      expect(treatmentOrder(a)).toEqual(treatmentOrder(b));
      expect(a.metrics.appointments_total).toBe(EXAMPLE_APPOINTMENTS.length);
    }
  });

  it("reports the trade-off: protection keeps appointments on time and walk-ins wait longer", () => {
    const on = runSimulation([walkIn, appt], ONE_DOCTOR, { strategy: "fcfs" });
    const off = runSimulation([walkIn, appt], ONE_DOCTOR, { strategy: "fcfs", protectAppointments: false });
    expect(on.metrics.appointment_average_delay!).toBeLessThan(off.metrics.appointment_average_delay!);
    expect(on.metrics.walk_in_average_wait!).toBeGreaterThan(off.metrics.walk_in_average_wait!);
  });

  it("counts a start within the grace period as on time", () => {
    const late = P("A", 10, 1, 10, { doctor: 1 }, true);
    const out = runSimulation([P("X", 0, 5, 10 + APPOINTMENT_GRACE), late], ONE_DOCTOR, { strategy: "fcfs" });
    expect(byId(out, "A").wait_time).toBe(APPOINTMENT_GRACE);
    expect(out.metrics.appointments_on_time).toBe(1);
  });
});

describe("booking helpers", () => {
  const cap = { ...emptyResourceSet(), doctor: 2, nurse: 4, bed: 3 };
  const booked: Booking[] = [
    { id: "A1", start: 30, duration: 30, need: { doctor: 1 } },
    { id: "A2", start: 30, duration: 30, need: { doctor: 1 } },
  ];

  it("formats clock times from an 08:00 start", () => {
    expect(slotLabel(0)).toBe("08:00");
    expect(slotLabel(90)).toBe("09:30");
    expect(slotLabel(16 * 60)).toBe("00:00 +1d");
  });

  it("flags overbooking and impossible needs", () => {
    const clash = checkSlot(booked, { id: "N", start: 40, duration: 10, need: { doctor: 1 } }, cap);
    expect(clash.overbooked).toMatchObject({ minute: 40, resource: "doctor", demand: 3, capacity: 2 });
    expect(clash.overlapping).toEqual(["A1", "A2"]);
    expect(slotIsFree(clash)).toBe(false);

    const never = checkSlot([], { id: "N", start: 0, duration: 10, need: { icu_bed: 1 } }, cap);
    expect(never.impossible).toEqual([{ resource: "icu_bed", needed: 1, capacity: 0 }]);
    expect(slotIsFree(never)).toBe(false);
  });

  it("accepts a slot that only touches another appointment's end", () => {
    const c = checkSlot(booked, { id: "N", start: 60, duration: 10, need: { doctor: 2 } }, cap);
    expect(slotIsFree(c)).toBe(true);
  });

  it("notices a booking that starts in the middle of the proposed slot", () => {
    const later: Booking[] = [{ id: "L", start: 50, duration: 10, need: { doctor: 2 } }];
    const c = checkSlot(later, { id: "N", start: 40, duration: 30, need: { doctor: 1 } }, cap);
    expect(c.overbooked?.minute).toBe(50);
  });

  it("suggests the next free slot, or none when it can never fit", () => {
    expect(suggestSlot(booked, { doctor: 1 }, 10, cap, 40)).toBe(60);
    expect(suggestSlot(booked, { doctor: 1 }, 10, cap, 0)).toBe(0);
    expect(suggestSlot(booked, { icu_bed: 1 }, 10, cap, 0)).toBeNull();
  });
});

describe("appointment validation and storage", () => {
  const input = {
    patient_id: "A100",
    condition: "Routine check",
    arrival_time: 45,
    urgency: 2,
    treatment_time: 20,
    required_resources: { doctor: 1 },
  };

  it("accepts a valid appointment and flags it", () => {
    const r = validateAppointment(input);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.appointment).toBe(true);
  });

  it("names the field 'slot' in errors and still rejects duplicate IDs", () => {
    const bad = validateAppointment({ ...input, arrival_time: NaN });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.errors.slot).toMatch(/Appointment time/);
      expect(bad.errors.arrival_time).toBeUndefined();
    }
    expect(validateAppointment(input, ["a100"]).ok).toBe(false);
  });

  it("stores appointments, feeds them to the engine, and remembers them in saved runs", async () => {
    const store = createMemoryStore();
    const db = createLocalDatabase(store);
    await db.insertPatients([
      { ...input, patient_id: "W1", arrival_time: 0, urgency: 2, treatment_time: 60 },
      { ...input, appointment: true, arrival_time: 30 },
    ]);
    await db.saveResources(ONE_DOCTOR);

    const rows = await createLocalDatabase(store).listPatients();
    expect(rows.find((p) => p.patient_id === "A100")!.appointment).toBe(true);
    expect(rows.find((p) => p.patient_id === "W1")!.appointment).toBeUndefined();

    const { output, stored } = await executeRun(db, { strategy: "fcfs" });
    expect(output.patients.find((p) => p.id === "A100")!.appointment).toBe(true);
    expect(stored.run.parameters.appointments).toEqual(["A100"]);

    const detail = await createLocalDatabase(store).getRun(stored.run.id);
    const rebuilt = outputFromStoredRun(detail!)!;
    expect(rebuilt.patients.find((p) => p.id === "A100")!.appointment).toBe(true);
    expect(rebuilt.patients.find((p) => p.id === "W1")!.appointment).toBe(false);
    expect(rebuilt.metrics.appointments_total).toBe(1);
  });

  it("still opens runs saved before appointments existed", async () => {
    const db = createLocalDatabase(createMemoryStore());
    await db.insertPatients([input]);
    await db.saveResources(ONE_DOCTOR);
    const { stored } = await executeRun(db, {});
    delete stored.run.parameters.appointments; // an older saved run has no such key
    const rebuilt = outputFromStoredRun(stored)!;
    expect(rebuilt.patients.every((p) => p.appointment === false)).toBe(true);
  });
});

describe("appointment advice and export", () => {
  const walkIn = P("W", 0, 2, 60);
  const appt = P("A", 30, 1, 20, { doctor: 1 }, true);

  it("tells the user what holding slots bought and cost", () => {
    const a = analyse([walkIn, appt], ONE_DOCTOR, {});
    const item = a.advice.find((i) => i.id === "appointments");
    expect(item?.tone).toBe("green");
    expect(item?.title).toMatch(/1 more appointment on time/);
    expect(item?.detail).toMatch(/Walk-ins wait/);
  });

  it("says nothing about appointments when nobody is booked", () => {
    const a = analyse([P("W", 0, 2, 60), P("X", 5, 3, 20)], ONE_DOCTOR, {});
    expect(a.advice.some((i) => i.id === "appointments")).toBe(false);
  });

  it("marks appointments in the CSV", () => {
    const csv = outcomesToCsv(runSimulation([walkIn, appt], ONE_DOCTOR, { strategy: "fcfs" }));
    const [header, ...rows] = csv.trimEnd().split("\n");
    const col = header.split(",").indexOf("appointment");
    expect(col).toBeGreaterThan(-1);
    expect(rows.map((r) => r.split(",")[col])).toEqual(["false", "true"]);
  });
});
