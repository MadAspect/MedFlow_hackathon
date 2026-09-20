import { describe, expect, it } from "vitest";
import { DEFAULT_RESOURCES } from "@/lib/simulation/resources";
import { runSimulation, type ResourceRequest, type SimPatient } from "@/lib/simulation";
import { EXAMPLE_STAFF } from "@/lib/staff";
import { buildRunSummary } from "@/lib/summary";

const resources = { ...DEFAULT_RESOURCES, doctor: 2, nurse: 1 };
const patient = (id: string, arrival: number, treatment: number, need: ResourceRequest = { doctor: 1, nurse: 1 }): SimPatient => ({
  id,
  condition: "Test",
  arrival_time: arrival,
  urgency: 3,
  treatment_time: treatment,
  required_resources: need,
});

describe("run summary", () => {
  // A and B start together (both doctors busy); C has to wait for the single nurse.
  const out = runSimulation([patient("A", 0, 30, { doctor: 1 }), patient("B", 0, 30, { doctor: 1 }), patient("C", 5, 30)], resources, { strategy: "fcfs" });

  it("reports the headline numbers from the run", () => {
    const s = buildRunSummary(out, [], resources);
    expect(s.patients).toEqual({ total: 3, treated: 3, remaining: 0 });
    expect(s.timing.finished).toBe(out.metrics.actual_completion_time);
    expect(s.waits.maximum).toBe(out.metrics.maximum_wait);
  });

  it("counts resource use: capacity, peak at one minute and unit-hours", () => {
    const s = buildRunSummary(out, [], resources);
    const doctors = s.resources.find((r) => r.key === "doctor")!;
    expect(doctors).toMatchObject({ capacity: 2, peak: 2 });
    // A and B for 30 minutes each, C for 30: 90 doctor-minutes.
    expect(doctors.unitHours).toBeCloseTo(1.5, 5);
    expect(s.resources.find((r) => r.key === "operating_room")!.peak).toBe(0);
  });

  it("counts the faculty who worked, by the Resources headcount, naming open positions", () => {
    const s = buildRunSummary(out, [], resources);
    const doctors = s.faculty.find((f) => f.role === "doctor")!;
    expect(doctors).toMatchObject({ configured: 2, peakWorking: 2, worked: 2, names: ["Doctor 1", "Doctor 2"] });
    expect(doctors.hours).toBeCloseTo(1.5, 5);
    expect(s.faculty.find((f) => f.role === "nurse")).toMatchObject({ configured: 1, worked: 1 });
  });

  it("uses roster names and ignores named staff beyond the headcount", () => {
    const s = buildRunSummary(out, EXAMPLE_STAFF, resources);
    const doctors = s.faculty.find((f) => f.role === "doctor")!;
    expect(doctors.names).toEqual(["Dr. Arjun Rao", "Dr. Meera Iyer"]);
    expect(doctors.configured).toBe(2);
  });

  it("marks who is off duty", () => {
    const staff = EXAMPLE_STAFF.map((x) => (x.id === "D02" ? { ...x, availability_status: "on_leave" as const } : x));
    expect(buildRunSummary(out, staff, resources).faculty.find((f) => f.role === "doctor")!.offDuty).toBe(1);
  });
});
