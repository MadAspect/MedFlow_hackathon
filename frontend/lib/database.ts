import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabase, getSupabaseConfigState } from "./supabase";
import { DEFAULT_WEIGHTS, scoreBreakdown } from "./simulation/policies";
import {
  RESOURCE_KEYS,
  type Decision,
  type Metrics,
  type OutcomeStatus,
  type ResourceRequest,
  type ResourceSet,
  type SimParams,
  type SimWarning,
  type SimulationOutput,
  type TimelinePoint,
} from "./simulation/types";

/* -------------------------------------------------------------------------- */
/* Row types (mirror supabase/schema.sql)                                     */
/* -------------------------------------------------------------------------- */

export type PatientStatus =
  | "waiting"
  | "in_treatment"
  | "treated"
  | "critical_waiting"
  | "cancelled";

export interface NewPatient {
  patient_id: string;
  condition: string;
  arrival_time: number;
  urgency: number;
  treatment_time: number;
  required_resources: ResourceRequest;
}

export interface PatientRow extends NewPatient {
  id: string;
  status: PatientStatus;
  priority_score: number;
  created_at: string;
}

export interface ResourceConfigRow {
  id: string;
  doctors: number;
  nurses: number;
  beds: number;
  icu_beds: number;
  operating_rooms: number;
  created_at: string;
}

export interface RunRow {
  id: string;
  strategy: string;
  simulation_time: number;
  emergency_surge: boolean;
  resource_failure: boolean;
  failed_resource: string | null;
  status: "running" | "completed" | "failed";
  created_at: string;
  /** Full parameters and the resource snapshot, so a run can be re-displayed. */
  parameters: { params: SimParams; resources: ResourceSet };
  engine: string;
  is_placeholder: boolean;
}

/** Utilizations are stored as fractions in the range 0..1. */
export interface ResultRow {
  id: string;
  simulation_run_id: string;
  patients_treated: number;
  average_waiting_time: number;
  maximum_waiting_time: number;
  critical_waiting_time: number;
  doctor_utilization: number;
  nurse_utilization: number;
  bed_utilization: number;
  icu_utilization: number;
  operating_room_utilization: number;
  patients_remaining: number;
  created_at: string;
  metrics: Metrics;
  timeline: TimelinePoint[];
  warnings: SimWarning[];
}

export interface AllocationRow {
  id: string;
  simulation_run_id: string;
  patient_id: string;
  status: OutcomeStatus;
  priority_score: number;
  allocated_resources: ResourceRequest;
  start_time: number | null;
  completion_time: number | null;
  waiting_time: number;
  arrival_time: number;
  urgency: number;
  condition: string;
  treatment_time: number;
  emergency: boolean;
  decision: Decision | null;
}

export interface StoredRun {
  run: RunRow;
  result: ResultRow | null;
  /** Empty in list results; loaded by getRun(). */
  allocations: AllocationRow[];
}

export class DatabaseError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = "DatabaseError";
  }
}

export class DuplicatePatientError extends DatabaseError {
  constructor(message = "A patient with that ID already exists.") {
    super(message, "duplicate");
    this.name = "DuplicatePatientError";
  }
}

/* -------------------------------------------------------------------------- */
/* Database interface                                                         */
/* -------------------------------------------------------------------------- */

export interface Database {
  readonly mode: "supabase" | "local";
  /** Resolves if the database is reachable and the schema exists. */
  ping(): Promise<void>;
  listPatients(): Promise<PatientRow[]>;
  insertPatients(patients: NewPatient[]): Promise<PatientRow[]>;
  deletePatient(patientId: string): Promise<void>;
  clearPatients(): Promise<void>;
  setPatientStatus(patientId: string, status: PatientStatus): Promise<void>;
  /** Replace stored patients (matched by id) with the given rows. */
  updatePatients(rows: PatientRow[]): Promise<void>;
  getLatestResources(): Promise<ResourceConfigRow | null>;
  saveResources(resources: ResourceSet): Promise<ResourceConfigRow>;
  saveSimulation(output: SimulationOutput): Promise<StoredRun>;
  /** Newest first, without allocations. */
  listRuns(limit?: number): Promise<StoredRun[]>;
  getRun(id: string): Promise<StoredRun | null>;
}

export const RUN_HISTORY_LIMIT = 50;

/* -------------------------------------------------------------------------- */
/* Shared helpers                                                             */
/* -------------------------------------------------------------------------- */

export function resourcesFromRow(row: ResourceConfigRow): ResourceSet {
  return {
    doctor: row.doctors,
    nurse: row.nurses,
    bed: row.beds,
    icu_bed: row.icu_beds,
    operating_room: row.operating_rooms,
  };
}

export function resourceRowFields(resources: ResourceSet) {
  return {
    doctors: resources.doctor,
    nurses: resources.nurse,
    beds: resources.bed,
    icu_beds: resources.icu_bed,
    operating_rooms: resources.operating_room,
  };
}

/** Score at arrival time (waiting time 0) — used before any simulation has run. */
export function basePriorityScore(p: NewPatient): number {
  return scoreBreakdown(
    {
      id: p.patient_id,
      condition: p.condition,
      arrival_time: p.arrival_time,
      urgency: p.urgency,
      treatment_time: p.treatment_time,
      required_resources: p.required_resources,
    },
    p.arrival_time,
    DEFAULT_WEIGHTS,
  ).total;
}

/** Split a simulation output into the run / result / allocation records (without ids). */
export function runRecordsFromOutput(output: SimulationOutput) {
  const m = output.metrics;
  const run = {
    strategy: output.strategy,
    simulation_time: output.params.duration,
    emergency_surge: output.params.emergencySurge,
    resource_failure: output.params.resourceFailure,
    failed_resource: output.params.resourceFailure ? output.params.failedResource : null,
    parameters: { params: output.params, resources: output.resources },
    engine: output.engine,
    is_placeholder: output.isPlaceholder,
  };
  const result = {
    patients_treated: m.patients_treated,
    average_waiting_time: m.average_wait,
    maximum_waiting_time: m.maximum_wait,
    critical_waiting_time: m.critical_wait,
    doctor_utilization: m.resource_utilization.doctor,
    nurse_utilization: m.resource_utilization.nurse,
    bed_utilization: m.resource_utilization.bed,
    icu_utilization: m.resource_utilization.icu_bed,
    operating_room_utilization: m.resource_utilization.operating_room,
    patients_remaining: m.patients_remaining,
    metrics: m,
    timeline: output.timeline,
    warnings: output.warnings,
  };
  const allocations = output.patients.map((p) => ({
    patient_id: p.id,
    status: p.status,
    priority_score: p.priority_score,
    allocated_resources: p.required_resources,
    start_time: p.start_time,
    completion_time: p.end_time,
    waiting_time: p.wait_time,
    arrival_time: p.arrival_time,
    urgency: p.urgency,
    condition: p.condition,
    treatment_time: p.treatment_time,
    emergency: p.emergency,
    decision: p.decision,
  }));
  return { run, result, allocations };
}

const newId = () => crypto.randomUUID();

/* -------------------------------------------------------------------------- */
/* Supabase implementation                                                    */
/* -------------------------------------------------------------------------- */

function check(error: { message: string; code?: string } | null, context: string): void {
  if (!error) return;
  if (error.code === "23505") throw new DuplicatePatientError();
  throw new DatabaseError(`${context}: ${error.message}`, error.code);
}

export function createSupabaseDatabase(client: SupabaseClient): Database {
  return {
    mode: "supabase",

    async ping() {
      const { error } = await client
        .from("resource_configurations")
        .select("id", { head: true, count: "exact" });
      check(error, "Database unreachable or schema missing");
    },

    async listPatients() {
      const { data, error } = await client
        .from("patients")
        .select("*")
        .order("created_at", { ascending: true })
        .order("patient_id", { ascending: true });
      check(error, "Could not load patients");
      return (data ?? []) as PatientRow[];
    },

    async insertPatients(patients) {
      if (patients.length === 0) return [];
      const rows = patients.map((p) => ({
        ...p,
        status: "waiting" as PatientStatus,
        priority_score: basePriorityScore(p),
      }));
      const { data, error } = await client.from("patients").insert(rows).select();
      check(error, "Could not save patients");
      return (data ?? []) as PatientRow[];
    },

    async deletePatient(patientId) {
      const { error } = await client.from("patients").delete().eq("patient_id", patientId);
      check(error, "Could not delete patient");
    },

    async clearPatients() {
      const { error } = await client.from("patients").delete().not("id", "is", null);
      check(error, "Could not clear patients");
    },

    async setPatientStatus(patientId, status) {
      const { error } = await client
        .from("patients")
        .update({ status })
        .eq("patient_id", patientId);
      check(error, "Could not update patient");
    },

    async updatePatients(rows) {
      if (rows.length === 0) return;
      const { error } = await client.from("patients").upsert(rows, { onConflict: "id" });
      check(error, "Could not update patients");
    },

    async getLatestResources() {
      const { data, error } = await client
        .from("resource_configurations")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(1);
      check(error, "Could not load resource configuration");
      return ((data ?? [])[0] as ResourceConfigRow | undefined) ?? null;
    },

    async saveResources(resources) {
      const { data, error } = await client
        .from("resource_configurations")
        .insert(resourceRowFields(resources))
        .select()
        .single();
      check(error, "Could not save resource configuration");
      return data as ResourceConfigRow;
    },

    async saveSimulation(output) {
      const records = runRecordsFromOutput(output);
      const { data: run, error: runError } = await client
        .from("simulation_runs")
        .insert({ ...records.run, status: "running" })
        .select()
        .single();
      check(runError, "Could not create simulation run");
      const runId = (run as RunRow).id;

      try {
        const { data: result, error: resultError } = await client
          .from("simulation_results")
          .insert({ ...records.result, simulation_run_id: runId })
          .select()
          .single();
        check(resultError, "Could not save simulation results");

        if (records.allocations.length > 0) {
          const { error: allocError } = await client
            .from("patient_allocations")
            .insert(records.allocations.map((a) => ({ ...a, simulation_run_id: runId })));
          check(allocError, "Could not save patient allocations");
        }

        const { data: done, error: doneError } = await client
          .from("simulation_runs")
          .update({ status: "completed" })
          .eq("id", runId)
          .select()
          .single();
        check(doneError, "Could not finalise simulation run");

        const { data: allocations } = await client
          .from("patient_allocations")
          .select("*")
          .eq("simulation_run_id", runId);
        return {
          run: done as RunRow,
          result: result as ResultRow,
          allocations: (allocations ?? []) as AllocationRow[],
        };
      } catch (err) {
        await client.from("simulation_runs").update({ status: "failed" }).eq("id", runId);
        throw err;
      }
    },

    async listRuns(limit = RUN_HISTORY_LIMIT) {
      const { data: runs, error } = await client
        .from("simulation_runs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(limit);
      check(error, "Could not load simulation history");
      const runRows = (runs ?? []) as RunRow[];
      if (runRows.length === 0) return [];
      const { data: results, error: resultError } = await client
        .from("simulation_results")
        .select("*")
        .in(
          "simulation_run_id",
          runRows.map((r) => r.id),
        );
      check(resultError, "Could not load simulation results");
      const byRun = new Map(
        ((results ?? []) as ResultRow[]).map((r) => [r.simulation_run_id, r]),
      );
      return runRows.map((run) => ({
        run,
        result: byRun.get(run.id) ?? null,
        allocations: [],
      }));
    },

    async getRun(id) {
      const { data: run, error } = await client
        .from("simulation_runs")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      check(error, "Could not load simulation run");
      if (!run) return null;
      const [{ data: result, error: e1 }, { data: allocations, error: e2 }] = await Promise.all([
        client.from("simulation_results").select("*").eq("simulation_run_id", id).maybeSingle(),
        client.from("patient_allocations").select("*").eq("simulation_run_id", id),
      ]);
      check(e1, "Could not load simulation results");
      check(e2, "Could not load patient allocations");
      return {
        run: run as RunRow,
        result: (result as ResultRow | null) ?? null,
        allocations: (allocations ?? []) as AllocationRow[],
      };
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Local (browser storage) implementation                                     */
/* -------------------------------------------------------------------------- */

/** Minimal storage interface so tests can inject an in-memory store. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function createMemoryStore(): KeyValueStore {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
  };
}

function browserStore(): KeyValueStore {
  try {
    const ls = window.localStorage;
    ls.setItem("medflow.probe", "1");
    ls.removeItem("medflow.probe");
    return ls;
  } catch {
    return createMemoryStore(); // storage blocked: works for this tab only
  }
}

/** Local history is capped so the browser's ~5 MB quota is never exceeded. */
const LOCAL_RUN_LIMIT = 25;

const KEYS = {
  patients: "medflow.patients",
  resources: "medflow.resources",
  runs: "medflow.runs",
  results: "medflow.results",
  allocations: "medflow.allocations",
} as const;

/**
 * Fallback used when Supabase credentials are missing or the database is
 * unreachable. Data persists in this browser only.
 */
export function createLocalDatabase(store: KeyValueStore = browserStore()): Database {
  const read = <T>(key: string): T[] => {
    try {
      const raw = store.getItem(key);
      return raw ? (JSON.parse(raw) as T[]) : [];
    } catch {
      return [];
    }
  };
  const write = (key: string, rows: unknown[]) => {
    try {
      store.setItem(key, JSON.stringify(rows));
    } catch {
      throw new DatabaseError("Browser storage is full or unavailable.", "storage");
    }
  };

  return {
    mode: "local",

    async ping() {
      /* always available */
    },

    async listPatients() {
      return read<PatientRow>(KEYS.patients);
    },

    async insertPatients(patients) {
      const existing = read<PatientRow>(KEYS.patients);
      const taken = new Set(existing.map((p) => p.patient_id.toLowerCase()));
      for (const p of patients) {
        const key = p.patient_id.toLowerCase();
        if (taken.has(key)) throw new DuplicatePatientError(`Patient ID "${p.patient_id}" already exists.`);
        taken.add(key);
      }
      const now = new Date().toISOString();
      const created: PatientRow[] = patients.map((p) => ({
        ...p,
        id: newId(),
        status: "waiting",
        priority_score: basePriorityScore(p),
        created_at: now,
      }));
      write(KEYS.patients, [...existing, ...created]);
      return created;
    },

    async deletePatient(patientId) {
      write(
        KEYS.patients,
        read<PatientRow>(KEYS.patients).filter((p) => p.patient_id !== patientId),
      );
    },

    async clearPatients() {
      write(KEYS.patients, []);
    },

    async setPatientStatus(patientId, status) {
      write(
        KEYS.patients,
        read<PatientRow>(KEYS.patients).map((p) =>
          p.patient_id === patientId ? { ...p, status } : p,
        ),
      );
    },

    async updatePatients(rows) {
      const byId = new Map(rows.map((r) => [r.id, r]));
      write(
        KEYS.patients,
        read<PatientRow>(KEYS.patients).map((p) => byId.get(p.id) ?? p),
      );
    },

    async getLatestResources() {
      const rows = read<ResourceConfigRow>(KEYS.resources);
      return rows.length > 0 ? rows[rows.length - 1] : null;
    },

    async saveResources(resources) {
      const row: ResourceConfigRow = {
        id: newId(),
        ...resourceRowFields(resources),
        created_at: new Date().toISOString(),
      };
      write(KEYS.resources, [...read<ResourceConfigRow>(KEYS.resources), row].slice(-20));
      return row;
    },

    async saveSimulation(output) {
      const records = runRecordsFromOutput(output);
      const now = new Date().toISOString();
      const run: RunRow = {
        id: newId(),
        ...records.run,
        status: "completed",
        created_at: now,
      };
      const result: ResultRow = {
        id: newId(),
        simulation_run_id: run.id,
        ...records.result,
        created_at: now,
      };
      const allocations: AllocationRow[] = records.allocations.map((a) => ({
        id: newId(),
        simulation_run_id: run.id,
        ...a,
      }));

      const runs = [...read<RunRow>(KEYS.runs), run];
      const dropped = new Set(runs.slice(0, Math.max(0, runs.length - LOCAL_RUN_LIMIT)).map((r) => r.id));
      const keptRuns = runs.filter((r) => !dropped.has(r.id));
      write(KEYS.runs, keptRuns);
      write(
        KEYS.results,
        [...read<ResultRow>(KEYS.results), result].filter((r) => !dropped.has(r.simulation_run_id)),
      );
      write(
        KEYS.allocations,
        [...read<AllocationRow>(KEYS.allocations), ...allocations].filter(
          (a) => !dropped.has(a.simulation_run_id),
        ),
      );
      return { run, result, allocations };
    },

    async listRuns(limit = RUN_HISTORY_LIMIT) {
      const results = new Map(
        read<ResultRow>(KEYS.results).map((r) => [r.simulation_run_id, r]),
      );
      return read<RunRow>(KEYS.runs)
        .slice()
        .reverse()
        .slice(0, limit)
        .map((run) => ({ run, result: results.get(run.id) ?? null, allocations: [] }));
    },

    async getRun(id) {
      const run = read<RunRow>(KEYS.runs).find((r) => r.id === id);
      if (!run) return null;
      return {
        run,
        result: read<ResultRow>(KEYS.results).find((r) => r.simulation_run_id === id) ?? null,
        allocations: read<AllocationRow>(KEYS.allocations).filter(
          (a) => a.simulation_run_id === id,
        ),
      };
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Connection                                                                 */
/* -------------------------------------------------------------------------- */

export interface Connection {
  db: Database;
  /** True when talking to Supabase Postgres. */
  connected: boolean;
  /** Human-readable explanation shown in the status bar. */
  message: string;
}

/**
 * Pick the database: Supabase when credentials exist and the schema answers,
 * otherwise the browser-storage fallback with an explanation.
 */
export async function connectDatabase(): Promise<Connection> {
  const config = getSupabaseConfigState();
  const client = getSupabase();
  if (!config.configured || !client) {
    return {
      db: createLocalDatabase(),
      connected: false,
      message: `${config.configured ? "" : config.reason} Using browser storage — data persists in this browser only.`.trim(),
    };
  }
  const supabase = createSupabaseDatabase(client);
  try {
    await supabase.ping();
    return { db: supabase, connected: true, message: "Connected to Supabase Postgres." };
  } catch (err) {
    const detail = err instanceof Error ? err.message : "unknown error";
    return {
      db: createLocalDatabase(),
      connected: false,
      message: `${detail}. Using browser storage — run supabase/schema.sql and check your credentials.`,
    };
  }
}

export { RESOURCE_KEYS };
