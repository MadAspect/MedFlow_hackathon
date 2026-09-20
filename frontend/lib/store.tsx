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
  type ResourceSet,
  type SimParams,
  type SimulationOutput,
} from "./simulation";
import type { PatientInput } from "./validation";

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
  toasts: Toast[];
  dismissToast: (id: number) => void;
  addPatient: (input: PatientInput) => Promise<boolean>;
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
      if (options.replay && liveRef.current && !prefersReducedMotion() && run.output.timeline.length > 1) {
        setViewTime(0);
        setPlaying(true);
      } else {
        setPlaying(false);
        setViewTime(options.replay ? Math.max(0, run.output.timeline.length - 1) : defaultViewTime(run.output));
      }
    },
    [setViewTime],
  );

  // Live replay: advance the shared clock one simulated minute at a time (several per tick at
  // the fast speeds), so every chart and card that follows `viewTime` updates each minute.
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
      if (next >= lastMinute) setPlaying(false);
    }, 100);
    return () => window.clearInterval(id);
  }, [playing, speed, lastMinute, setViewTime]);

  // Initial load: connect, then read everything back from the database.
  useEffect(() => {
    let cancelled = false;
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
  }): Promise<boolean> {
    setRunning(true);
    try {
      const scenarioParams = defaultParams(scenario.params);
      await db().clearPatients();
      await db().insertPatients(scenario.patients);
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
    toasts,
    dismissToast,

    addPatient: (input) =>
      guard(async () => {
        await db().insertPatients([input]);
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
        patients: DEMO_PATIENTS,
        resources: DEMO_RESOURCES,
        params: DEMO_PARAMS,
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
  };

  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}
