import { isPreAlerted, MAX_AMBULANCE_MINUTES } from "./ambulance";
import { APPOINTMENT_GRACE } from "./appointments";
import { buildWarnings, computeMetrics } from "./metrics";
import { DEFAULT_WEIGHTS, rankQueue, scoreBreakdown } from "./policies";
import { RESOURCE_LABELS, cloneResourceSet, emptyResourceSet } from "./resources";
import { generateSurgePatients } from "./surge";
import {
  RESOURCE_KEYS,
  type Decision,
  type OutcomeStatus,
  type PatientOutcome,
  type ResourceKey,
  type ResourceSet,
  type SimParams,
  type SimPatient,
  type SimulationOutput,
  type SkippedCandidate,
  type StockBlock,
  type StockOutcome,
  type StockRequirement,
  type TimelinePoint,
} from "./types";

export const ENGINE_NAME = "waitless-ts-discrete-v2";

interface Reservation {
  shadow: number;
  spare: ResourceSet;
}

export class SimulationInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SimulationInputError";
  }
}

export function defaultParams(overrides: Partial<SimParams> = {}): SimParams {
  return {
    strategy: "dynamic",
    duration: 120,
    emergencySurge: false,
    surgeStart: 20,
    surgeCount: 10,
    resourceFailure: false,
    failedResource: "icu_bed",
    failureStart: 35,
    failureUnits: 1,
    safetyThreshold: 30,
    criticalUrgency: 4,
    protectAppointments: true,
    ...overrides,
    weights: { ...DEFAULT_WEIGHTS, ...(overrides.weights ?? {}) },
  };
}

const isNonNegInt = (n: unknown): n is number =>
  typeof n === "number" && Number.isInteger(n) && n >= 0;

export function assertValidInput(
  patients: SimPatient[],
  resources: ResourceSet,
  params: SimParams,
): void {
  for (const k of RESOURCE_KEYS) {
    if (!isNonNegInt(resources[k])) {
      throw new SimulationInputError(
        `Resource "${k}" must be an integer >= 0 (got ${String(resources[k])}).`,
      );
    }
  }
  if (!Number.isInteger(params.duration) || params.duration < 1) {
    throw new SimulationInputError("Simulation duration must be an integer >= 1 minute.");
  }
  if (!isNonNegInt(params.surgeStart) || !isNonNegInt(params.failureStart)) {
    throw new SimulationInputError("Surge and failure start times must be integers >= 0.");
  }
  if (!isNonNegInt(params.failureUnits) || !isNonNegInt(params.surgeCount)) {
    throw new SimulationInputError("Failure units and surge size must be integers >= 0.");
  }
  for (const c of params.availability ?? []) {
    if (!isNonNegInt(c.time) || !Number.isInteger(c.delta) || !RESOURCE_KEYS.includes(c.resource)) {
      throw new SimulationInputError("Availability changes need an integer minute >= 0, a resource and a whole-number change.");
    }
  }
  for (const w of Object.values(params.weights)) {
    if (!Number.isFinite(w)) throw new SimulationInputError("Weights must be finite numbers.");
  }

  const seen = new Set<string>();
  for (const p of patients) {
    if (typeof p.id !== "string" || p.id.trim() === "") {
      throw new SimulationInputError("Every patient needs a non-empty id.");
    }
    if (seen.has(p.id)) throw new SimulationInputError(`Duplicate patient id "${p.id}".`);
    seen.add(p.id);
    if (!isNonNegInt(p.arrival_time)) {
      throw new SimulationInputError(`Patient ${p.id}: arrival time must be an integer >= 0.`);
    }
    if (p.ambulance !== undefined) {
      const alert = p.ambulance.alert_time;
      if (!isNonNegInt(alert) || alert > p.arrival_time) {
        throw new SimulationInputError(
          `Patient ${p.id}: the ambulance pre-alert must be a whole minute from 0 up to the arrival time (got ${String(alert)}).`,
        );
      }
      if (p.arrival_time - alert > MAX_AMBULANCE_MINUTES) {
        throw new SimulationInputError(`Patient ${p.id}: the ambulance journey cannot be longer than ${MAX_AMBULANCE_MINUTES} minutes.`);
      }
      if (p.appointment === true) {
        throw new SimulationInputError(`Patient ${p.id} cannot be both a booked appointment and an ambulance arrival.`);
      }
    }
    if (!Number.isInteger(p.urgency) || p.urgency < 1 || p.urgency > 5) {
      throw new SimulationInputError(`Patient ${p.id}: urgency must be an integer from 1 to 5.`);
    }
    if (!Number.isInteger(p.treatment_time) || p.treatment_time <= 0) {
      throw new SimulationInputError(`Patient ${p.id}: treatment time must be an integer > 0.`);
    }
    for (const r of p.stock_requirements ?? []) {
      if (r.item_type !== "medicine" && r.item_type !== "equipment") {
        throw new SimulationInputError(`Patient ${p.id}: a stock requirement must be a medicine or equipment.`);
      }
      if (typeof r.item_id !== "string" || r.item_id.trim() === "") {
        throw new SimulationInputError(`Patient ${p.id}: a stock requirement needs an item id.`);
      }
      if (!Number.isInteger(r.quantity) || r.quantity <= 0) {
        throw new SimulationInputError(`Patient ${p.id}: stock quantity for "${r.item_id}" must be an integer > 0.`);
      }
    }
    let needsSomething = false;
    for (const k of RESOURCE_KEYS) {
      const need = p.required_resources[k] ?? 0;
      if (!isNonNegInt(need)) {
        throw new SimulationInputError(`Patient ${p.id}: "${k}" must be an integer >= 0.`);
      }
      if (need > 0) needsSomething = true;
    }
    if (!needsSomething) {
      throw new SimulationInputError(`Patient ${p.id}: at least one resource is required.`);
    }
  }
}

export function runSimulation(
  patients: SimPatient[],
  resources: ResourceSet,
  paramOverrides: Partial<SimParams> = {},
): SimulationOutput {
  const params = defaultParams(paramOverrides);
  const surge = params.emergencySurge
    ? generateSurgePatients(params.surgeStart, params.surgeCount)
    : [];
  const all: SimPatient[] = [...patients, ...surge].map((p) => ({
    ...p,
    required_resources: { ...p.required_resources },
  }));
  assertValidInput(all, resources, params);

  const n = all.length;
  const { duration } = params;
  const startTime: (number | null)[] = new Array(n).fill(null);
  const decisions: (Decision | null)[] = new Array(n).fill(null);
  const everBlocked: boolean[] = new Array(n).fill(false);
  const blockedMinutes = emptyResourceSet();
  const blockedPatientSets = new Map<ResourceKey, Set<number>>(
    RESOURCE_KEYS.map((k) => [k, new Set<number>()]),
  );
  const patientBlocked: ResourceSet[] = all.map(() => emptyResourceSet());
  const inUse = emptyResourceSet();
  const running: number[] = [];
  let queue: number[] = [];
  let treatedCount = 0;
  let seq = 0;

  interface Snapshot {
    t: number;
    queue_length: number;
    in_treatment: number;
    treated: number;
    in_use: ResourceSet;
    bottleneck: ResourceKey | null;
  }
  const snapshots: Snapshot[] = [];

  const failedUnits = params.resourceFailure
    ? Math.min(params.failureUnits, resources[params.failedResource])
    : 0;

  const availability = [...(params.availability ?? [])].sort((a, b) => a.time - b.time);

  // `known` is the minute the decision is taken at: a staff change is unforeseen, so a decision
  // never looks ahead to one (history before a change is identical with or without it).
  const allocationCapacity = (t: number, known = Infinity): ResourceSet => {
    const cap = cloneResourceSet(resources);
    if (failedUnits > 0 && t >= params.failureStart) {
      cap[params.failedResource] -= failedUnits;
    }
    for (const c of availability) {
      if (c.time <= t && c.time <= known) cap[c.resource] += c.delta;
    }
    for (const k of RESOURCE_KEYS) cap[k] = Math.max(0, cap[k]);
    return cap;
  };

  // Stock constraints (optional). Medicines are consumed when a treatment starts and never come
  // back; equipment units are held for the treatment and returned when it ends.
  const stockOn = params.stock !== undefined;
  const stockReq: StockRequirement[][] = all.map((p) => (stockOn ? (p.stock_requirements ?? []) : []));
  const stockKey = (r: StockRequirement) => `${r.item_type}:${r.item_id}`;
  const medicineLeft = new Map<string, number>(
    Object.entries(params.stock?.medicines ?? {}).map(([id, m]) => [`medicine:${id}`, m.quantity]),
  );
  const equipmentHeld = new Map<string, number>();
  const equipmentPeak = new Map<string, number>();
  const stockName = (key: string): string => {
    const [type, ...rest] = key.split(":");
    const id = rest.join(":");
    return (type === "medicine" ? params.stock?.medicines[id]?.name : params.stock?.equipment[id]?.name) ?? id;
  };
  const stockShort = (i: number): string[] => {
    const short: string[] = [];
    for (const r of stockReq[i]) {
      const key = stockKey(r);
      if (r.item_type === "medicine") {
        if ((medicineLeft.get(key) ?? -1) < r.quantity) short.push(key);
      } else {
        const item = params.stock!.equipment[r.item_id];
        if (!item || item.units - (equipmentHeld.get(key) ?? 0) < r.quantity) short.push(key);
      }
    }
    return short;
  };
  const stockBlockedMinutes = new Map<string, number>();
  const stockBlockedPatients = new Map<string, Set<number>>();
  const patientStockBlocked: Map<string, number>[] = all.map(() => new Map<string, number>());

  const arrivalOrder = all
    .map((_, i) => i)
    .sort((a, b) => all[a].arrival_time - all[b].arrival_time || a - b);
  let arrivalPtr = 0;

  const shortages = (need: SimPatient["required_resources"], cap: ResourceSet) =>
    RESOURCE_KEYS.filter((k) => (need[k] ?? 0) > cap[k] - inUse[k]);

  const bindingResource = (
    need: SimPatient["required_resources"],
    short: ResourceKey[],
    cap: ResourceSet,
  ): ResourceKey => {
    const releases = running
      .map((idx) => ({ end: startTime[idx]! + all[idx].treatment_time, idx }))
      .sort((a, b) => a.end - b.end);
    let binding = short[0];
    let latest = -1;
    for (const k of short) {
      const required = need[k] ?? 0;
      let time = Infinity;
      if (required <= cap[k]) {
        let free = cap[k] - inUse[k];
        time = 0;
        for (const r of releases) {
          if (free >= required) break;
          free += all[r.idx].required_resources[k] ?? 0;
          time = r.end;
        }
      }
      // Ties (units freed by the same patient) blame the scarcer resource.
      if (time > latest || (time === latest && cap[k] < cap[binding])) {
        latest = time;
        binding = k;
      }
    }
    return binding;
  };

  const reserveFor = (need: SimPatient["required_resources"], cap: ResourceSet, now: number): Reservation | null => {
    const free = emptyResourceSet();
    for (const k of RESOURCE_KEYS) free[k] = cap[k] - inUse[k];
    const fits = () => RESOURCE_KEYS.every((k) => free[k] >= (need[k] ?? 0));
    const releases = running
      .map((idx) => ({ end: startTime[idx]! + all[idx].treatment_time, idx }))
      .sort((a, b) => a.end - b.end);
    let shadow = now;
    for (let i = 0; i < releases.length && !fits(); i++) {
      shadow = releases[i].end;
      while (i < releases.length && releases[i].end === shadow) {
        for (const k of RESOURCE_KEYS) free[k] += all[releases[i].idx].required_resources[k] ?? 0;
        i++;
      }
      i--;
    }
    if (!fits()) return null;
    const spare = emptyResourceSet();
    for (const k of RESOURCE_KEYS) spare[k] = free[k] - (need[k] ?? 0);
    return { shadow, spare };
  };
  const useReservation = params.reservation === true;

  // Appointments (and ambulances once alerted) are known ahead of time, so walk-ins are held
  // back if they would still occupy resources when the booked patient needs them. Only
  // urgency 5 is never held; critical and surge patients get APPOINTMENT_GRACE minutes of slack.
  const protectsAppointments = params.protectAppointments !== false;
  const isExpected = (p: SimPatient) => (p.appointment === true && protectsAppointments) || isPreAlerted(p, params.preAlert);
  const knownAt = (p: SimPatient) => p.ambulance?.alert_time ?? 0;
  const slots = arrivalOrder.filter((i) => isExpected(all[i]));
  const neverHeld = (p: SimPatient) => p.urgency >= 5;
  const holdSlack = (p: SimPatient) => (p.urgency >= params.criticalUrgency || p.emergency === true ? APPOINTMENT_GRACE : 0);
  const heldMinutes: number[] = new Array(n).fill(0);
  const heldFor: (string | null)[] = new Array(n).fill(null);

  const usageAt = (at: number): ResourceSet => {
    const used = emptyResourceSet();
    for (const idx of running) {
      if (startTime[idx]! + all[idx].treatment_time > at) {
        for (const k of RESOURCE_KEYS) used[k] += all[idx].required_resources[k] ?? 0;
      }
    }
    return used;
  };

  const holdFor = (cand: SimPatient, now: number): string | null => {
    const end = now + cand.treatment_time;
    const slack = holdSlack(cand);
    for (const fi of slots) {
      const f = all[fi];
      const check = f.arrival_time + slack;
      if (f.arrival_time <= now || check >= end || knownAt(f) > now) continue;
      const capAtSlot = allocationCapacity(check, now);
      const used = usageAt(check);
      // Other appointments due at the same time need their units as well.
      for (const gi of slots) {
        const g = all[gi];
        if (gi === fi || startTime[gi] !== null || knownAt(g) > now) continue;
        if (g.arrival_time <= check && check < g.arrival_time + g.treatment_time) {
          for (const k of RESOURCE_KEYS) used[k] += g.required_resources[k] ?? 0;
        }
      }
      const fits = (withCand: boolean) =>
        RESOURCE_KEYS.every(
          (k) => used[k] + (withCand ? (cand.required_resources[k] ?? 0) : 0) + (f.required_resources[k] ?? 0) <= capAtSlot[k],
        );
      if (fits(false) && !fits(true)) return f.id;
    }
    return null;
  };

  const promoteAppointments = (ranked: ReturnType<typeof rankQueue>) => {
    if (!ranked.some((c) => isExpected(c.patient))) return ranked;
    const first = ranked.findIndex((c) => !isExpected(c.patient) && !neverHeld(c.patient));
    if (first < 0) return ranked;
    const tail = ranked.slice(first);
    return [
      ...ranked.slice(0, first),
      ...tail.filter((c) => isExpected(c.patient)),
      ...tail.filter((c) => !isExpected(c.patient)),
    ];
  };

  // Why a waiting patient can never start on stock alone (used when nothing is left to release).
  const stockReasons = (p: SimPatient): string[] => {
    const reasons: string[] = [];
    if (!stockOn) return reasons;
    for (const r of p.stock_requirements ?? []) {
      const key = stockKey(r);
      const label = stockName(key);
      if (r.item_type === "medicine") {
        if (!medicineLeft.has(key)) {
          reasons.push(`${r.quantity} ${label} but that medicine is not in the inventory`);
        } else if (medicineLeft.get(key)! < r.quantity) {
          reasons.push(`${r.quantity} ${label} but only ${medicineLeft.get(key)} remain (stock is not replenished during a run)`);
        }
      } else {
        const item = params.stock!.equipment[r.item_id];
        if (!item) reasons.push(`${r.quantity} ${label} but that equipment is not in the inventory`);
        else if (item.units < r.quantity) reasons.push(`${r.quantity} ${label} but only ${item.units} operable unit(s) exist`);
      }
    }
    return reasons;
  };

  let t = 0;
  let stopTime = 0;
  let error: string | null = null;
  const maxIterations = 4 * n + 16 + 2 * availability.length;

  for (let iteration = 0; ; iteration++) {
    if (iteration > maxIterations) {
      error = "Simulation did not converge: the event loop exceeded its safety limit.";
      stopTime = t;
      break;
    }

    while (arrivalPtr < n && all[arrivalOrder[arrivalPtr]].arrival_time <= t) {
      queue.push(arrivalOrder[arrivalPtr++]);
    }

    for (let r = running.length - 1; r >= 0; r--) {
      const idx = running[r];
      if (startTime[idx]! + all[idx].treatment_time <= t) {
        for (const k of RESOURCE_KEYS) inUse[k] -= all[idx].required_resources[k] ?? 0;
        for (const req of stockReq[idx]) {
          if (req.item_type === "equipment") {
            const key = stockKey(req);
            equipmentHeld.set(key, (equipmentHeld.get(key) ?? 0) - req.quantity);
          }
        }
        running.splice(r, 1);
        treatedCount++;
      }
    }

    const cap = allocationCapacity(t);
    const heldNow: { index: number; appointment: string }[] = [];

    if (queue.length > 0) {
      const queueLength = queue.length;
      const policyOrder = rankQueue(
        queue.map((index) => ({ index, patient: all[index] })),
        t,
        params,
        cap,
      );
      const ranked = slots.length > 0 ? promoteAppointments(policyOrder) : policyOrder;
      const skipped: SkippedCandidate[] = [];
      const startedNow = new Set<number>();
      // Set by the first ranked patient who cannot start (reservation backfilling).
      let reserved: Reservation | null = null;
      let headBlocked = false;

      for (const cand of ranked) {
        const need = cand.patient.required_resources;
        const short = shortages(need, cap);
        const stockShortNow = stockOn ? stockShort(cand.index) : [];
        if (short.length > 0 && !headBlocked) {
          headBlocked = true;
          // Only a head that has earned it holds resources back: critical, an
          // emergency, or already past the safety limit. Reserving for everyone
          // just leaves resources idle and raises the average wait.
          const p = cand.patient;
          const deserves =
            p.urgency >= params.criticalUrgency ||
            p.emergency === true ||
            t - p.arrival_time > params.safetyThreshold;
          // A blocked booked appointment is always protected: walk-ins may only jump ahead of it
          // if that cannot delay it, so smaller cases cannot keep taking the units it waits for.
          const apptReservation = slots.length > 0 && isExpected(p);
          if ((useReservation && deserves) || apptReservation) reserved = reserveFor(need, cap, t);
        }
        // Atomic: every resource and every stock item must be available, or nothing is taken.
        if (short.length === 0 && stockShortNow.length === 0) {
          if (slots.length > 0 && !isExpected(cand.patient) && !neverHeld(cand.patient)) {
            const holding = holdFor(cand.patient, t);
            if (holding !== null) {
              heldNow.push({ index: cand.index, appointment: holding }); // stays queued, not resource-blocked
              continue;
            }
          }
          if (reserved) {
            // May jump the blocked head only if it cannot delay the head's start.
            const endsInTime = t + cand.patient.treatment_time <= reserved.shadow;
            const fitsInSpare = RESOURCE_KEYS.every((k) => (need[k] ?? 0) <= reserved!.spare[k]);
            if (!endsInTime && !fitsInSpare) continue; // stays queued, not resource-blocked
            if (!endsInTime) for (const k of RESOURCE_KEYS) reserved.spare[k] -= need[k] ?? 0;
          }
          const availableBefore = emptyResourceSet();
          for (const k of RESOURCE_KEYS) availableBefore[k] = cap[k] - inUse[k];
          decisions[cand.index] = {
            seq: seq++,
            time: t,
            score: cand.score,
            required: { ...need },
            available_before: availableBefore,
            queue_length: queueLength,
            skipped: skipped.map((s) => ({ ...s, blocked_by: [...s.blocked_by] })),
          };
          for (const k of RESOURCE_KEYS) inUse[k] += need[k] ?? 0;
          if (stockReq[cand.index].length > 0) {
            decisions[cand.index]!.stock_used = stockReq[cand.index].map((r) => ({ ...r }));
            for (const req of stockReq[cand.index]) {
              const key = stockKey(req);
              if (req.item_type === "medicine") {
                medicineLeft.set(key, (medicineLeft.get(key) ?? 0) - req.quantity);
              } else {
                const held = (equipmentHeld.get(key) ?? 0) + req.quantity;
                equipmentHeld.set(key, held);
                equipmentPeak.set(key, Math.max(equipmentPeak.get(key) ?? 0, held));
              }
            }
          }
          startTime[cand.index] = t;
          running.push(cand.index);
          startedNow.add(cand.index);
        } else {
          skipped.push({
            id: cand.patient.id,
            blocked_by: short,
            ...(stockShortNow.length > 0 ? { stock_blocked_by: stockShortNow.map(stockName) } : {}),
          });
        }
      }

      queue = queue.filter((i) => !startedNow.has(i));
    }

    // Whoever is still queued is blocked by what is short right now. The delay
    // is attributed to the binding resource: the shortage that would be
    // resolved last, once running treatments finish.
    const blockedNow: { index: number; binding: ResourceKey }[] = [];
    const blockedPerResource = emptyResourceSet();
    for (const i of queue) {
      const short = shortages(all[i].required_resources, cap);
      if (short.length === 0) continue;
      const binding = bindingResource(all[i].required_resources, short, cap);
      blockedNow.push({ index: i, binding });
      blockedPerResource[binding]++;
      everBlocked[i] = true;
      blockedPatientSets.get(binding)!.add(i);
    }
    const stockBlockedNow: { index: number; keys: string[] }[] = [];
    if (stockOn) {
      for (const i of queue) {
        const keys = stockShort(i);
        if (keys.length === 0) continue;
        stockBlockedNow.push({ index: i, keys });
        everBlocked[i] = true;
        for (const key of keys) {
          if (!stockBlockedPatients.has(key)) stockBlockedPatients.set(key, new Set());
          stockBlockedPatients.get(key)!.add(i);
        }
      }
    }
    let bottleneck: ResourceKey | null = null;
    for (const k of RESOURCE_KEYS) {
      if (
        blockedPerResource[k] > 0 &&
        (bottleneck === null || blockedPerResource[k] > blockedPerResource[bottleneck])
      ) {
        bottleneck = k;
      }
    }

    snapshots.push({
      t,
      queue_length: queue.length,
      in_treatment: running.length,
      treated: treatedCount,
      in_use: cloneResourceSet(inUse),
      bottleneck,
    });
    stopTime = t;

    if (treatedCount === n && queue.length === 0 && running.length === 0) break;

    let nextProgress = Infinity;
    if (arrivalPtr < n) nextProgress = all[arrivalOrder[arrivalPtr]].arrival_time;
    let nextChange = Infinity;
    for (const c of availability) {
      if (c.time <= t) continue;
      nextChange = Math.min(nextChange, c.time);
      // Only staff coming back can unblock anyone; a departure is just a moment to re-plan.
      if (c.delta > 0) nextProgress = Math.min(nextProgress, c.time);
    }
    for (const idx of running) {
      nextProgress = Math.min(nextProgress, startTime[idx]! + all[idx].treatment_time);
    }
    if (nextProgress === Infinity) {
      error = describeStall(
        queue.map((i) => all[i]),
        cap,
        resources,
        params,
        t,
        stockReasons,
      );
      break;
    }
    let next = Math.min(nextProgress, nextChange);
    if (failedUnits > 0 && params.failureStart > t) next = Math.min(next, params.failureStart);

    const span = next - t;
    for (const { index, binding } of blockedNow) {
      blockedMinutes[binding] += span;
      patientBlocked[index][binding] += span;
    }
    for (const { index, keys } of stockBlockedNow) {
      for (const key of keys) {
        stockBlockedMinutes.set(key, (stockBlockedMinutes.get(key) ?? 0) + span);
        patientStockBlocked[index].set(key, (patientStockBlocked[index].get(key) ?? 0) + span);
      }
    }
    for (const { index, appointment } of heldNow) {
      heldMinutes[index] += span;
      heldFor[index] ??= appointment;
    }
    t = next;
  }

  const verified = queue.length === 0 && running.length === 0 && treatedCount === n;
  if (!verified && error === null) {
    error = `Simulation ended in an inconsistent state: ${queue.length} waiting, ${running.length} in treatment, ${treatedCount} of ${n} treated.`;
  }
  const completed = verified && error === null;

  const actualCompletionTime = stopTime;
  const horizon = Math.max(duration, actualCompletionTime);

  const timeline: TimelinePoint[] = [];
  let snap = 0;
  for (let m = 0; m <= horizon; m++) {
    while (snap + 1 < snapshots.length && snapshots[snap + 1].t <= m) snap++;
    const s = snapshots[snap];
    const cap = allocationCapacity(m);
    const capacityShown = emptyResourceSet();
    for (const k of RESOURCE_KEYS) capacityShown[k] = Math.max(cap[k], s.in_use[k]);
    timeline.push({
      t: m,
      queue_length: s.queue_length,
      in_treatment: s.in_treatment,
      treated: s.treated,
      in_use: cloneResourceSet(s.in_use),
      capacity: capacityShown,
      bottleneck: s.bottleneck,
    });
  }

  const outcomes: PatientOutcome[] = all.map((p, i) => {
    const start = startTime[i];
    const decision = decisions[i];
    const end = start === null ? null : start + p.treatment_time;
    let status: OutcomeStatus;
    if (p.arrival_time > actualCompletionTime) status = "not_arrived";
    else if (start === null) {
      status = p.urgency >= params.criticalUrgency ? "critical_waiting" : "waiting";
    } else status = "treated";

    const wait =
      start !== null ? start - p.arrival_time : Math.max(0, actualCompletionTime - p.arrival_time);
    const priority =
      decision?.score.total ??
      scoreBreakdown(p, Math.max(actualCompletionTime, p.arrival_time), params.weights).total;

    if (decision) {
      const per = patientBlocked[i];
      const total = RESOURCE_KEYS.reduce((sum, k) => sum + per[k], 0);
      decision.blocked_minutes = total;
      decision.binding_resource =
        total === 0
          ? null
          : RESOURCE_KEYS.reduce((best, k) => (per[k] > per[best] ? k : best), RESOURCE_KEYS[0]);
      const blockedOnStock: StockBlock[] = [...patientStockBlocked[i]].map(([key, minutes]) => {
        const [item_type, ...rest] = key.split(":");
        return { item_type: item_type as StockBlock["item_type"], item_id: rest.join(":"), name: stockName(key), minutes };
      });
      if (blockedOnStock.length > 0) decision.stock_blocked = blockedOnStock;
      if (heldMinutes[i] > 0 && heldFor[i] !== null) {
        const holder = all.find((x) => x.id === heldFor[i]);
        decision.appointment_hold = {
          minutes: heldMinutes[i],
          appointment_id: heldFor[i]!,
          kind: holder?.ambulance ? "ambulance" : "appointment",
        };
      }
    }

    return {
      id: p.id,
      condition: p.condition,
      arrival_time: p.arrival_time,
      urgency: p.urgency,
      treatment_time: p.treatment_time,
      required_resources: { ...p.required_resources },
      emergency: p.emergency === true,
      appointment: p.appointment === true,
      ambulance: p.ambulance !== undefined,
      alert_time: p.ambulance?.alert_time ?? null,
      ...(stockReq[i].length > 0 ? { stock_requirements: stockReq[i].map((r) => ({ ...r })) } : {}),
      status,
      start_time: start,
      end_time: end,
      wait_time: wait,
      priority_score: priority,
      decision,
    };
  });

  const blockedPatientCounts = emptyResourceSet();
  for (const k of RESOURCE_KEYS) blockedPatientCounts[k] = blockedPatientSets.get(k)!.size;

  const metrics = computeMetrics({
    outcomes,
    timeline,
    resources,
    params,
    blockedPatientMinutes: blockedMinutes,
    blockedPatientCounts,
    resourceConflicts: everBlocked.filter(Boolean).length,
    actualCompletionTime,
  });

  const warnings = buildWarnings({
    outcomes,
    timeline,
    metrics,
    resources,
    params,
    surgeAdded: surge.length,
    error,
  });

  let stock: StockOutcome | undefined;
  if (params.stock) {
    stock = {
      medicines: Object.entries(params.stock.medicines).map(([id, m]) => {
        const key = `medicine:${id}`;
        const remaining = medicineLeft.get(key) ?? 0;
        return {
          item_id: id,
          name: m.name,
          initial: m.quantity,
          consumed: m.quantity - remaining,
          remaining,
          blocked_patients: stockBlockedPatients.get(key)?.size ?? 0,
          blocked_minutes: stockBlockedMinutes.get(key) ?? 0,
        };
      }),
      equipment: Object.entries(params.stock.equipment).map(([id, e]) => {
        const key = `equipment:${id}`;
        return {
          item_id: id,
          name: e.name,
          units: e.units,
          peak_in_use: equipmentPeak.get(key) ?? 0,
          blocked_patients: stockBlockedPatients.get(key)?.size ?? 0,
          blocked_minutes: stockBlockedMinutes.get(key) ?? 0,
        };
      }),
    };
    for (const item of [...stock.medicines, ...stock.equipment]) {
      if (item.blocked_patients > 0) {
        warnings.push({
          level: "warning",
          code: "stock_blocked",
          message: `${item.name} held back ${item.blocked_patients} patient(s) for ${item.blocked_minutes} patient-minutes in total.`,
        });
      }
    }
  }

  return {
    strategy: params.strategy,
    params,
    resources: cloneResourceSet(resources),
    patients: outcomes,
    metrics,
    timeline,
    warnings,
    completed,
    error,
    isPlaceholder: false,
    engine: ENGINE_NAME,
    ...(stock ? { stock } : {}),
  };
}

function describeStall(
  waiting: SimPatient[],
  cap: ResourceSet,
  nominal: ResourceSet,
  params: SimParams,
  t: number,
  stockReasons: (p: SimPatient) => string[] = () => [],
): string {
  const reasons = waiting.slice(0, 5).map((p) => {
    const short = RESOURCE_KEYS.filter((k) => (p.required_resources[k] ?? 0) > cap[k]);
    const detail = [
      ...short.map((k) => {
        const failed = params.resourceFailure && k === params.failedResource && cap[k] < nominal[k];
        const staffed = !failed && cap[k] < nominal[k];
        const why = failed ? "remain after the failure" : staffed ? "are available after staff changes" : "exist";
        return `${p.required_resources[k]} ${RESOURCE_LABELS[k].toLowerCase()} but only ${cap[k]} ${why}`;
      }),
      ...stockReasons(p),
    ].join(" and ");
    return `${p.id} needs ${detail}`;
  });
  const more = waiting.length > 5 ? `, and ${waiting.length - 5} more` : "";
  return `Not all patients can be treated: ${waiting.length} patient(s) are still waiting at minute ${t} with nothing left to release or arrive (${reasons.join("; ")}${more}). Increase that resource or reduce the patient's requirement.`;
}

export function runAllStrategies(
  patients: SimPatient[],
  resources: ResourceSet,
  params: Partial<SimParams> = {},
): Record<SimParams["strategy"], SimulationOutput> {
  return {
    fcfs: runSimulation(patients, resources, { ...params, strategy: "fcfs" }),
    urgency: runSimulation(patients, resources, { ...params, strategy: "urgency" }),
    dynamic: runSimulation(patients, resources, { ...params, strategy: "dynamic" }),
    hazard: runSimulation(patients, resources, { ...params, strategy: "hazard" }),
  };
}
