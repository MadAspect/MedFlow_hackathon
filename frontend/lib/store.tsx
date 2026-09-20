"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  DatabaseError,
  connectDatabase,
  resourcesFromRow,
  type Database,
  type NewPatient,
  type PatientRow,
  type StoredRun,
} from "./database";
import {
  CONTRAST_MESSAGE,
  CONTRAST_PARAMS,
  CONTRAST_PATIENTS,
  CONTRAST_RESOURCES,
  DEMO_APPOINTMENTS,
  DEMO_PARAMS,
  DEMO_PATIENTS,
  DEMO_RESOURCES,
  EXAMPLE_AMBULANCES,
  EXAMPLE_APPOINTMENTS,
  EXAMPLE_PATIENTS,
} from "./demo";
import {
  RunPreconditionError,
  executeRun,
  outputFromStoredRun,
  resetPatientStatuses,
} from "./runner";
import {
  DEFAULT_RESOURCES,
  SimulationInputError,
  activeEngineMode,
  defaultParams,
  minutesOfDay,
  setClockStart,
  type AvailabilityChange,
  type ResourceSet,
  type SimParams,
  type SimulationOutput,
} from "./simulation";
import type { StockRequirementInput } from "./database";
import {
  EXAMPLE_EQUIPMENT,
  EXAMPLE_MEDICINES,
  createEquipment,
  createMedicine,
  markEquipmentMaintenance,
  markEquipmentOperational,
  setEquipmentAvailability,
  stockConstraintsEnabled,
  updateEquipment,
  updateMedicine,
  type Equipment,
  type EquipmentInput,
  type Medicine,
  type MedicineInput,
  type PatientStockRequirementRow,
} from "./inventory";
import {
  EXAMPLE_STAFF,
  StaffError,
  alignRoster,
  assignmentsAt,
  changeAvailability,
  createStaff,
  generateStaff,
  isOpenSlot,
  updateStaff,
  type AvailabilityStatus,
  type StaffAvailabilityEvent,
  type StaffInput,
  type StaffMember,
} from "./staff";
import { suggestStock } from "./treatments";
import { validatePatient, type PatientInput } from "./validation";

export interface Toast {
  id: number;
  kind: "success" | "error" | "info";
  message: string;
}

export interface CurrentRun {
  output: SimulationOutput;
  runId: string | null;
  createdAt: string | null;
}

interface Store {
  ready: boolean;
  connection: { connected: boolean; mode: "supabase" | "local"; message: string } | null;
  engineMode: "real" | "placeholder";
  patients: PatientRow[];
  resources: ResourceSet;
  resourcesSaved: boolean;
  runs: StoredRun[];
  current: CurrentRun | null;
  params: SimParams;
  setParams: (patch: Partial<SimParams>) => void;
  viewTime: number;
  setViewTime: (t: number) => void;
  playing: boolean;
  setPlaying: (playing: boolean) => void;
  speed: number;
  setSpeed: (minutesPerSecond: number) => void;
  liveReplay: boolean;
  setLiveReplay: (on: boolean) => void;
  running: boolean;
  /** The "simulation finished" popup: opens when a run's replay ends (or straight away without a replay). */
  summaryOpen: boolean;
  openSummary: () => void;
  closeSummary: () => void;
  toasts: Toast[];
  dismissToast: (id: number) => void;
  addPatient: (input: PatientInput, stock?: StockRequirementInput[]) => Promise<boolean>;
  deletePatient: (patientId: string) => Promise<void>;
  cancelPatient: (patientId: string) => Promise<void>;
  clearPatients: () => Promise<void>;
  loadExample: () => Promise<void>;
  loadExampleAppointments: () => Promise<void>;
  loadExampleAmbulances: () => Promise<void>;
  saveResources: (resources: ResourceSet) => Promise<boolean>;
  loadLatestResources: () => Promise<ResourceSet | null>;
  runSimulation: () => Promise<boolean>;
  resetRun: () => Promise<void>;
  openRun: (id: string) => Promise<boolean>;
  runDemo: () => Promise<boolean>;
  runContrast: () => Promise<boolean>;

  /** Stock constraints are opt-in (NEXT_PUBLIC_ENABLE_STOCK_CONSTRAINTS=true); the pages work either way. */
  stockEnabled: boolean;
  medicines: Medicine[];
  equipment: Equipment[];
  staff: StaffMember[];
  staffEvents: StaffAvailabilityEvent[];
  stockRequirements: PatientStockRequirementRow[];
  saveMedicine: (input: Partial<MedicineInput>, id?: string) => Promise<boolean>;
  removeMedicine: (id: string) => Promise<void>;
  saveEquipment: (input: Partial<EquipmentInput>, id?: string) => Promise<boolean>;
  setEquipmentAvailable: (id: string, units: number) => Promise<boolean>;
  setEquipmentMaintenance: (id: string, underMaintenance: boolean) => Promise<void>;
  removeEquipment: (id: string) => Promise<void>;
  saveStaffMember: (input: Partial<StaffInput>, id?: string) => Promise<boolean>;
  removeStaff: (id: string) => Promise<void>;
  /** Changes take effect at the minute being watched; the run is recalculated from that minute on. */
  setAvailability: (id: string, status: AvailabilityStatus, reason?: string) => Promise<boolean>;
  setPatientStock: (patientId: string, requirements: StockRequirementInput[]) => Promise<boolean>;
  /** Arrives at the minute being watched, joins the queue, and the run is recalculated from there. */
  addPatientToRun: (
    input: Pick<PatientInput, "condition" | "urgency" | "treatment_time" | "required_resources"> & { patient_id?: string },
    stock?: StockRequirementInput[],
  ) => Promise<boolean>;
  loadExampleInventory: () => Promise<void>;
  loadExampleStaff: () => Promise<void>;
}

const StoreContext = createContext<Store | null>(null);

export function useStore(): Store {
  const store = useContext(StoreContext);
  if (!store) throw new Error("useStore must be used inside <StoreProvider>");
  return store;
}

// v2: the default Dynamic Priority weights changed, so settings saved by v1 are not reused.
const PARAMS_KEY = "waitless.params.v2";
const LIVE_KEY = "waitless.live.v1";

export const PLAYBACK_SPEEDS = [2, 5, 15, 60] as const;

function defaultViewTime(output: SimulationOutput): number {
  return output.metrics.peak_queue_length > 0
    ? output.metrics.peak_queue_time
    : output.params.duration;
}

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return "Something went wrong.";
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const dbRef = useRef<Database | null>(null);
  const toastId = useRef(0);
  const [ready, setReady] = useState(false);
  const [connection, setConnection] = useState<Store["connection"]>(null);
  const [patients, setPatients] = useState<PatientRow[]>([]);
  const [resources, setResources] = useState<ResourceSet>(DEFAULT_RESOURCES);
  const [resourcesSaved, setResourcesSaved] = useState(false);
  const [runs, setRuns] = useState<StoredRun[]>([]);
  const [current, setCurrent] = useState<CurrentRun | null>(null);
  const [params, setParamsState] = useState<SimParams>(() => defaultParams());
  const [viewTime, setViewTimeState] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeedState] = useState<number>(5);
  const [liveReplay, setLiveReplayState] = useState(true);
  const [running, setRunning] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  // Set when a fresh run starts replaying; the popup opens once the replay reaches its last minute.
  const summaryPending = useRef(false);
  const [medicines, setMedicines] = useState<Medicine[]>([]);
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [staffEvents, setStaffEvents] = useState<StaffAvailabilityEvent[]>([]);
  const [stockRequirements, setStockRequirements] = useState<PatientStockRequirementRow[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const engineMode = activeEngineMode();

  // The playback timer reads the clock from a ref so it never restarts while it ticks.
  const viewRef = useRef(0);
  const setViewTime = useCallback((t: number) => {
    viewRef.current = t;
    setViewTimeState(t);
  }, []);

  const saveLive = (patch: { speed?: number; liveReplay?: boolean }) => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(LIVE_KEY) ?? "{}");
      window.localStorage.setItem(LIVE_KEY, JSON.stringify({ ...saved, ...patch }));
    } catch {
      /* per-viewer convenience only */
    }
  };
  const setSpeed = useCallback((minutesPerSecond: number) => {
    setSpeedState(minutesPerSecond);
    saveLive({ speed: minutesPerSecond });
  }, []);
  const setLiveReplay = useCallback((on: boolean) => {
    setLiveReplayState(on);
    saveLive({ liveReplay: on });
  }, []);

  const notify = useCallback((kind: Toast["kind"], message: string) => {
    const id = ++toastId.current;
    setToasts((prev) => [...prev, { id, kind, message }]);
    window.setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), kind === "error" ? 7000 : 4000);
  }, []);
  const dismissToast = useCallback((id: number) => setToasts((prev) => prev.filter((t) => t.id !== id)), []);

  const liveRef = useRef(true);
  useEffect(() => {
    liveRef.current = liveReplay;
  }, [liveReplay]);

  const showRun = useCallback(
    (run: CurrentRun, options: { replay?: boolean } = {}) => {
      setCurrent(run);
      const wantsSummary = options.replay === true && !run.output.isPlaceholder;
      summaryPending.current = false;
      if (options.replay && liveRef.current && !prefersReducedMotion() && run.output.timeline.length > 1) {
        setViewTime(0);
        setPlaying(true);
        summaryPending.current = wantsSummary;
      } else {
        setPlaying(false);
        setViewTime(options.replay ? Math.max(0, run.output.timeline.length - 1) : defaultViewTime(run.output));
        if (wantsSummary) setSummaryOpen(true);
      }
    },
    [setViewTime],
  );

  const lastMinute = current ? Math.max(0, current.output.timeline.length - 1) : 0;
  useEffect(() => {
    if (!playing) return;
    let previous = performance.now();
    let carry = 0;
    const id = window.setInterval(() => {
      const now = performance.now();
      carry += ((now - previous) / 1000) * speed;
      previous = now;
      const whole = Math.floor(carry);
      if (whole < 1) return;
      carry -= whole;
      const next = Math.min(lastMinute, viewRef.current + whole);
      setViewTime(next);
      if (next >= lastMinute) {
        setPlaying(false);
        if (summaryPending.current) {
          summaryPending.current = false;
          setSummaryOpen(true);
        }
      }
    }, 100);
    return () => window.clearInterval(id);
  }, [playing, speed, lastMinute, setViewTime]);

  useEffect(() => {
    let cancelled = false;
    setClockStart(minutesOfDay(new Date()));
    (async () => {
      const conn = await connectDatabase();
      if (cancelled) return;
      dbRef.current = conn.db;
      try {
        const [patientRows, resourceRow, runRows] = await Promise.all([
          conn.db.listPatients(),
          conn.db.getLatestResources(),
          conn.db.listRuns(),
        ]);
        if (cancelled) return;
        setPatients(patientRows);
        if (resourceRow) {
          setResources(resourcesFromRow(resourceRow));
          setResourcesSaved(true);
        }
        setRuns(runRows);
        if (runRows[0]) {
          const detail = await conn.db.getRun(runRows[0].run.id);
          const output = detail ? outputFromStoredRun(detail) : null;
          if (output && !cancelled) {
            showRun({ output, runId: runRows[0].run.id, createdAt: runRows[0].run.created_at });
          }
        }
      } catch (err) {
        notify("error", `Could not load saved data: ${errorMessage(err)}`);
      }
      // Inventory and staff load on their own: a Supabase project that has not run the latest
      // schema still opens, and only these pages report the missing tables.
      try {
        const [m, e, s, ev, req] = await Promise.all([
          conn.db.listMedicines(),
          conn.db.listEquipment(),
          conn.db.listStaff(),
          conn.db.listStaffEvents(),
          conn.db.listStockRequirements(),
        ]);
        if (!cancelled) {
          setMedicines(m);
          setEquipment(e);
          setStaff(s);
          setStaffEvents(ev);
          setStockRequirements(req);
        }
      } catch (err) {
        notify("info", `Inventory and staff are unavailable: ${errorMessage(err)} Run the latest supabase/schema.sql to enable them.`);
      }
      try {
        const saved = window.localStorage.getItem(PARAMS_KEY);
        if (saved) setParamsState(defaultParams(JSON.parse(saved)));
        const live = JSON.parse(window.localStorage.getItem(LIVE_KEY) ?? "{}");
        if (typeof live.liveReplay === "boolean") setLiveReplayState(live.liveReplay);
        if (PLAYBACK_SPEEDS.includes(live.speed)) setSpeedState(live.speed);
      } catch {
        /* per-viewer convenience only */
      }
      if (!cancelled) {
        setConnection({ connected: conn.connected, mode: conn.db.mode, message: conn.message });
        setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [notify, showRun]);

  const setParams = useCallback((patch: Partial<SimParams>) => {
    setParamsState((prev) => {
      const next = defaultParams({ ...prev, ...patch, weights: { ...prev.weights, ...patch.weights } });
      try {
        window.localStorage.setItem(PARAMS_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const db = () => {
    if (!dbRef.current) throw new DatabaseError("Database is not ready yet.");
    return dbRef.current;
  };

  const refreshPatients = async () => setPatients(await db().listPatients());
  const refreshRuns = async () => setRuns(await db().listRuns());

  const guard = async <T,>(fn: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await fn();
    } catch (err) {
      notify("error", errorMessage(err));
      return fallback;
    }
  };

  async function loadScenario(scenario: {
    patients: NewPatient[];
    resources: ResourceSet;
    params: Partial<SimParams>;
    success: string;
    failure: string;
    /** Also fill in what a real hospital would have: stock, each patient's stock needs, and named staff. */
    withSupport?: boolean;
  }): Promise<boolean> {
    setRunning(true);
    try {
      const scenarioParams = defaultParams(scenario.params);
      await db().clearPatients();
      await db().insertPatients(scenario.patients);
      if (scenario.withSupport) await populateScenarioSupport(scenario.patients, scenario.resources);
      const row = await db().saveResources(scenario.resources);
      setResources(resourcesFromRow(row));
      setResourcesSaved(true);
      setParams(scenarioParams);
      const result = await executeRun(db(), scenarioParams);
      setPatients(result.patients);
      await refreshRuns();
      showRun({ output: result.output, runId: result.stored.run.id, createdAt: result.stored.run.created_at }, { replay: true });
      if (result.output.completed) notify("success", scenario.success);
      else notify("error", `Simulation error — not all patients were treated. ${result.output.error ?? ""}`.trim());
      return true;
    } catch (err) {
      notify("error", `${scenario.failure}: ${errorMessage(err)}`);
      return false;
    } finally {
      setRunning(false);
    }
  }

  const refreshInventory = async () => {
    const [m, e, s, ev, req] = await Promise.all([
      db().listMedicines(),
      db().listEquipment(),
      db().listStaff(),
      db().listStaffEvents(),
      db().listStockRequirements(),
    ]);
    setMedicines(m);
    setEquipment(e);
    setStaff(s);
    setStaffEvents(ev);
    setStockRequirements(req);
  };

  /** What a patient normally needs from stock, worked out from their condition and the inventory we have. */
  const standardStock = (condition: string, urgency: number): StockRequirementInput[] =>
    suggestStock(condition, urgency, medicines, equipment).requirements;

  /** Patients added without an explicit list (examples, appointments, ambulances) still get their standard needs. */
  async function saveStandardStock(rows: { patient_id: string; condition: string; urgency: number }[]) {
    if (medicines.length + equipment.length === 0) return;
    for (const p of rows) {
      const lines = standardStock(p.condition, p.urgency);
      if (lines.length > 0) await db().setStockRequirements(p.patient_id, lines);
    }
    setStockRequirements(await db().listStockRequirements());
  }

  /**
   * Makes a demo scenario complete: loads the example inventory if the hospital has none, gives every
   * patient their standard medicine and equipment needs, and names the doctors and nurses the
   * Resources page counts (random names and professions) without touching anyone already listed.
   */
  async function populateScenarioSupport(rows: NewPatient[], scenarioResources: ResourceSet) {
    const now = new Date().toISOString();
    let meds = await db().listMedicines();
    let equip = await db().listEquipment();
    if (meds.length + equip.length === 0) {
      for (const m of EXAMPLE_MEDICINES) await db().saveMedicine({ ...m, created_at: now, updated_at: now });
      for (const e of EXAMPLE_EQUIPMENT) await db().saveEquipment({ ...e, created_at: now, updated_at: now });
      meds = await db().listMedicines();
      equip = await db().listEquipment();
    }
    for (const p of rows) {
      const { requirements } = suggestStock(p.condition, p.urgency, meds, equip);
      if (requirements.length > 0) await db().setStockRequirements(p.patient_id, requirements);
    }

    const listed = await db().listStaff();
    const takenNames = listed.map((s) => s.name);
    for (const role of ["doctor", "nurse"] as const) {
      const missing = Math.max(0, scenarioResources[role] - listed.filter((s) => s.role === role).length);
      const fresh = generateStaff(role, missing, {
        takenNames,
        makeId: () => `S${crypto.randomUUID().slice(0, 6).toUpperCase()}`,
        now,
      });
      for (const member of fresh) {
        await db().saveStaff(member);
        takenNames.push(member.name);
      }
    }
    await refreshInventory();
  }

  /**
   * Recalculates the run being watched. It starts from the resources and parameters that run
   * started with, so nothing before the new event changes and nothing is counted twice; the new
   * result is saved to history like any other run.
   */
  async function rerunCurrent(patch: { availability?: AvailabilityChange } = {}) {
    if (!current) return null;
    const base = current.output;
    const runParams = patch.availability
      ? { ...base.params, availability: [...(base.params.availability ?? []), patch.availability] }
      : base.params;
    const result = await executeRun(db(), runParams, undefined, { resources: base.resources });
    setPatients(result.patients);
    await refreshRuns();
    setCurrent({ output: result.output, runId: result.stored.run.id, createdAt: result.stored.run.created_at });
    return result;
  }

  const store: Store = {
    ready,
    connection,
    engineMode,
    patients,
    resources,
    resourcesSaved,
    runs,
    current,
    params,
    setParams,
    viewTime,
    setViewTime,
    playing,
    setPlaying,
    speed,
    setSpeed,
    liveReplay,
    setLiveReplay,
    running,
    summaryOpen,
    openSummary: () => setSummaryOpen(true),
    closeSummary: () => setSummaryOpen(false),
    toasts,
    dismissToast,
    stockEnabled: stockConstraintsEnabled(),
    medicines,
    equipment,
    staff,
    staffEvents,
    stockRequirements,

    addPatient: (input, stock) =>
      guard(async () => {
        await db().insertPatients([input]);
        // An explicit list (even an empty one) is respected; no list means the standard set.
        const lines = stock ?? standardStock(input.condition, input.urgency);
        if (lines.length > 0) {
          await db().setStockRequirements(input.patient_id, lines);
          setStockRequirements(await db().listStockRequirements());
        }
        await refreshPatients();
        notify(
          "success",
          input.appointment
            ? `Appointment ${input.patient_id} booked.`
            : input.alert_time !== undefined
              ? `Ambulance ${input.patient_id} logged.`
              : `Patient ${input.patient_id} added.`,
        );
        return true;
      }, false),

    deletePatient: (patientId) =>
      guard(async () => {
        await db().deletePatient(patientId);
        await refreshPatients();
        notify("info", `Patient ${patientId} deleted.`);
      }, undefined),

    cancelPatient: (patientId) =>
      guard(async () => {
        await db().setPatientStatus(patientId, "cancelled");
        await refreshPatients();
        const found = patients.find((p) => p.patient_id === patientId);
        const what = found?.appointment ? "Appointment" : found?.alert_time != null ? "Ambulance" : "Patient";
        notify("info", `${what} ${patientId} cancelled — excluded from simulations.`);
      }, undefined),

    clearPatients: () =>
      guard(async () => {
        await db().clearPatients();
        await refreshPatients();
        notify("info", "All patients cleared.");
      }, undefined),

    loadExample: () =>
      guard(async () => {
        const existing = new Set(patients.map((p) => p.patient_id.toLowerCase()));
        const fresh = EXAMPLE_PATIENTS.filter((p) => !existing.has(p.patient_id.toLowerCase()));
        if (fresh.length === 0) {
          notify("info", "The example patients are already loaded.");
          return;
        }
        await db().insertPatients(fresh);
        await saveStandardStock(fresh);
        await refreshPatients();
        notify("success", `Loaded ${fresh.length} synthetic example patients.`);
      }, undefined),

    loadExampleAppointments: () =>
      guard(async () => {
        const existing = new Set(patients.map((p) => p.patient_id.toLowerCase()));
        const fresh = EXAMPLE_APPOINTMENTS.filter((p) => !existing.has(p.patient_id.toLowerCase()));
        if (fresh.length === 0) {
          notify("info", "The example appointments are already booked.");
          return;
        }
        await db().insertPatients(fresh);
        await saveStandardStock(fresh);
        await refreshPatients();
        notify("success", `Booked ${fresh.length} example appointments.`);
      }, undefined),

    loadExampleAmbulances: () =>
      guard(async () => {
        const existing = new Set(patients.map((p) => p.patient_id.toLowerCase()));
        const fresh = EXAMPLE_AMBULANCES.filter((p) => !existing.has(p.patient_id.toLowerCase()));
        if (fresh.length === 0) {
          notify("info", "The example ambulances are already logged.");
          return;
        }
        await db().insertPatients(fresh);
        await saveStandardStock(fresh);
        await refreshPatients();
        notify("success", `Logged ${fresh.length} example ambulance arrivals.`);
      }, undefined),

    saveResources: (next) =>
      guard(async () => {
        const row = await db().saveResources(next);
        setResources(resourcesFromRow(row));
        setResourcesSaved(true);
        notify("success", "Resource configuration saved.");
        return true;
      }, false),

    loadLatestResources: () =>
      guard(async () => {
        const row = await db().getLatestResources();
        if (!row) {
          notify("info", "No saved configuration yet — showing defaults.");
          return null;
        }
        const loaded = resourcesFromRow(row);
        setResources(loaded);
        setResourcesSaved(true);
        notify("success", "Loaded the latest saved configuration.");
        return loaded;
      }, null),

    runSimulation: async () => {
      setRunning(true);
      try {
        const result = await executeRun(db(), params);
        setPatients(result.patients);
        await refreshRuns();
        showRun({ output: result.output, runId: result.stored.run.id, createdAt: result.stored.run.created_at }, { replay: true });
        if (result.output.isPlaceholder) {
          notify("info", "Placeholder simulation output saved — not a calculated result.");
        } else if (result.output.completed) {
          notify(
            "success",
            `Simulation completed: all ${result.output.metrics.total_patients} patients treated by minute ${result.output.metrics.actual_completion_time}.`,
          );
        } else {
          notify("error", `Simulation error — not all patients were treated. ${result.output.error ?? ""}`.trim());
        }
        return true;
      } catch (err) {
        const known =
          err instanceof RunPreconditionError ||
          err instanceof SimulationInputError ||
          err instanceof DatabaseError;
        notify("error", known ? err.message : `Simulation failed: ${errorMessage(err)}`);
        return false;
      } finally {
        setRunning(false);
      }
    },

    resetRun: () =>
      guard(async () => {
        setPlaying(false);
        summaryPending.current = false;
        setSummaryOpen(false);
        setCurrent(null);
        setPatients(await resetPatientStatuses(db()));
        notify("info", "Current run cleared and patient statuses reset. Saved history is untouched.");
      }, undefined),

    openRun: (id) =>
      guard(async () => {
        const detail = await db().getRun(id);
        const output = detail ? outputFromStoredRun(detail) : null;
        if (!detail || !output) {
          notify("error", "That run has no saved results.");
          return false;
        }
        showRun({ output, runId: id, createdAt: detail.run.created_at });
        return true;
      }, false),

    runDemo: () =>
      loadScenario({
        patients: [...DEMO_PATIENTS, ...DEMO_APPOINTMENTS],
        resources: DEMO_RESOURCES,
        params: DEMO_PARAMS,
        withSupport: true,
        success: "Demo scenario loaded and simulated.",
        failure: "Demo failed",
      }),

    runContrast: () =>
      loadScenario({
        patients: CONTRAST_PATIENTS,
        resources: CONTRAST_RESOURCES,
        params: CONTRAST_PARAMS,
        success: `Contrast scenario loaded and simulated. ${CONTRAST_MESSAGE}`,
        failure: "Contrast scenario failed",
      }),

    saveMedicine: (input, id) =>
      guard(async () => {
        const now = new Date().toISOString();
        const existing = id ? medicines.find((m) => m.id === id) : undefined;
        const row = existing
          ? updateMedicine(existing, input, now)
          : createMedicine(input as MedicineInput, crypto.randomUUID(), now);
        await db().saveMedicine(row);
        setMedicines(await db().listMedicines());
        notify("success", existing ? `${row.name} updated.` : `${row.name} added to the medicine stock.`);
        return true;
      }, false),

    removeMedicine: (id) =>
      guard(async () => {
        const found = medicines.find((m) => m.id === id);
        await db().deleteMedicine(id);
        setMedicines(await db().listMedicines());
        notify("info", `${found?.name ?? "Medicine"} removed.`);
      }, undefined),

    saveEquipment: (input, id) =>
      guard(async () => {
        const now = new Date().toISOString();
        const existing = id ? equipment.find((e) => e.id === id) : undefined;
        const row = existing
          ? updateEquipment(existing, input, now)
          : createEquipment(input as EquipmentInput, crypto.randomUUID(), now);
        await db().saveEquipment(row);
        setEquipment(await db().listEquipment());
        notify("success", existing ? `${row.name} updated.` : `${row.name} added to the equipment stock.`);
        return true;
      }, false),

    setEquipmentAvailable: (id, units) =>
      guard(async () => {
        const found = equipment.find((e) => e.id === id);
        if (!found) throw new Error("That equipment no longer exists.");
        await db().saveEquipment(setEquipmentAvailability(found, units, new Date().toISOString()));
        setEquipment(await db().listEquipment());
        notify("success", `${found.name}: ${units} unit(s) available.`);
        return true;
      }, false),

    setEquipmentMaintenance: (id, underMaintenance) =>
      guard(async () => {
        const found = equipment.find((e) => e.id === id);
        if (!found) throw new Error("That equipment no longer exists.");
        const now = new Date().toISOString();
        await db().saveEquipment(underMaintenance ? markEquipmentMaintenance(found, now) : markEquipmentOperational(found, now));
        setEquipment(await db().listEquipment());
        notify(underMaintenance ? "info" : "success", underMaintenance ? `${found.name} marked under maintenance.` : `${found.name} is available again.`);
      }, undefined),

    removeEquipment: (id) =>
      guard(async () => {
        const found = equipment.find((e) => e.id === id);
        await db().deleteEquipment(id);
        setEquipment(await db().listEquipment());
        notify("info", `${found?.name ?? "Equipment"} removed.`);
      }, undefined),

    saveStaffMember: (input, id) =>
      guard(async () => {
        const now = new Date().toISOString();
        const existing = id ? staff.find((s) => s.id === id) : undefined;
        // Naming an open position (a doctor or nurse Resources counts but nobody was listed for)
        // saves the person under that position's id, so they take exactly that slot.
        const newId = id && isOpenSlot({ id }) ? id : `S${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
        const row = existing ? updateStaff(existing, input, now) : createStaff(input as StaffInput, newId, now);
        await db().saveStaff(row);
        setStaff(await db().listStaff());
        notify("success", existing ? `${row.name} updated.` : `${row.name} added to the staff list.`);
        return true;
      }, false),

    removeStaff: (id) =>
      guard(async () => {
        const found = staff.find((s) => s.id === id);
        await db().deleteStaff(id);
        setStaff(await db().listStaff());
        notify("info", `${found?.name ?? "Staff member"} removed.`);
      }, undefined),

    setAvailability: (id, status, reason = "") =>
      guard(async () => {
        const { scheduled } = alignRoster(staff, resources);
        const now = new Date().toISOString();
        // An open position is saved as a real person the first time its status changes.
        const found = scheduled.find((s) => s.id === id);
        const member = staff.find((s) => s.id === id) ?? (found && isOpenSlot(found) ? { ...found, created_at: now, updated_at: now } : undefined);
        if (!member) throw new StaffError("That staff member no longer exists.");
        const minute = current ? Math.round(viewTime) : 0;
        // Someone beyond the Resources headcount has no unit in the engine, so their status moves no capacity.
        const change = changeAvailability(member, status, minute, reason.trim(), now, found !== undefined);
        // Someone in the middle of a treatment is not pulled out of it: they finish it, and only
        // new assignments are affected. Say so instead of letting it look like nothing happened.
        const stillWith = current ? (assignmentsAt(current.output.patients, scheduled, minute).get(id) ?? []) : [];

        await db().saveStaff(change.staff);
        await db().addStaffEvent(change.event);
        const rerun = current && change.availability ? await rerunCurrent({ availability: change.availability }) : null;
        await refreshInventory();

        const when = current ? ` from minute ${minute}` : "";
        if (status !== "available" && stillWith.length > 0) {
          notify("info", `${member.name} is marked ${status.replace("_", " ")}${when} but is still treating ${stillWith.join(", ")}. They finish that treatment and get no new assignments.`);
        } else {
          notify("success", `${member.name} is now ${status.replace("_", " ")}${when}.`);
        }
        if (rerun && !rerun.output.completed) {
          notify("error", `Not all patients can be treated with this staffing. ${rerun.output.error ?? ""}`.trim());
        }
        return true;
      }, false),

    setPatientStock: (patientId, requirements) =>
      guard(async () => {
        await db().setStockRequirements(patientId, requirements);
        setStockRequirements(await db().listStockRequirements());
        notify("success", `Stock needs for ${patientId} saved.`);
        return true;
      }, false),

    addPatientToRun: (input, stock) =>
      guard(async () => {
        if (!current) throw new DatabaseError("Run a simulation first, then add patients to it.");
        const minute = Math.round(viewTime);
        const taken = new Set(patients.map((p) => p.patient_id.toLowerCase()));
        let n = patients.length + 1;
        while (taken.has(`l${String(n).padStart(3, "0")}`)) n++;
        const patientId = input.patient_id?.trim() || `L${String(n).padStart(3, "0")}`;

        const result = validatePatient({ ...input, patient_id: patientId, arrival_time: minute }, taken);
        if (!result.ok) throw new Error(Object.values(result.errors)[0]);

        await db().insertPatients([result.data]);
        const lines = stock ?? standardStock(result.data.condition, result.data.urgency);
        if (lines.length > 0) await db().setStockRequirements(patientId, lines);
        setStockRequirements(await db().listStockRequirements());

        const rerun = await rerunCurrent();
        if (rerun?.output.completed) {
          const outcome = rerun.output.patients.find((p) => p.id === patientId);
          notify("success", `${patientId} arrived at minute ${minute} and joined the queue${outcome?.start_time != null ? `; treatment starts at minute ${outcome.start_time}` : ""}.`);
        } else {
          notify("error", `${patientId} added, but not all patients can be treated. ${rerun?.output.error ?? ""}`.trim());
        }
        return true;
      }, false),

    loadExampleInventory: () =>
      guard(async () => {
        const haveMedicines = new Set(medicines.map((m) => m.id));
        const haveEquipment = new Set(equipment.map((e) => e.id));
        const now = new Date().toISOString();
        const freshMedicines = EXAMPLE_MEDICINES.filter((m) => !haveMedicines.has(m.id));
        const freshEquipment = EXAMPLE_EQUIPMENT.filter((e) => !haveEquipment.has(e.id));
        if (freshMedicines.length + freshEquipment.length === 0) {
          notify("info", "The example inventory is already loaded.");
          return;
        }
        for (const m of freshMedicines) await db().saveMedicine({ ...m, created_at: now, updated_at: now });
        for (const e of freshEquipment) await db().saveEquipment({ ...e, created_at: now, updated_at: now });
        await refreshInventory();
        notify("success", `Loaded ${freshMedicines.length} medicines and ${freshEquipment.length} kinds of equipment.`);
      }, undefined),

    loadExampleStaff: () =>
      guard(async () => {
        const have = new Set(staff.map((s) => s.id));
        const fresh = EXAMPLE_STAFF.filter((s) => !have.has(s.id));
        if (fresh.length === 0) {
          notify("info", "The example staff are already loaded.");
          return;
        }
        const now = new Date().toISOString();
        for (const s of fresh) await db().saveStaff({ ...s, created_at: now, updated_at: now });
        await refreshInventory();
        notify("success", `Loaded ${fresh.length} example staff members.`);
      }, undefined),
  };

  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}
