import type { AvailabilityChange, PatientOutcome, ResourceKey, ResourceSet } from "./simulation/types";

/**
 * Faculty and medical staff.
 *
 * The engine schedules doctors and nurses as counts of interchangeable units, so the roster works
 * as a set of people behind those counts: a doctor or nurse who is not "available" removes one unit
 * of that role from the configured capacity. Technicians and other staff are recorded and shown
 * but the engine has no resource for them. Shift times are informational.
 */

export class StaffError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StaffError";
  }
}

export const STAFF_ROLES = ["doctor", "nurse", "technician", "other"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export const AVAILABILITY_STATUSES = ["available", "busy", "on_leave", "unavailable", "training"] as const;
export type AvailabilityStatus = (typeof AVAILABILITY_STATUSES)[number];

export const ROLE_LABEL: Record<StaffRole, string> = {
  doctor: "Doctor",
  nurse: "Nurse",
  technician: "Technician",
  other: "Other staff",
};

export const STATUS_LABEL: Record<AvailabilityStatus, string> = {
  available: "Available",
  busy: "Busy",
  on_leave: "On leave",
  unavailable: "Unavailable",
  training: "Training / maintenance",
};

export interface StaffMember {
  id: string;
  name: string;
  role: StaffRole;
  department: string;
  specialization: string | null;
  /** "HH:MM", 24-hour. */
  shift_start: string;
  shift_end: string;
  availability_status: AvailabilityStatus;
  created_at: string;
  updated_at: string;
}

export interface StaffInput {
  name: string;
  role: StaffRole;
  department: string;
  specialization?: string | null;
  shift_start: string;
  shift_end: string;
  availability_status?: AvailabilityStatus;
}

export interface StaffAvailabilityEvent {
  id: string;
  staff_id: string;
  previous_status: AvailabilityStatus;
  new_status: AvailabilityStatus;
  /** Simulation minute the change takes effect at (0 when no run is being watched). */
  effective_time: number;
  reason: string;
  created_at: string;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export function validateStaffInput(input: StaffInput): StaffInput {
  if (typeof input.name !== "string" || input.name.trim() === "") throw new StaffError("Name is required.");
  if (!STAFF_ROLES.includes(input.role)) throw new StaffError("Choose a valid role.");
  if (typeof input.department !== "string" || input.department.trim() === "") throw new StaffError("Department is required.");
  if (!HHMM.test(input.shift_start) || !HHMM.test(input.shift_end)) {
    throw new StaffError("Shift times must look like 08:00.");
  }
  if (input.availability_status !== undefined && !AVAILABILITY_STATUSES.includes(input.availability_status)) {
    throw new StaffError("Choose a valid availability status.");
  }
  return {
    ...input,
    name: input.name.trim(),
    department: input.department.trim(),
    specialization: input.specialization?.trim() ? input.specialization.trim() : null,
  };
}

export function createStaff(input: StaffInput, id: string, now: string): StaffMember {
  const v = validateStaffInput(input);
  return {
    id,
    name: v.name,
    role: v.role,
    department: v.department,
    specialization: v.specialization ?? null,
    shift_start: v.shift_start,
    shift_end: v.shift_end,
    availability_status: v.availability_status ?? "available",
    created_at: now,
    updated_at: now,
  };
}

export function updateStaff(s: StaffMember, patch: Partial<StaffInput>, now: string): StaffMember {
  return {
    ...createStaff(
      {
        name: patch.name ?? s.name,
        role: patch.role ?? s.role,
        department: patch.department ?? s.department,
        specialization: patch.specialization === undefined ? s.specialization : patch.specialization,
        shift_start: patch.shift_start ?? s.shift_start,
        shift_end: patch.shift_end ?? s.shift_end,
        availability_status: patch.availability_status ?? s.availability_status,
      },
      s.id,
      s.created_at,
    ),
    updated_at: now,
  };
}

/** Only "available" staff can take a new treatment. Everything else is off the schedule. */
export const isAssignable = (s: Pick<StaffMember, "availability_status">): boolean =>
  s.availability_status === "available";

/** The engine resource a role stands behind, or null when the engine does not schedule that role. */
export function resourceForRole(role: StaffRole): ResourceKey | null {
  return role === "doctor" ? "doctor" : role === "nurse" ? "nurse" : null;
}

// ---- roster <-> Resources -----------------------------------------------------------------------------
//
// The number of doctors and nurses is set on the Resources page. The roster gives those units names:
// named people fill the positions in ID order, positions nobody has been named for show up as open
// ("Doctor 4"), and named people beyond the configured headcount stay on the list but are not
// scheduled. Nothing here is stored, so changing Resources changes the roster straight away.

export const OPEN_SLOT_PREFIX = "open-";

/** A position the Resources page counts but nobody has been named for yet. */
export const isOpenSlot = (s: Pick<StaffMember, "id">): boolean => s.id.startsWith(OPEN_SLOT_PREFIX);

const byId = (a: Pick<StaffMember, "id">, b: Pick<StaffMember, "id">) => a.id.localeCompare(b.id, undefined, { numeric: true });

function openSlot(role: "doctor" | "nurse", n: number): StaffMember {
  return {
    id: `${OPEN_SLOT_PREFIX}${role}-${n}`,
    name: `${ROLE_LABEL[role]} ${n}`,
    role,
    department: "Unassigned",
    specialization: null,
    shift_start: "08:00",
    shift_end: "20:00",
    availability_status: "available",
    created_at: "",
    updated_at: "",
  };
}

export interface AlignedRoster {
  /** Doctors and nurses up to the configured headcount (named people, then open positions), then everyone else. */
  scheduled: StaffMember[];
  /** Named doctors and nurses beyond the configured headcount: listed, but the engine has no unit for them. */
  surplus: StaffMember[];
}

export function alignRoster(staff: StaffMember[], resources: ResourceSet): AlignedRoster {
  const scheduled: StaffMember[] = [];
  const surplus: StaffMember[] = [];
  for (const role of STAFF_ROLES) {
    if (role !== "doctor" && role !== "nurse") {
      scheduled.push(...staff.filter((s) => s.role === role));
      continue;
    }
    const headcount = Math.max(0, resources[role]);
    const named = staff.filter((s) => s.role === role).sort(byId);
    scheduled.push(...named.slice(0, headcount));
    surplus.push(...named.slice(headcount));
    for (let n = named.length + 1; n <= headcount; n++) scheduled.push(openSlot(role, n));
  }
  return { scheduled, surplus };
}

/** Configured capacity minus the scheduled doctors and nurses who are not available right now. */
export function effectiveResources(base: ResourceSet, staff: StaffMember[]): ResourceSet {
  const out = { ...base };
  for (const s of alignRoster(staff, base).scheduled) {
    const key = resourceForRole(s.role);
    if (key && !isAssignable(s)) out[key] = Math.max(0, out[key] - 1);
  }
  return out;
}

export interface StatusChange {
  staff: StaffMember;
  event: Omit<StaffAvailabilityEvent, "id" | "created_at">;
  /** What the engine should do about it; null for roles it does not schedule or a no-op change. */
  availability: AvailabilityChange | null;
}

/**
 * Change one person's status from a given simulation minute. A person who was already off the
 * schedule (on leave -> unavailable) changes nothing for the engine; only crossing the
 * available/not-available line adds or removes a unit.
 */
export function changeAvailability(
  s: StaffMember,
  next: AvailabilityStatus,
  effectiveTime: number,
  reason: string,
  now: string,
  /** False for a named person beyond the Resources headcount: their status is recorded but capacity does not move. */
  scheduled = true,
): StatusChange {
  if (!AVAILABILITY_STATUSES.includes(next)) throw new StaffError("Choose a valid availability status.");
  if (!Number.isInteger(effectiveTime) || effectiveTime < 0) {
    throw new StaffError("The change must take effect at a whole minute of 0 or more.");
  }
  const wasAssignable = isAssignable(s);
  const willBeAssignable = next === "available";
  const resource = resourceForRole(s.role);
  return {
    staff: { ...s, availability_status: next, updated_at: now },
    event: { staff_id: s.id, previous_status: s.availability_status, new_status: next, effective_time: effectiveTime, reason },
    availability:
      resource && scheduled && wasAssignable !== willBeAssignable
        ? { time: effectiveTime, resource, delta: willBeAssignable ? 1 : -1, staff_id: s.id, reason: reason || undefined }
        : null,
  };
}

/**
 * Who is treating whom at minute `t`, for display only. The engine works with counts, so this is
 * a deterministic mapping: in-treatment patients (earliest start first) take assignable doctors
 * and nurses in id order. It lets the roster show "currently with P003" and warn before someone
 * who is mid-treatment is switched off.
 */
export function assignmentsAt(patients: PatientOutcome[], staff: StaffMember[], t: number): Map<string, string[]> {
  const result = new Map<string, string[]>();
  const active = patients
    .filter((p) => p.start_time !== null && p.start_time <= t && (p.end_time ?? 0) > t)
    .sort((a, b) => a.start_time! - b.start_time! || a.id.localeCompare(b.id));
  for (const role of ["doctor", "nurse"] as const) {
    const pool = staff
      .filter((s) => s.role === role && (isAssignable(s) || s.availability_status === "busy"))
      .sort(byId);
    let next = 0;
    for (const p of active) {
      const need = p.required_resources[role] ?? 0;
      for (let i = 0; i < need && next < pool.length; i++, next++) {
        result.set(pool[next].id, [...(result.get(pool[next].id) ?? []), p.id]);
      }
    }
  }
  return result;
}

export interface StaffSummary {
  total: number;
  available: number;
  busy: number;
  onLeave: number;
  unavailable: number;
  training: number;
  byRole: Record<StaffRole, { total: number; available: number }>;
}

export function summarizeStaff(staff: StaffMember[]): StaffSummary {
  const byRole = Object.fromEntries(STAFF_ROLES.map((r) => [r, { total: 0, available: 0 }])) as StaffSummary["byRole"];
  for (const s of staff) {
    byRole[s.role].total++;
    if (isAssignable(s)) byRole[s.role].available++;
  }
  const count = (status: AvailabilityStatus) => staff.filter((s) => s.availability_status === status).length;
  return {
    total: staff.length,
    available: count("available"),
    busy: count("busy"),
    onLeave: count("on_leave"),
    unavailable: count("unavailable"),
    training: count("training"),
    byRole,
  };
}

export interface StaffFilter {
  role?: string;
  department?: string;
  status?: string;
  query?: string;
}

export function filterStaff(list: StaffMember[], f: StaffFilter): StaffMember[] {
  const q = (f.query ?? "").trim().toLowerCase();
  return list.filter(
    (s) =>
      (!f.role || s.role === f.role) &&
      (!f.department || s.department === f.department) &&
      (!f.status || s.availability_status === f.status) &&
      (q === "" || [s.name, s.department, s.specialization ?? ""].some((x) => x.toLowerCase().includes(q))),
  );
}

// ---- example data (roles and shifts adapted from the friend prototype's roster) ---------------------

const EXAMPLE_TIME = "2026-01-01T00:00:00.000Z";

function example(id: string, name: string, role: StaffRole, department: string, specialization: string | null): StaffMember {
  return {
    id,
    name,
    role,
    department,
    specialization,
    shift_start: "08:00",
    shift_end: "20:00",
    availability_status: "available",
    created_at: EXAMPLE_TIME,
    updated_at: EXAMPLE_TIME,
  };
}

/** Five doctors and ten nurses match DEFAULT_RESOURCES, so an untouched roster changes nothing. */
export const EXAMPLE_STAFF: StaffMember[] = [
  example("D01", "Dr. Arjun Rao", "doctor", "Emergency", "Emergency medicine"),
  example("D02", "Dr. Meera Iyer", "doctor", "Cardiology", "Cardiology"),
  example("D03", "Dr. Kabir Shah", "doctor", "Surgery", "General surgery"),
  example("D04", "Dr. Lena Fernandes", "doctor", "ICU", "Critical care"),
  example("D05", "Dr. Omar Siddiqui", "doctor", "General Medicine", null),
  ...["Priya Sharma", "Anita Desai", "Ravi Nair", "Sunita Menon", "Farah Khan", "John Mathew", "Divya Pillai", "Karan Bose", "Neha Kulkarni", "Tara George"].map(
    (name, i) => example(`N${String(i + 1).padStart(2, "0")}`, name, "nurse", i < 3 ? "Emergency" : i < 6 ? "ICU" : "Ward", null),
  ),
  example("T01", "Vikram Joshi", "technician", "Radiology", "Imaging"),
  example("T02", "Isha Rao", "technician", "Laboratory", "Pathology"),
];

// ---- random staff (used by the demo) ---------------------------------------------------------------

const FIRST_NAMES = [
  "Aisha", "Alejandro", "Amara", "Ben", "Camila", "Chen", "Daniel", "Elena", "Farid", "Grace", "Hana", "Ibrahim", "Ingrid", "Jamal", "Keiko",
  "Liam", "Mateo", "Mei", "Nadia", "Noah", "Olga", "Priya", "Rafael", "Sara", "Sofia", "Tariq", "Uma", "Victor", "Wei", "Yara", "Zoe", "Arjun",
  "Fatima", "Hugo", "Leila", "Marcus", "Nina", "Omar", "Rohan", "Talia",
];
const LAST_NAMES = [
  "Abbott", "Alvarez", "Banerjee", "Bianchi", "Chowdhury", "Costa", "Dubois", "Eriksen", "Farouk", "Gupta", "Hoffman", "Ito", "Jensen", "Kaur",
  "Kowalski", "Lindqvist", "Malik", "Nakamura", "Okafor", "Petrov", "Quinn", "Reyes", "Silva", "Tanaka", "Umar", "Volkov", "Walsh", "Xu",
  "Yilmaz", "Zhang", "Bello", "Novak", "Ferreira", "Haddad", "Larsen", "Mehta",
];

/** A doctor's profession: the department they work in and what they specialise in. */
const DOCTOR_PROFESSIONS: { department: string; specialization: string }[] = [
  { department: "Emergency", specialization: "Emergency medicine" },
  { department: "Cardiology", specialization: "Cardiologist" },
  { department: "Surgery", specialization: "General surgeon" },
  { department: "ICU", specialization: "Intensivist" },
  { department: "Neurology", specialization: "Neurologist" },
  { department: "Orthopedics", specialization: "Orthopedic surgeon" },
  { department: "Pulmonology", specialization: "Pulmonologist" },
  { department: "Anesthesiology", specialization: "Anesthesiologist" },
  { department: "Pediatrics", specialization: "Pediatrician" },
  { department: "Radiology", specialization: "Radiologist" },
  { department: "Internal Medicine", specialization: "Internist" },
  { department: "Oncology", specialization: "Oncologist" },
];

const NURSE_PROFESSIONS: { department: string; specialization: string }[] = [
  { department: "Emergency", specialization: "Emergency nurse" },
  { department: "ICU", specialization: "Critical care nurse" },
  { department: "Ward", specialization: "Ward nurse" },
  { department: "Surgery", specialization: "Theatre nurse" },
  { department: "Cardiology", specialization: "Cardiac nurse" },
  { department: "Pediatrics", specialization: "Pediatric nurse" },
];

export interface GenerateStaffOptions {
  /** Uniform [0, 1); defaults to Math.random. Pass a seeded one for repeatable output. */
  rng?: () => number;
  /** Names already on the roster, compared case-insensitively, so nobody is generated twice. */
  takenNames?: Iterable<string>;
  makeId: () => string;
  now: string;
}

/** `count` new doctors or nurses, each with a random unique name and a random profession. */
export function generateStaff(role: "doctor" | "nurse", count: number, opts: GenerateStaffOptions): StaffMember[] {
  const rng = opts.rng ?? Math.random;
  const pick = <T,>(list: readonly T[]): T => list[Math.min(list.length - 1, Math.floor(rng() * list.length))];
  const taken = new Set([...(opts.takenNames ?? [])].map((n) => n.toLowerCase()));
  const professions = role === "doctor" ? DOCTOR_PROFESSIONS : NURSE_PROFESSIONS;
  const out: StaffMember[] = [];
  for (let i = 0; i < count; i++) {
    let name = "";
    for (let attempt = 0; attempt < 50; attempt++) {
      const person = `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;
      name = role === "doctor" ? `Dr. ${person}` : person;
      if (!taken.has(name.toLowerCase())) break;
    }
    // Vanishingly unlikely: 50 collisions in a row. Number it rather than duplicate someone.
    if (taken.has(name.toLowerCase())) name = `${name} ${taken.size + 1}`;
    taken.add(name.toLowerCase());
    const { department, specialization } = pick(professions);
    out.push({
      id: opts.makeId(),
      name,
      role,
      department,
      specialization,
      shift_start: "08:00",
      shift_end: "20:00",
      availability_status: "available",
      created_at: opts.now,
      updated_at: opts.now,
    });
  }
  return out;
}
