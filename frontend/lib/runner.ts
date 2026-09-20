import {
  resourcesFromRow,
  type AllocationRow,
  type Database,
  type PatientRow,
  type PatientStatus,
  type ResourceConfigRow,
  type StoredRun,
} from "./database";
import { requirementsByPatient, stockConstraintsEnabled, toStockConstraints } from "./inventory";
import { effectiveResources } from "./staff";
import {
  objectiveScore,
  runEngine,
  type EngineMode,
  type Metrics,
  type OutcomeStatus,
  type PatientOutcome,
  type ResourceSet,
  type SimParams,
  type SimPatient,
  type SimulationOutput,
  type StockRequirement,
} from "./simulation";

export class RunPreconditionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunPreconditionError";
  }
}

export function toSimPatients(
  rows: PatientRow[],
  stockRequirements: Map<string, StockRequirement[]> = new Map(),
): SimPatient[] {
  return rows
    .filter((p) => p.status !== "cancelled")
    .map((p) => ({
      id: p.patient_id,
      condition: p.condition,
      arrival_time: p.arrival_time,
      urgency: p.urgency,
      treatment_time: p.treatment_time,
      required_resources: p.required_resources,
      ...(p.appointment ? { appointment: true } : {}),
      ...(p.alert_time != null ? { ambulance: { alert_time: p.alert_time } } : {}),
      ...(stockRequirements.has(p.patient_id) ? { stock_requirements: stockRequirements.get(p.patient_id) } : {}),
    }));
}

export interface RunOptions {
  /**
   * Use these resources as they are. A live re-run passes the resources the running simulation
   * started with, so the start of the run is exactly as it was and only the new event differs.
   */
  resources?: ResourceSet;
}

export function patientStatusFromOutcome(status: OutcomeStatus): PatientStatus {
  return status === "not_arrived" ? "waiting" : status;
}

export interface RunResult {
  output: SimulationOutput;
  stored: StoredRun;
  patients: PatientRow[];
}

export async function executeRun(
  db: Database,
  params: Partial<SimParams>,
  mode?: EngineMode,
  options: RunOptions = {},
): Promise<RunResult> {
  const [patientRows, resourceRow] = await Promise.all([
    db.listPatients(),
    db.getLatestResources(),
  ]);
  if (patientRows.every((p) => p.status === "cancelled")) {
    throw new RunPreconditionError("Add or load patients before running a simulation.");
  }
  if (!resourceRow && !options.resources) {
    throw new RunPreconditionError("Save a resource configuration before running a simulation.");
  }

  // Stock is opt-in (see stockConstraintsEnabled). A run that already carries a snapshot, which is
  // what a live re-run passes, keeps it, so the inventory it started with never shifts underneath it.
  let stockRequirements = new Map<string, StockRequirement[]>();
  let runParams = params;
  if (stockConstraintsEnabled() || params.stock !== undefined) {
    const [medicines, equipment, requirementRows] = await Promise.all([
      db.listMedicines(),
      db.listEquipment(),
      db.listStockRequirements(),
    ]);
    stockRequirements = requirementsByPatient(requirementRows);
    if (params.stock === undefined) runParams = { ...params, stock: toStockConstraints(medicines, equipment) };
  }
  const simPatients = toSimPatients(patientRows, stockRequirements);

  // Doctors and nurses who are not available take a unit off the configured capacity from minute 0.
  const resources = options.resources ?? effectiveResources(resourcesFromRow(resourceRow!), await db.listStaff());

  const output = runEngine(simPatients, resources, runParams, mode);
  const stored = await db.saveSimulation(output);

  const outcomes = new Map(output.patients.map((o) => [o.id, o]));
  const updated: PatientRow[] = patientRows.map((row) => {
    const outcome = outcomes.get(row.patient_id);
    if (!outcome || row.status === "cancelled") return row;
    return {
      ...row,
      status: patientStatusFromOutcome(outcome.status),
      priority_score: outcome.priority_score,
    };
  });
  await db.updatePatients(updated);

  return { output, stored, patients: updated };
}

export async function resetPatientStatuses(db: Database): Promise<PatientRow[]> {
  const rows = await db.listPatients();
  const reset = rows.map((r) => (r.status === "cancelled" ? r : { ...r, status: "waiting" as PatientStatus }));
  await db.updatePatients(reset);
  return reset;
}

function outcomeFromAllocation(
  a: AllocationRow,
  appointments: Set<string>,
  ambulances: Record<string, number>,
  stockRequirements: Record<string, StockRequirement[]>,
): PatientOutcome {
  return {
    ...(stockRequirements[a.patient_id] ? { stock_requirements: stockRequirements[a.patient_id] } : {}),
    id: a.patient_id,
    condition: a.condition,
    arrival_time: a.arrival_time,
    urgency: a.urgency,
    treatment_time: a.treatment_time,
    required_resources: a.allocated_resources,
    emergency: a.emergency,
    appointment: appointments.has(a.patient_id),
    ambulance: a.patient_id in ambulances,
    alert_time: ambulances[a.patient_id] ?? null,
    status: a.status,
    start_time: a.start_time,
    end_time: a.completion_time,
    wait_time: a.waiting_time,
    priority_score: a.priority_score,
    decision: a.decision,
  };
}

export function outputFromStoredRun(stored: StoredRun): SimulationOutput | null {
  if (!stored.result) return null;
  // Which patients were booked is kept in the run's parameters (no extra table column needed).
  const appointments = new Set(stored.run.parameters.appointments ?? []);
  const ambulances = stored.run.parameters.ambulances ?? {};
  const stockRequirements = stored.run.parameters.stock_requirements ?? {};
  const patients = stored.allocations.map((a) => outcomeFromAllocation(a, appointments, ambulances, stockRequirements));
  const params = stored.run.parameters.params;
  const base = stored.result.metrics;
  const saved: Partial<Metrics> = base;
  const arrived = patients.filter((p) => p.status !== "not_arrived");
  const totalWait = arrived.reduce((s, p) => s + p.wait_time, 0);
  const criticalTotal = arrived
    .filter((p) => p.urgency >= params.criticalUrgency)
    .reduce((s, p) => s + p.wait_time, 0);
  const metrics: Metrics = {
    ...base,
    configured_duration: saved.configured_duration ?? params.duration,
    actual_completion_time: saved.actual_completion_time ?? params.duration,
    total_waiting_time: saved.total_waiting_time ?? totalWait,
    critical_wait_total: saved.critical_wait_total ?? criticalTotal,
    resource_overload: saved.resource_overload ?? 0,
    objective_score:
      saved.objective_score ??
      objectiveScore({
        total_waiting_time: totalWait,
        critical_wait_total: criticalTotal,
        patients_remaining: base.patients_remaining,
        resource_overload: 0,
        maximum_wait: base.maximum_wait,
        // Old runs did not store a completion time; the last stored treatment end is the real one.
        completion_time: patients.reduce((latest, p) => Math.max(latest, p.end_time ?? 0), 0),
      }),
  };
  const flagged = stored.result.warnings.find((w) => w.code === "simulation_incomplete");
  const error =
    flagged?.message ??
    (metrics.patients_remaining > 0
      ? `${metrics.patients_remaining} patient(s) were not treated. This run was saved by an earlier version that stopped at the configured duration; run it again to continue until everyone is treated.`
      : null);
  return {
    strategy: stored.run.strategy as SimulationOutput["strategy"],
    params,
    resources: stored.run.parameters.resources,
    patients,
    metrics,
    timeline: stored.result.timeline,
    warnings: stored.result.warnings,
    completed: error === null && metrics.patients_remaining === 0,
    error,
    isPlaceholder: stored.run.is_placeholder,
    engine: stored.run.engine,
    ...(stored.run.parameters.stock_outcome ? { stock: stored.run.parameters.stock_outcome } : {}),
  };
}

export type { ResourceConfigRow };
