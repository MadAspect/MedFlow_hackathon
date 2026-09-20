import { z } from "zod";
import { CONDITIONS } from "./constants";
import { MAX_AMBULANCE_MINUTES } from "./simulation/ambulance";
import { RESOURCE_KEYS, type ResourceRequest, type ResourceSet } from "./simulation/types";

export type FieldErrors = Record<string, string>;

export type ValidationResult<T> =
  | { ok: true; data: T }
  | { ok: false; errors: FieldErrors };

export function parseNumberField(raw: string): number {
  const trimmed = raw.trim();
  return trimmed === "" ? NaN : Number(trimmed);
}

const intField = (label: string) =>
  z
    .number({ message: `${label} must be a number.` })
    .int(`${label} must be a whole number.`);

export const patientSchema = z.object({
  patient_id: z
    .string()
    .trim()
    .min(1, "Patient ID is required.")
    .max(32, "Patient ID must be 32 characters or fewer.")
    .regex(/^[A-Za-z0-9_-]+$/, "Use letters, numbers, dash or underscore only."),
  condition: z.enum(CONDITIONS, { message: "Select a condition from the list." }),
  arrival_time: intField("Arrival time")
    .min(0, "Arrival time cannot be negative.")
    .max(100000, "Arrival time is too large."),
  urgency: intField("Urgency")
    .min(1, "Urgency must be between 1 and 5.")
    .max(5, "Urgency must be between 1 and 5."),
  treatment_time: intField("Treatment time")
    .min(1, "Treatment time must be greater than zero.")
    .max(10000, "Treatment time is too large."),
  required_resources: z
    .record(z.string(), z.number().int().min(0).max(100))
    .superRefine((value, ctx) => {
      for (const key of Object.keys(value)) {
        if (!(RESOURCE_KEYS as readonly string[]).includes(key)) {
          ctx.addIssue({ code: "custom", message: `Unknown resource "${key}".` });
        }
      }
      const total = RESOURCE_KEYS.reduce((sum, k) => sum + (value[k] ?? 0), 0);
      if (total < 1) {
        ctx.addIssue({ code: "custom", message: "Select at least one resource." });
      }
    }),
});

export interface PatientInput {
  patient_id: string;
  condition: string;
  arrival_time: number;
  urgency: number;
  treatment_time: number;
  required_resources: ResourceRequest;
  appointment?: boolean;
  alert_time?: number;
}

function collectErrors(error: z.ZodError): FieldErrors {
  const errors: FieldErrors = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    if (!errors[key]) errors[key] = issue.message;
  }
  return errors;
}

export function validatePatient(
  input: unknown,
  existingIds: Iterable<string> = [],
): ValidationResult<PatientInput> {
  const parsed = patientSchema.safeParse(input);
  if (!parsed.success) return { ok: false, errors: collectErrors(parsed.error) };

  const taken = new Set([...existingIds].map((id) => id.toLowerCase()));
  if (taken.has(parsed.data.patient_id.toLowerCase())) {
    return {
      ok: false,
      errors: { patient_id: `Patient ID "${parsed.data.patient_id}" already exists.` },
    };
  }

  const required_resources: ResourceRequest = {};
  for (const k of RESOURCE_KEYS) {
    const units = parsed.data.required_resources[k] ?? 0;
    if (units > 0) required_resources[k] = units;
  }
  return { ok: true, data: { ...parsed.data, required_resources } };
}

export function validateAppointment(
  input: unknown,
  existingIds: Iterable<string> = [],
): ValidationResult<PatientInput> {
  const result = validatePatient(input, existingIds);
  if (!result.ok) {
    // The form calls the field "slot", so say so.
    const { arrival_time, ...rest } = result.errors;
    return {
      ok: false,
      errors: arrival_time ? { ...rest, slot: arrival_time.replace(/^Arrival time/, "Appointment time") } : rest,
    };
  }
  return { ok: true, data: { ...result.data, appointment: true } };
}

export const ambulanceTimingSchema = z.object({
  dispatch_time: intField("Dispatch time")
    .min(0, "Dispatch time cannot be negative.")
    .max(100000, "Dispatch time is too large."),
  eta: intField("Travel time")
    .min(1, "Travel time must be at least 1 minute.")
    .max(MAX_AMBULANCE_MINUTES, `Travel time is limited to ${MAX_AMBULANCE_MINUTES} minutes.`),
});

export function validateAmbulance(
  input: unknown,
  existingIds: Iterable<string> = [],
): ValidationResult<PatientInput> {
  const raw = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  const timing = ambulanceTimingSchema.safeParse({ dispatch_time: raw.dispatch_time, eta: raw.eta });
  const arrival_time = timing.success ? timing.data.dispatch_time + timing.data.eta : NaN;
  const result = validatePatient({ ...raw, arrival_time }, existingIds);

  const errors: FieldErrors = timing.success ? {} : collectErrors(timing.error);
  if (!result.ok) {
    const { arrival_time: arrivalError, ...rest } = result.errors;
    Object.assign(errors, rest);
    // With bad timing the NaN arrival is already explained by the timing errors above.
    if (arrivalError && timing.success) errors.dispatch_time = "Dispatch time plus travel time is too large.";
  }
  if (!timing.success || !result.ok) return { ok: false, errors };
  return { ok: true, data: { ...result.data, alert_time: timing.data.dispatch_time } };
}

const capacityField = (label: string) =>
  z
    .number({ message: `${label} must be a number.` })
    .int(`${label} must be a whole number.`)
    .min(0, `${label} cannot be negative.`)
    .max(1000, `${label} is too large.`);

export const resourceSchema = z.object({
  doctor: capacityField("Doctors"),
  nurse: capacityField("Nurses"),
  bed: capacityField("General beds"),
  icu_bed: capacityField("ICU beds"),
  operating_room: capacityField("Operating rooms"),
});

export function validateResources(input: unknown): ValidationResult<ResourceSet> {
  const parsed = resourceSchema.safeParse(input);
  if (!parsed.success) return { ok: false, errors: collectErrors(parsed.error) };
  return { ok: true, data: parsed.data };
}

export const simulationControlsSchema = z.object({
  duration: intField("Duration")
    .min(1, "Duration must be at least 1 minute.")
    .max(1440, "Duration is limited to 1440 minutes."),
  surgeStart: intField("Surge start").min(0, "Surge start cannot be negative."),
  failureStart: intField("Failure start").min(0, "Failure start cannot be negative."),
  failureUnits: intField("Failed units").min(1, "At least one unit must fail."),
});

export function validateSimulationControls(
  input: unknown,
): ValidationResult<z.infer<typeof simulationControlsSchema>> {
  const parsed = simulationControlsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, errors: collectErrors(parsed.error) };
  return { ok: true, data: parsed.data };
}
