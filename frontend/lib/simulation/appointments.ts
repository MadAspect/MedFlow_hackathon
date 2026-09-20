import { emptyResourceSet } from "./resources";
import { RESOURCE_KEYS, type ResourceKey, type ResourceRequest, type ResourceSet } from "./types";

export const APPOINTMENT_GRACE = 10;

export const DAY_START_MINUTES = 8 * 60;

export const SLOT_STEP = 5;

export function slotLabel(minute: number): string {
  const total = DAY_START_MINUTES + Math.max(0, Math.round(minute));
  const days = Math.floor(total / 1440);
  const inDay = total % 1440;
  const hh = String(Math.floor(inDay / 60)).padStart(2, "0");
  const mm = String(inDay % 60).padStart(2, "0");
  return `${hh}:${mm}${days > 0 ? ` +${days}d` : ""}`;
}

export interface Booking {
  id: string;
  start: number;
  duration: number;
  need: ResourceRequest;
}

export function bookedDemandAt(bookings: Booking[], minute: number): ResourceSet {
  const demand = emptyResourceSet();
  for (const b of bookings) {
    if (b.start <= minute && minute < b.start + b.duration) {
      for (const k of RESOURCE_KEYS) demand[k] += b.need[k] ?? 0;
    }
  }
  return demand;
}

export interface SlotCheck {
  impossible: { resource: ResourceKey; needed: number; capacity: number }[];
  overbooked: { minute: number; resource: ResourceKey; demand: number; capacity: number } | null;
  overlapping: string[];
}

export function checkSlot(existing: Booking[], candidate: Booking, capacity: ResourceSet): SlotCheck {
  const impossible = RESOURCE_KEYS.filter((k) => (candidate.need[k] ?? 0) > capacity[k]).map((k) => ({
    resource: k,
    needed: candidate.need[k] ?? 0,
    capacity: capacity[k],
  }));

  const end = candidate.start + candidate.duration;
  const others = existing.filter((b) => b.id !== candidate.id);
  const overlapping = others.filter((b) => b.start < end && candidate.start < b.start + b.duration);

  const probes = [candidate.start, ...overlapping.map((b) => b.start).filter((s) => s > candidate.start && s < end)].sort(
    (a, b) => a - b,
  );
  let overbooked: SlotCheck["overbooked"] = null;
  for (const minute of probes) {
    const demand = bookedDemandAt([...overlapping, candidate], minute);
    const over = RESOURCE_KEYS.find((k) => demand[k] > capacity[k] && (candidate.need[k] ?? 0) <= capacity[k]);
    if (over) {
      overbooked = { minute, resource: over, demand: demand[over], capacity: capacity[over] };
      break;
    }
  }
  return { impossible, overbooked, overlapping: overlapping.map((b) => b.id) };
}

export const slotIsFree = (c: SlotCheck) => c.impossible.length === 0 && c.overbooked === null;

export function suggestSlot(
  existing: Booking[],
  need: ResourceRequest,
  duration: number,
  capacity: ResourceSet,
  from: number,
  horizon = 1440,
): number | null {
  const start = Math.max(0, Math.ceil(from / SLOT_STEP) * SLOT_STEP);
  for (let s = start; s <= start + horizon; s += SLOT_STEP) {
    const c = checkSlot(existing, { id: "", start: s, duration, need }, capacity);
    if (c.impossible.length > 0) return null;
    if (c.overbooked === null) return s;
  }
  return null;
}
