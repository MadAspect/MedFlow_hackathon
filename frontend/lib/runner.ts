import {
  resourcesFromRow,
  type AllocationRow,
  type Database,
  type PatientRow,
  type PatientStatus,
  type ResourceConfigRow,
  type StoredRun,
} from "./database";
import {
  objectiveScore,
  runEngine,
  type EngineMode,
  type Metrics,
  type OutcomeStatus,
  type PatientOutcome,
  type SimParams,
  type SimPatient,
  type SimulationOutput,
} from "./simulation";

export class RunPreconditionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunPreconditionError";
  }
}

/** Cancelled patients are left out of every simulation. */
export function toSimPatients(rows: PatientRow[]): SimPatient[] {
  return rows
    .filter((p) => p.status !== "cancelled")
    .map((p) => ({
      id: p.patient_id,
      condition: p.condition,
      arrival_time: p.arrival_time,
      urgency: p.urgency,
      treatment_time: p.treatment_time,
      required_resources: p.required_resources,
    }));
}

export function patientStatusFromOutcome(status: OutcomeStatus): PatientStatus {
  return status === "not_arrived" ? "waiting" : status;
}

export interface RunResult {
  output: SimulationOutput;
  stored: StoredRun;
  /** Patient rows after their statuses/scores were updated from this run. */
  patients: PatientRow[];
}

/**
 * The full "Run Simulation" pipeline:
 * load patients + latest resources → validate → run the engine →
 * save run/results/allocations → update patient statuses.
 */
export async function executeRun(
  db: Database,
  params: Partial<SimParams>,
  mode?: EngineMode,
): Promise<RunResult> {
  const [patientRows, resourceRow] = await Promise.all([
    db.listPatients(),
    db.getLatestResources(),
  ]);
  const simPatients = toSimPatients(patientRows);
  if (simPatients.length === 0) {
    throw new RunPreconditionError("Add or load patients before running a simulation.");
  }
  if (!resourceRow) {
    throw new RunPreconditionError("Save a resource configuration before running a simulation.");
  }

  const output = runEngine(simPatients, resourcesFromRow(resourceRow), params, mode);
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

/** Put every non-cancelled patient back to "waiting" (Reset Current Run). */
export async function resetPatientStatuses(db: Database): Promise<PatientRow[]> {
  const rows = await db.listPatients();
  const reset = rows.map((r) => (r.status === "cancelled" ? r : { ...r, status: "waiting" as PatientStatus }));
  await db.updatePatients(reset);
  return reset;
}

function outcomeFromAllocation(a: AllocationRow): PatientOutcome {
  return {
    id: a.patient_id,
    condition: a.condition,
    arrival_time: a.arrival_time,
    urgency: a.urgency,
    treatment_time: a.treatment_time,
    required_resources: a.allocated_resources,
    emergency: a.emergency,
    status: a.status,
    start_time: a.start_time,
    end_time: a.completion_time,
    wait_time: a.waiting_time,
    priority_score: a.priority_score,
    decision: a.decision,
  };
}

/**
 * Rebuild the displayable output of a saved run (used by History and after a refresh).
 * Runs saved by earlier versions lack the completion fields, so they are derived
 * here from what was stored (those runs stopped at the configured duration).
 */
export function outputFromStoredRun(stored: StoredRun): SimulationOutput | null {
  if (!stored.result) return null;
  const patients = stored.allocations.map(outcomeFromAllocation);
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
  };
}

export type { ResourceConfigRow };
