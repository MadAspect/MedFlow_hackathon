"use client";

import { FlaskConical, Play, RotateCcw } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Badge, Button, Card, Field, InfoTip, NumberInput, Notice, Segmented, Switch, inputClass } from "./ui";
import { CONTRAST_MESSAGE } from "@/lib/demo";
import { useStore } from "@/lib/store";
import {
  AMBULANCE_GRACE,
  APPOINTMENT_GRACE,
  FCFS_NOTE,
  PLACEHOLDER_NOTICE,
  RESOURCE_KEYS,
  RESOURCE_LABELS,
  STRATEGIES,
  STRATEGY_DESCRIPTIONS,
  type ResourceKey,
  type Strategy,
  type Weights,
} from "@/lib/simulation";
import { validateSimulationControls, type FieldErrors } from "@/lib/validation";

const WEIGHT_FIELDS: { key: keyof Weights; label: string; hint: string }[] = [
  { key: "alpha", label: "α urgency", hint: "per urgency level" },
  { key: "beta", label: "β waiting", hint: "per minute waited" },
  { key: "gamma", label: "γ risk", hint: "× risk (0–1)" },
  { key: "delta", label: "δ emergency", hint: "for surge arrivals" },
];

const STRATEGY_SHORT: Record<Strategy, { label: string; summary: string }> = {
  fcfs: { label: "First-come", summary: "Arrival order. The baseline." },
  urgency: { label: "Urgency", summary: "Most urgent patient first." },
  dynamic: { label: "Dynamic", summary: "Urgency, waiting time and risk." },
  hazard: { label: "Harm-density", summary: "Most harm relieved per scarce resource." },
};

function Group({ label, info, children }: { label: string; info?: ReactNode; children: ReactNode }) {
  return (
    <div>
      <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-slate-500 uppercase">
        {label}
        {info && <InfoTip align="left">{info}</InfoTip>}
      </p>
      {children}
    </div>
  );
}

export function SimulationControls({ onRan }: { onRan?: () => void } = {}) {
  const { params, setParams, runSimulation, runContrast, resetRun, running, engineMode, patients, resourcesSaved, liveReplay, setLiveReplay } = useStore();
  const [errors, setErrors] = useState<FieldErrors>({});
  const bookedCount = patients.filter((p) => p.appointment && p.status !== "cancelled").length;
  const ambulanceCount = patients.filter((p) => p.alert_time != null && p.status !== "cancelled").length;

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
    if (await runSimulation()) onRan?.();
  }

  const notReady = patients.length === 0 || !resourcesSaved;

  return (
    <Card title="Run a simulation" actions={<Switch checked={liveReplay} onChange={setLiveReplay} label="Live replay" infoAlign="right" info="After a run, play it back minute by minute. The charts and cards fill in as the clock moves. Turn off to jump straight to the end." />}>
      {engineMode === "placeholder" && (
        <Notice tone="yellow" className="mb-4">
          {PLACEHOLDER_NOTICE}
        </Notice>
      )}

      <div className="grid gap-x-10 gap-y-6 md:grid-cols-2">
        <Group
          label="Strategy"
          info={
            <>
              {FCFS_NOTE}
              <span className="mt-2 block">
                <strong>Urgency:</strong> {STRATEGY_DESCRIPTIONS.urgency}
              </span>
              <span className="mt-2 block">
                <strong>Dynamic:</strong> {STRATEGY_DESCRIPTIONS.dynamic}
              </span>
            </>
          }
        >
          <Segmented
            label="Scheduling strategy"
            value={params.strategy}
            onChange={(s) => setParams({ strategy: s })}
            options={STRATEGIES.map((s) => ({ value: s, label: STRATEGY_SHORT[s].label }))}
          />
          <p className="mt-2 text-[13px] text-slate-500">{STRATEGY_SHORT[params.strategy].summary}</p>
        </Group>

        <Group label="Duration">
          <Field label="Planned minutes" htmlFor="duration" error={errors.duration}>
            <NumberInput id="duration" value={params.duration} min={1} step={5} invalid={!!errors.duration} onValue={(n) => setParams({ duration: n })} className="w-32" />
          </Field>
        </Group>

        <Group label="Scenario">
          <div className="space-y-3">
            <div>
              <Switch
                checked={params.emergencySurge}
                onChange={(on) => setParams({ emergencySurge: on })}
                label="Emergency surge"
                info={`Adds ${params.surgeCount} emergency arrivals, one per minute, from the start minute.`}
              />
              {params.emergencySurge && (
                <div className="mt-2 ml-11 max-w-40">
                  <Field label="Starts at minute" htmlFor="surgeStart" error={errors.surgeStart}>
                    <NumberInput id="surgeStart" value={params.surgeStart} min={0} invalid={!!errors.surgeStart} onValue={(n) => setParams({ surgeStart: n })} />
                  </Field>
                </div>
              )}
            </div>
            <div>
              <Switch
                checked={params.resourceFailure}
                onChange={(on) => setParams({ resourceFailure: on })}
                label="Resource failure / staff shortage"
                info="Takes units of one resource offline. Choose Doctors or Nurses to simulate a staff shortage, or a bed, ICU bed or operating room for equipment failure. A unit that is in use goes offline once it is freed."
              />
              {params.resourceFailure && (
                <div className="mt-2 ml-11 grid max-w-md grid-cols-3 gap-2">
                  <Field label="Resource" htmlFor="failedResource">
                    <select id="failedResource" className={inputClass} value={params.failedResource} onChange={(e) => setParams({ failedResource: e.target.value as ResourceKey })}>
                      {RESOURCE_KEYS.map((k) => (
                        <option key={k} value={k}>
                          {RESOURCE_LABELS[k]}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="At minute" htmlFor="failureStart" error={errors.failureStart}>
                    <NumberInput id="failureStart" value={params.failureStart} min={0} invalid={!!errors.failureStart} onValue={(n) => setParams({ failureStart: n })} />
                  </Field>
                  <Field label="Units" htmlFor="failureUnits" error={errors.failureUnits}>
                    <NumberInput id="failureUnits" value={params.failureUnits} min={1} invalid={!!errors.failureUnits} onValue={(n) => setParams({ failureUnits: n })} />
                  </Field>
                </div>
              )}
            </div>
          </div>
        </Group>

        <Group label="Safeguards">
          <div className="space-y-3">
            <Switch
              checked={params.protectAppointments !== false}
              onChange={(on) => setParams({ protectAppointments: on })}
              ariaLabel="Protect appointments"
              label={
                <span className="inline-flex items-center gap-2">
                  Protect appointments <Badge tone={bookedCount > 0 ? "blue" : "grey"}>{bookedCount} booked</Badge>
                </span>
              }
              info={`Keeps resources free for booked slots so an appointment starts within ${APPOINTMENT_GRACE} minutes of its time. Walk-ins may be held back briefly. Top-urgency patients (5) are never held.${bookedCount === 0 ? " Book some on the Appointments page." : ""}`}
            />
            <Switch
              checked={params.preAlert !== false}
              onChange={(on) => setParams({ preAlert: on })}
              ariaLabel="Act on ambulance pre-alerts"
              label={
                <span className="inline-flex items-center gap-2">
                  Act on ambulance pre-alerts <Badge tone={ambulanceCount > 0 ? "red" : "grey"}>{ambulanceCount} inbound</Badge>
                </span>
              }
              info={`From the moment the hospital is warned, resources an ambulance patient will need are kept free so they start within ${AMBULANCE_GRACE} minutes of arriving. Walk-ins may be held back briefly. Top-urgency patients (5) are never held.${ambulanceCount === 0 ? " Log some on the Ambulances page." : ""}`}
            />
            <Switch
              checked={params.reservation === true}
              onChange={(on) => setParams({ reservation: on })}
              label="Protect blocked critical patients"
              info="When the top-ranked patient is critical (or past the safety limit) and waiting for resources, the earliest start is reserved for them so smaller cases cannot starve them. Trade-off: some capacity can sit idle."
            />
          </div>
        </Group>
      </div>

      <details className="group mt-6 rounded-lg border border-slate-200 open:bg-slate-50/50">
        <summary className="flex cursor-pointer list-none items-center justify-between px-3.5 py-2.5 text-sm font-medium text-slate-700 select-none">
          Advanced: priority weights and thresholds
          <span aria-hidden className="text-slate-400 transition-transform group-open:rotate-180">
            ▾
          </span>
        </summary>
        <div className="border-t border-slate-200 px-3.5 py-3.5">
          <p className="mb-3 text-xs text-slate-500">Score S = α·urgency + β·waiting + γ·risk + δ·emergency. Weights only steer the Dynamic strategy.</p>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {WEIGHT_FIELDS.map((w) => (
              <Field key={w.key} label={w.label} htmlFor={`w-${w.key}`} hint={w.hint}>
                <NumberInput id={`w-${w.key}`} value={params.weights[w.key]} step={0.05} onValue={(n) => setParams({ weights: { ...params.weights, [w.key]: Number.isFinite(n) ? n : 0 } })} />
              </Field>
            ))}
            <Field label="Safety limit (min)" htmlFor="safetyThreshold" hint="wait counted as a breach">
              <NumberInput id="safetyThreshold" value={params.safetyThreshold} min={1} onValue={(n) => setParams({ safetyThreshold: Number.isFinite(n) ? n : 30 })} />
            </Field>
            <Field label="Critical from urgency" htmlFor="criticalUrgency" hint="1–5">
              <NumberInput id="criticalUrgency" value={params.criticalUrgency} min={1} max={5} onValue={(n) => setParams({ criticalUrgency: Number.isFinite(n) ? Math.min(5, Math.max(1, Math.round(n))) : 4 })} />
            </Field>
          </div>
        </div>
      </details>

      <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-5">
        <Button onClick={() => void run()} disabled={running || notReady} className="min-w-40">
          <Play size={15} aria-hidden /> {running ? "Running…" : "Run simulation"}
        </Button>
        <Button variant="secondary" onClick={() => void resetRun()} disabled={running}>
          <RotateCcw size={15} aria-hidden /> Reset
        </Button>
        <span className="inline-flex items-center gap-1.5">
          <Button variant="secondary" onClick={() => void runContrast()} disabled={running}>
            <FlaskConical size={15} aria-hidden /> Contrast scenario
          </Button>
          <InfoTip align="right">{CONTRAST_MESSAGE} It replaces the current patients and resources with a small deterministic example.</InfoTip>
        </span>
        {notReady && (
          <span className="text-xs text-amber-700">
            {patients.length === 0 ? "Add patients first. " : ""}
            {!resourcesSaved ? "Save a resource configuration first." : ""}
          </span>
        )}
      </div>
    </Card>
  );
}
