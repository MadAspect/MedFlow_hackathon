import { runSimulation } from "./engine";
import { runPlaceholderSimulation } from "./placeholder";
import type { ResourceSet, SimParams, SimPatient, SimulationOutput } from "./types";

export * from "./types";
export * from "./resources";
export * from "./policies";
export * from "./hazard";
export * from "./metrics";
export * from "./compare";
export * from "./efficiency";
export * from "./advice";
export * from "./ambulance";
export * from "./appointments";
export * from "./live";
export {
  ENGINE_NAME,
  SimulationInputError,
  assertValidInput,
  defaultParams,
  runAllStrategies,
  runSimulation,
} from "./engine";
export { generateSurgePatients } from "./surge";
export { PLACEHOLDER_ENGINE_NAME, runPlaceholderSimulation } from "./placeholder";

export type EngineMode = "real" | "placeholder";

export function activeEngineMode(): EngineMode {
  return process.env.NEXT_PUBLIC_SIMULATION_ENGINE === "placeholder" ? "placeholder" : "real";
}

export function runEngine(
  patients: SimPatient[],
  resources: ResourceSet,
  params: Partial<SimParams>,
  mode: EngineMode = activeEngineMode(),
): SimulationOutput {
  return mode === "placeholder"
    ? runPlaceholderSimulation(patients, resources, params)
    : runSimulation(patients, resources, params);
}
