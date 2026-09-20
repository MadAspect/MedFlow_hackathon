import { alignRoster, assignmentsAt, isAssignable, isOpenSlot, type StaffMember } from "./staff";
import type { PatientOutcome, ResourceSet, SimulationOutput, StockRequirement } from "./simulation/types";

/**
 * Who is treating whom at a given minute, and how much stock is left, for display only. The
 * engine schedules counts, so the doctor-to-patient mapping comes from assignmentsAt (a stable
 * mapping, not something the engine decided) and stock is replayed from the start and end times
 * the engine did decide.
 */

export interface StockLine {
  item_type: StockRequirement["item_type"];
  item_id: string;
  name: string;
  quantity: number;
  /** Medicine: units still in stock. Equipment: units not held by anyone. */
  left: number;
  /** Medicine: stock at the start of the run. Equipment: operable units. */
  total: number;
}

export interface DoctorTask {
  patient: PatientOutcome;
  minutes_left: number;
  stock: StockLine[];
}

export interface DoctorWorkload {
  id: string;
  name: string;
  detail: string | null;
  state: "treating" | "free" | "off_duty";
  tasks: DoctorTask[];
}

const inTreatment = (p: PatientOutcome, t: number) => p.start_time !== null && p.start_time <= t && (p.end_time ?? 0) > t;

/** Stock left at minute `t`, or null when the run did not track stock. */
export function stockAt(output: SimulationOutput, t: number) {
  const stock = output.params.stock;
  if (!stock) return null;
  const medicines = new Map(Object.entries(stock.medicines).map(([id, m]) => [id, m.quantity]));
  const equipment = new Map(Object.entries(stock.equipment).map(([id, e]) => [id, e.units]));
  for (const p of output.patients) {
    if (p.start_time === null || p.start_time > t) continue;
    for (const r of p.stock_requirements ?? []) {
      if (r.item_type === "medicine") {
        medicines.set(r.item_id, (medicines.get(r.item_id) ?? 0) - r.quantity);
      } else if (inTreatment(p, t)) {
        equipment.set(r.item_id, (equipment.get(r.item_id) ?? 0) - r.quantity);
      }
    }
  }
  return { medicines, equipment };
}

function stockLines(output: SimulationOutput, p: PatientOutcome, left: NonNullable<ReturnType<typeof stockAt>>): StockLine[] {
  const stock = output.params.stock;
  if (!stock) return [];
  return (p.stock_requirements ?? []).map((r) => {
    const isMedicine = r.item_type === "medicine";
    const item = isMedicine ? stock.medicines[r.item_id] : stock.equipment[r.item_id];
    return {
      item_type: r.item_type,
      item_id: r.item_id,
      name: item?.name ?? r.item_id,
      quantity: r.quantity,
      left: Math.max(0, (isMedicine ? left.medicines : left.equipment).get(r.item_id) ?? 0),
      total: item ? ("quantity" in item ? item.quantity : item.units) : 0,
    };
  });
}

/**
 * One row per doctor the Resources page counts: named doctors first, then numbered open positions
 * ("Doctor 4"). Open positions are only listed while the hospital still has that capacity at
 * minute `t`, so a doctor going off duty or a staff-shortage failure removes a row.
 * `configured` is the headcount from Resources; the run's own `resources` already has unavailable
 * staff taken off, so it is only the fallback.
 */
export function doctorWorkloads(
  output: SimulationOutput,
  staff: StaffMember[],
  t: number,
  configured: ResourceSet = output.resources,
): DoctorWorkload[] {
  const slots = alignRoster(staff, configured).scheduled.filter((s) => s.role === "doctor");
  const capacity = output.timeline[t]?.capacity.doctor ?? output.resources.doctor;
  const named = slots.filter((s) => !isOpenSlot(s));
  const open = slots.filter(isOpenSlot);
  const namedWorking = named.filter(isAssignable).length;
  const doctors = [...named, ...open.slice(0, Math.max(0, capacity - namedWorking))];

  const assigned = assignmentsAt(output.patients, doctors, t);
  const left = stockAt(output, t);
  const byId = new Map(output.patients.map((p) => [p.id, p]));

  return [...doctors]
    .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))
    .map((d) => {
      const tasks: DoctorTask[] = (assigned.get(d.id) ?? []).flatMap((pid) => {
        const p = byId.get(pid);
        return p ? [{ patient: p, minutes_left: (p.end_time ?? t) - t, stock: left ? stockLines(output, p, left) : [] }] : [];
      });
      const state = tasks.length > 0 ? "treating" : isAssignable(d) || d.availability_status === "busy" ? "free" : "off_duty";
      return { id: d.id, name: d.name, detail: isOpenSlot(d) ? null : (d.specialization ?? (d.department || null)), state, tasks };
    });
}
