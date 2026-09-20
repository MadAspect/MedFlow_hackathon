import { describe, expect, it } from "vitest";
import { DEMO_PARAMS, DEMO_PATIENTS, DEMO_RESOURCES, EXAMPLE_APPOINTMENTS } from "@/lib/demo";
import { liveSnapshot, liveWaitHistogram, runSimulation, waitAt, waitHistogram, type SimPatient } from "@/lib/simulation";

const sim = (p: (typeof DEMO_PATIENTS)[number]): SimPatient => ({
  id: p.patient_id,
  condition: p.condition,
  arrival_time: p.arrival_time,
  urgency: p.urgency,
  treatment_time: p.treatment_time,
  required_resources: p.required_resources,
  ...(p.appointment ? { appointment: true } : {}),
});

const output = runSimulation([...DEMO_PATIENTS, ...EXAMPLE_APPOINTMENTS].map(sim), DEMO_RESOURCES, DEMO_PARAMS);
const last = output.timeline.length - 1;

describe("live replay", () => {
  it("starts empty and ends exactly where the finished run ended", () => {
    const start = liveSnapshot(output, 0);
    expect(start.treated).toBe(0);
    expect(start.total).toBe(output.patients.length);

    const end = liveSnapshot(output, last);
    expect(end.treated).toBe(output.metrics.patients_treated);
    expect(end.waiting + end.inTreatment + end.notArrived).toBe(0);
    expect(end.averageWait).toBeCloseTo(output.metrics.average_wait, 9);
    expect(end.longestWait).toBe(output.metrics.maximum_wait);
    for (const k of Object.keys(end.utilization) as (keyof typeof end.utilization)[]) {
      expect(end.utilization[k]).toBeCloseTo(output.metrics.resource_utilization[k], 9);
    }
  });

  it("accounts for every patient at every minute, and treated never decreases", () => {
    let treated = 0;
    for (let t = 0; t <= last; t++) {
      const s = liveSnapshot(output, t);
      expect(s.notArrived + s.waiting + s.inTreatment + s.treated).toBe(s.total);
      expect(s.waiting).toBe(output.timeline[t].queue_length);
      expect(s.treated).toBeGreaterThanOrEqual(treated);
      treated = s.treated;
    }
  });

  it("clamps a minute outside the run", () => {
    expect(liveSnapshot(output, -5).t).toBe(0);
    expect(liveSnapshot(output, last + 50).t).toBe(last);
  });

  it("counts a patient's wait so far, and their final wait once started", () => {
    const p = output.patients.find((x) => x.start_time !== null && x.start_time > x.arrival_time)!;
    expect(waitAt(p, p.arrival_time - 1)).toBe(0);
    expect(waitAt(p, p.arrival_time + 1)).toBe(1);
    expect(waitAt(p, p.start_time!)).toBe(p.wait_time);
    expect(waitAt(p, last)).toBe(p.wait_time);
  });

  it("has a wait histogram that fills up to the final one with fixed buckets", () => {
    const final = waitHistogram(output.patients, 10);
    const atEnd = liveWaitHistogram(output, last, 10);
    expect(atEnd).toEqual(final);
    const early = liveWaitHistogram(output, 5, 10);
    expect(early.length).toBe(final.length);
    expect(early.reduce((s, b) => s + b.count, 0)).toBeLessThan(final.reduce((s, b) => s + b.count, 0));
  });

  it("counts booked slots as they come due", () => {
    const booked = output.patients.filter((p) => p.appointment);
    expect(booked.length).toBe(EXAMPLE_APPOINTMENTS.length);
    expect(liveSnapshot(output, 0).appointmentsDue).toBe(0);
    expect(liveSnapshot(output, last).appointmentsDue).toBe(booked.length);
  });
});
