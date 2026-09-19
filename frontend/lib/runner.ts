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
  runEngine,
  type EngineMode,
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

/** Rebuild the displayable output of a saved run (used by History and after a refresh). */
export function outputFromStoredRun(stored: StoredRun): SimulationOutput | null {
  if (!stored.result) return null;
  return {
    strategy: stored.run.strategy as SimulationOutput["strategy"],
    params: stored.run.parameters.params,
    resources: stored.run.parameters.resources,
    patients: stored.allocations.map(outcomeFromAllocation),
    metrics: stored.result.metrics,
    timeline: stored.result.timeline,
    warnings: stored.result.warnings,
    isPlaceholder: stored.run.is_placeholder,
    engine: stored.run.engine,
  };
}

export type { ResourceConfigRow };
