import { runSimulation } from "./engine";
import { runPlaceholderSimulation } from "./placeholder";
import type { ResourceSet, SimParams, SimPatient, SimulationOutput } from "./types";

export * from "./types";
export * from "./resources";
export * from "./policies";
export * from "./metrics";
export * from "./compare";
export * from "./efficiency";
export * from "./advice";
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

/**
 * "real" runs the calculated scheduling engine. Set
 * NEXT_PUBLIC_SIMULATION_ENGINE=placeholder to force the clearly-labelled
 * placeholder engine (for example while wiring in a different backend).
 */
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
