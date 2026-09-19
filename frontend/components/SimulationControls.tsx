"use client";

import { FlaskConical, Play, RotateCcw } from "lucide-react";
import { useState } from "react";
import { Button, Card, Field, NumberInput, Notice, cx, inputClass } from "./ui";
import { CONTRAST_MESSAGE } from "@/lib/demo";
import { useStore } from "@/lib/store";
import {
  PLACEHOLDER_NOTICE,
  RESOURCE_KEYS,
  RESOURCE_LABELS,
  STRATEGIES,
  STRATEGY_DESCRIPTIONS,
  STRATEGY_LABELS,
  type ResourceKey,
  type Weights,
} from "@/lib/simulation";
import { validateSimulationControls, type FieldErrors } from "@/lib/validation";

const WEIGHT_FIELDS: { key: keyof Weights; label: string; hint: string }[] = [
  { key: "alpha", label: "α urgency", hint: "per urgency level" },
  { key: "beta", label: "β waiting", hint: "per minute waited" },
  { key: "gamma", label: "γ risk", hint: "× deterioration risk (0–1)" },
  { key: "delta", label: "δ emergency", hint: "for surge arrivals" },
];

export function SimulationControls() {
  const { params, setParams, runSimulation, runContrast, resetRun, running, engineMode, patients, resourcesSaved } = useStore();
  const [errors, setErrors] = useState<FieldErrors>({});

  async function run() {
    const check = validateSimulationControls({
      duration: params.duration,
      surgeStart: params.surgeStart,
      failureStart: params.failureStart,
      failureUnits: params.failureUnits,
    });
    if (!check.ok) {
      setErrors(check.errors);
      return;
    }
    setErrors({});
    await runSimulation();
  }

  return (
    <Card title="Simulation controls" description="The same patients and resources are used for every strategy.">
      {engineMode === "placeholder" && (
        <Notice tone="yellow" className="mb-4">
          {PLACEHOLDER_NOTICE}
        </Notice>
      )}

      <fieldset>
        <legend className="mb-2 text-sm font-medium text-slate-800">Scheduling strategy</legend>
        <div className="grid gap-2 md:grid-cols-3">
          {STRATEGIES.map((s) => (
            <label
              key={s}
              className={cx(
                "flex cursor-pointer gap-2 rounded-md border p-3 text-sm",
                params.strategy === s ? "border-blue-600 bg-blue-50 ring-1 ring-blue-600" : "border-slate-300 bg-white hover:bg-slate-50",
              )}
            >
              <input type="radio" name="strategy" checked={params.strategy === s} onChange={() => setParams({ strategy: s })} className="mt-1 accent-blue-700" />
              <span>
                <span className="block font-semibold text-slate-900">{STRATEGY_LABELS[s]}</span>
                <span className="block text-xs text-slate-600">{STRATEGY_DESCRIPTIONS[s]}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <Field label="Planned duration (min)" htmlFor="duration" error={errors.duration} hint="observation period — the run continues past it until every patient is treated">
          <NumberInput id="duration" value={params.duration} min={1} step={5} invalid={!!errors.duration} onValue={(n) => setParams({ duration: n })} />
        </Field>

        <div className="rounded-md border border-slate-200 p-3">
          <label className="flex items-center gap-2 text-sm font-medium text-slate-900">
            <input type="checkbox" checked={params.emergencySurge} onChange={(e) => setParams({ emergencySurge: e.target.checked })} className="h-4 w-4 accent-blue-700" />
            Emergency surge
          </label>
          <p className="mt-1 text-xs text-slate-600">Adds {params.surgeCount} synthetic emergency arrivals, one per minute.</p>
          {params.emergencySurge && (
            <div className="mt-2">
              <Field label="Surge start (min)" htmlFor="surgeStart" error={errors.surgeStart}>
                <NumberInput id="surgeStart" value={params.surgeStart} min={0} invalid={!!errors.surgeStart} onValue={(n) => setParams({ surgeStart: n })} />
              </Field>
            </div>
          )}
        </div>

        <div className="rounded-md border border-slate-200 p-3">
          <label className="flex items-center gap-2 text-sm font-medium text-slate-900">
            <input type="checkbox" checked={params.resourceFailure} onChange={(e) => setParams({ resourceFailure: e.target.checked })} className="h-4 w-4 accent-blue-700" />
            Resource failure
          </label>
          <p className="mt-1 text-xs text-slate-600">Takes units offline (an occupied unit goes offline once freed).</p>
          {params.resourceFailure && (
            <div className="mt-2 grid grid-cols-3 gap-2">
              <Field label="Resource" htmlFor="failedResource">
                <select id="failedResource" className={inputClass} value={params.failedResource} onChange={(e) => setParams({ failedResource: e.target.value as ResourceKey })}>
                  {RESOURCE_KEYS.map((k) => (
                    <option key={k} value={k}>
                      {RESOURCE_LABELS[k]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Start (min)" htmlFor="failureStart" error={errors.failureStart}>
                <NumberInput id="failureStart" value={params.failureStart} min={0} invalid={!!errors.failureStart} onValue={(n) => setParams({ failureStart: n })} />
              </Field>
              <Field label="Units" htmlFor="failureUnits" error={errors.failureUnits}>
                <NumberInput id="failureUnits" value={params.failureUnits} min={1} invalid={!!errors.failureUnits} onValue={(n) => setParams({ failureUnits: n })} />
              </Field>
            </div>
          )}
        </div>
      </div>

      <details className="mt-4 rounded-md border border-slate-200 p-3">
        <summary className="cursor-pointer text-sm font-medium text-slate-800">Advanced: priority weights and thresholds</summary>
        <p className="mt-2 text-xs text-slate-600">
          S = α·urgency + β·waiting + γ·risk + δ·emergency. Weights only affect the Dynamic Priority strategy (and the score shown for the others).
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {WEIGHT_FIELDS.map((w) => (
            <Field key={w.key} label={w.label} htmlFor={`w-${w.key}`} hint={w.hint}>
              <NumberInput id={`w-${w.key}`} value={params.weights[w.key]} step={0.05} onValue={(n) => setParams({ weights: { ...params.weights, [w.key]: Number.isFinite(n) ? n : 0 } })} />
            </Field>
          ))}
          <Field label="Safety threshold (min)" htmlFor="safetyThreshold" hint="wait counted as a breach">
            <NumberInput id="safetyThreshold" value={params.safetyThreshold} min={1} onValue={(n) => setParams({ safetyThreshold: Number.isFinite(n) ? n : 30 })} />
          </Field>
          <Field label="Critical urgency ≥" htmlFor="criticalUrgency" hint="1–5">
            <NumberInput id="criticalUrgency" value={params.criticalUrgency} min={1} max={5} onValue={(n) => setParams({ criticalUrgency: Number.isFinite(n) ? Math.min(5, Math.max(1, Math.round(n))) : 4 })} />
          </Field>
        </div>
      </details>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button onClick={() => void run()} disabled={running}>
          <Play size={16} aria-hidden /> {running ? "Running…" : "Run Simulation"}
        </Button>
        <Button variant="secondary" onClick={() => void resetRun()} disabled={running}>
          <RotateCcw size={16} aria-hidden /> Reset Current Run
        </Button>
        <Button variant="secondary" onClick={() => void runContrast()} disabled={running}>
          <FlaskConical size={16} aria-hidden /> Load contrast scenario
        </Button>
        {(patients.length === 0 || !resourcesSaved) && (
          <span className="text-xs text-amber-700">
            {patients.length === 0 ? "Add patients first. " : ""}
            {!resourcesSaved ? "Save a resource configuration first." : ""}
          </span>
        )}
      </div>
      <p className="mt-2 text-xs text-slate-600">
        <strong>Contrast scenario:</strong> {CONTRAST_MESSAGE} It replaces the current patients and resources with a small deterministic example.
      </p>
    </Card>
  );
}
