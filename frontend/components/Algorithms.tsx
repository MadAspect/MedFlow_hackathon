"use client";

import { useState, type ReactNode } from "react";
import { Badge, Card, Segmented, fmt1 } from "./ui";
import {
  AMBULANCE_GRACE,
  APPOINTMENT_GRACE,
  DEFAULT_WEIGHTS,
  ENGINE_NAME,
  HAZARD_PARAMS,
  MAX_AMBULANCE_MINUTES,
  OBJECTIVE_WEIGHTS,
  RISK_TIME_CONSTANT,
  SLOT_STEP,
  hazardScore,
  resourcePrices,
  scoreBreakdown,
  type ResourceSet,
  type SimPatient,
} from "@/lib/simulation";

/**
 * What the simulation actually does, written next to the numbers it uses. Every constant and every
 * worked example below is read from the engine itself, so this page cannot drift from the code.
 */

const Formula = ({ children }: { children: ReactNode }) => (
  <pre className="overflow-x-auto rounded-lg border border-slate-200 bg-slate-100/70 px-3 py-2 font-mono text-[13px] leading-relaxed whitespace-pre text-slate-800">{children}</pre>
);

const Where = ({ items }: { items: [string, string][] }) => (
  <dl className="grid gap-x-4 gap-y-1 text-[13px] sm:grid-cols-[auto_1fr]">
    {items.map(([symbol, meaning]) => (
      <div key={symbol} className="contents">
        <dt className="font-mono font-semibold text-slate-800">{symbol}</dt>
        <dd className="text-slate-600">{meaning}</dd>
      </div>
    ))}
  </dl>
);

const Steps = ({ items }: { items: ReactNode[] }) => (
  <ol className="list-decimal space-y-1.5 pl-5 text-sm text-slate-700">
    {items.map((s, i) => (
      <li key={i}>{s}</li>
    ))}
  </ol>
);

const H = ({ children }: { children: ReactNode }) => <h3 className="mt-4 mb-1.5 text-xs font-semibold tracking-wide text-slate-500 uppercase first:mt-0">{children}</h3>;
const P = ({ children }: { children: ReactNode }) => <p className="text-sm leading-relaxed text-slate-700">{children}</p>;

// ---- worked examples, computed with the real functions ------------------------------------------------

const SAMPLE_CAPACITY: ResourceSet = { doctor: 2, nurse: 4, bed: 6, icu_bed: 2, operating_room: 1 };
const sample = (over: Partial<SimPatient>): SimPatient => ({
  id: "X",
  condition: "Example",
  arrival_time: 0,
  urgency: 4,
  treatment_time: 30,
  required_resources: { doctor: 1, bed: 1 },
  ...over,
});

const dyn = scoreBreakdown(sample({ urgency: 4 }), 20, DEFAULT_WEIGHTS);
const dynMinor = scoreBreakdown(sample({ urgency: 3 }), 35, DEFAULT_WEIGHTS);
const hzPatient = sample({ urgency: 4, treatment_time: 30, required_resources: { doctor: 1, bed: 1 } });
const hz = hazardScore(hzPatient, 30, resourcePrices([hzPatient], SAMPLE_CAPACITY), SAMPLE_CAPACITY).hazard!;
const overtakeMinutes = DEFAULT_WEIGHTS.alpha / DEFAULT_WEIGHTS.beta;

// ---- sections ---------------------------------------------------------------------------------------------

interface Section {
  id: string;
  group: "strategy" | "scenario" | "measure";
  title: string;
  tag: string;
  body: ReactNode;
}

const SECTIONS: Section[] = [
  {
    id: "engine",
    group: "strategy",
    title: "Shared engine (all four strategies)",
    tag: ENGINE_NAME,
    body: (
      <>
        <P>
          Every strategy runs on the same deterministic discrete-event engine. There is no randomness: the same patients, resources and settings always give the same run. A strategy only decides the
          order in which waiting patients are considered; everything else below is identical, which is what makes the strategies comparable.
        </P>
        <H>Each simulated minute t</H>
        <Steps
          items={[
            "Patients whose arrival time ≤ t join the queue.",
            "Treatments with start + duration ≤ t finish and return their doctors, nurses, beds and equipment units.",
            "The queue is ranked by the chosen strategy (next sections). Ties break by arrival time, then patient id, so the order is total.",
            "Walking down the ranked list, a patient starts only if every resource and every requested stock item is available together. It is all or nothing: nothing is taken for a patient who cannot start.",
            "The clock jumps straight to the next event: the next arrival, the next treatment ending, a staff member returning, or a failure starting. Nothing changes in between, so no minutes are wasted.",
          ]}
        />
        <H>Safety limits</H>
        <P>
          The loop is capped at 4·n + 16 + 2·(staff changes) iterations for n patients. If nobody can start and nothing is left to arrive or finish, the run stops and names what is missing (for
          example &ldquo;needs 2 ICU beds but only 1 exists&rdquo;) instead of looping forever.
        </P>
      </>
    ),
  },
  {
    id: "fcfs",
    group: "strategy",
    title: "First-Come, First-Served",
    tag: "Baseline",
    body: (
      <>
        <P>Whoever arrived first is considered first. It ignores how sick anyone is, so it is the baseline the other strategies are measured against.</P>
        <H>Ordering key</H>
        <Formula>{"sort by ( arrival_time ↑ , patient_id ↑ )"}</Formula>
        <P>Each decision costs O(q log q) for a queue of q patients, from sorting.</P>
      </>
    ),
  },
  {
    id: "urgency",
    group: "strategy",
    title: "Urgency Only",
    tag: "Strict priority",
    body: (
      <>
        <P>The most urgent patient always goes first; equal urgency falls back to arrival order. Critical cases are protected, but a stream of urgent arrivals can starve minor ones indefinitely.</P>
        <H>Ordering key</H>
        <Formula>{"sort by ( urgency ↓ , arrival_time ↑ , patient_id ↑ )"}</Formula>
        <P>Urgency is an integer from 1 (low) to 5 (critical).</P>
      </>
    ),
  },
  {
    id: "dynamic",
    group: "strategy",
    title: "Dynamic Priority",
    tag: "Weighted linear score",
    body: (
      <>
        <P>Each waiting patient gets a score that grows with urgency, with how long they have waited, and with a saturating deterioration risk. The highest score goes first, so waiting slowly lifts low-urgency patients.</P>
        <H>Score</H>
        <Formula>{`S = α·u + β·w + γ·r + δ·e\n\nw = max(0, T − arrival)                 minutes waited at decision time T\nr = (u / 5) · (1 − e^(−w / ${RISK_TIME_CONSTANT}))          deterioration risk, rising from 0 towards u/5`}</Formula>
        <Where
          items={[
            ["α = " + DEFAULT_WEIGHTS.alpha, "weight on urgency u (1–5)"],
            ["β = " + DEFAULT_WEIGHTS.beta, "weight per minute waited"],
            ["γ = " + DEFAULT_WEIGHTS.gamma, "weight on deterioration risk r"],
            ["δ = " + DEFAULT_WEIGHTS.delta, "bonus when e = 1 (emergency, such as a surge patient)"],
          ]}
        />
        <H>Why it works</H>
        <P>
          One urgency level is worth α = {DEFAULT_WEIGHTS.alpha} points and one minute of waiting is worth β = {DEFAULT_WEIGHTS.beta}, so a patient one level lower overtakes after waiting about α / β ≈{" "}
          {fmt1(overtakeMinutes)} minutes longer (ignoring the small risk term). The risk term r rises quickly at first and then flattens (time constant {RISK_TIME_CONSTANT} min), so it cannot dominate.
        </P>
        <H>Worked example (computed live)</H>
        <Formula>{`urgency 4, waited 20 min:\n  α·u = ${fmt1(dyn.urgency)}   β·w = ${fmt1(dyn.waiting)}   γ·r = ${dyn.risk.toFixed(2)}   S = ${dyn.total.toFixed(2)}\nurgency 3, waited 35 min:\n  α·u = ${fmt1(dynMinor.urgency)}   β·w = ${fmt1(dynMinor.waiting)}   γ·r = ${dynMinor.risk.toFixed(2)}   S = ${dynMinor.total.toFixed(2)}`}</Formula>
        <P>Weights can be changed in the simulation controls; ties break on higher urgency, then earlier arrival, then id.</P>
      </>
    ),
  },
  {
    id: "hazard",
    group: "strategy",
    title: "Harm-Density Index",
    tag: "Harm per scarce resource-hour",
    body: (
      <>
        <P>
          There are no weights to tune. Each patient has a harm rate that doubles with every urgency level and accelerates with waiting. The index divides that by how much scarce resource the treatment
          would use, so the patient who relieves the most harm per unit of scarce resource goes first. It is a resource-aware generalisation of Smith&rsquo;s rule (weight ÷ processing cost) from scheduling theory.
        </P>
        <H>Harm rate</H>
        <Formula>{`h(w) = 2^(u + e − 1) · (1 + w / τ)^κ           τ = ${HAZARD_PARAMS.tau} min,  κ = ${HAZARD_PARAMS.kappa}\n\ncumulative harm  H(w) = base · τ/(κ+1) · ((1 + w/τ)^(κ+1) − 1)`}</Formula>
        <H>Scarcity prices and footprint</H>
        <Formula>{`p_k = 1 + D_k / max(1, C_k)                    price of resource k\nc   = (treatment_minutes / 60) · Σ_k  p_k · n_k / max(1, C_k)\nI   = h(w) / c                                  patients are ranked by I, highest first`}</Formula>
        <Where
          items={[
            ["u, e", "urgency 1–5; e = 1 for an emergency (adds one level)"],
            ["w", "minutes waited"],
            ["D_k", "units of resource k requested by everyone currently in the queue"],
            ["C_k", "units of resource k available right now (after failures and staff changes)"],
            ["n_k", "units of k this patient needs"],
          ]}
        />
        <H>Worked example (computed live)</H>
        <Formula>{`urgency 4, waited 30 min, 30-min treatment needing 1 doctor + 1 bed\n(hospital: 2 doctors, 4 nurses, 6 beds, 2 ICU beds, 1 OR; only this patient queued)\n  base rate 2^3 = ${fmt1(hz.base_rate)}   wait factor (1+30/30)^2 = ${fmt1(hz.wait_factor)}   h = ${fmt1(hz.harm_rate)}\n  footprint c = ${hz.footprint.toFixed(3)}   →   I = h / c = ${fmt1(hz.index)}`}</Formula>
        <P>Because prices rise when a resource is in short supply relative to demand, patients who need contested resources are ranked lower until demand eases. Nobody starves, since h grows without bound as w grows.</P>
      </>
    ),
  },
  {
    id: "reservation",
    group: "scenario",
    title: "Reservation and backfilling",
    tag: "Optional setting",
    body: (
      <>
        <P>
          When the top-ranked patient cannot start, smaller cases may still slip past. Reservation stops them from delaying that head patient. It is the same idea as EASY backfilling in cluster schedulers.
        </P>
        <Steps
          items={[
            "Only a head who has earned it reserves: urgency ≥ the critical level (default 4), an emergency, or already past the safety threshold (default 30 min). A blocked booked appointment or expected ambulance always reserves.",
            "Shadow time: replay running treatments in order of end time, adding back their units, until the head fits. That minute is when the head can start.",
            "Spare units: what is left over at the shadow time after the head takes its share.",
            "A later patient may start now only if it finishes by the shadow time (t + duration ≤ shadow) or fits entirely in the spare units.",
          ]}
        />
      </>
    ),
  },
  {
    id: "appointments",
    group: "scenario",
    title: "Appointments and ambulance pre-alerts",
    tag: "Known arrivals",
    body: (
      <>
        <P>Booked appointments, and ambulances once the hospital is alerted, are known before they arrive, so walk-ins are stopped from occupying what these patients will need.</P>
        <H>In the queue</H>
        <Steps
          items={[
            "Expected patients are promoted ahead of non-expected ones, except that urgency-5 patients are never held back for anyone.",
            "Look-ahead hold: a walk-in is held if starting it would still occupy resources at an expected patient's slot, so that (in use + walk-in + booked) exceeds capacity while (in use + booked) alone would fit.",
            `Critical and emergency walk-ins get ${APPOINTMENT_GRACE} minutes of slack: the check is made at slot + ${APPOINTMENT_GRACE}.`,
          ]}
        />
        <H>Measures</H>
        <Formula>{`appointment delay  = start − booked slot          on time if ≤ ${APPOINTMENT_GRACE} min\nambulance wait     = start − arrival at hospital  on time if ≤ ${AMBULANCE_GRACE} min\nambulance lead     = arrival − alert time         (alert ≤ arrival, journey ≤ ${MAX_AMBULANCE_MINUTES} min)`}</Formula>
        <H>Booking a slot</H>
        <P>
          Checking a slot compares booked demand with capacity at the candidate&rsquo;s start and at every overlapping booking&rsquo;s start inside its window (demand only changes at those points).
          Suggesting a slot is first-fit: scan forward in {SLOT_STEP}-minute steps (up to 24 hours) and return the first slot with no overbooking.
        </P>
      </>
    ),
  },
  {
    id: "surge",
    group: "scenario",
    title: "Emergency surge",
    tag: "Stress test",
    body: (
      <>
        <P>Adds a deterministic wave of emergency patients so you can see how each strategy copes with a sudden load.</P>
        <Formula>{`patient i (0 ≤ i < count):  arrival = surgeStart + i        one per minute\n  template = i mod 10 from a fixed list of ten cases\n  urgency   ∈ {5,4,5,3,4,5,4,3,5,4}   treatment ∈ {25,25,35,20,25,40,25,20,30,25} min\n  emergency = true`}</Formula>
        <P>The emergency flag adds δ to the Dynamic score and one level to the Harm-Density rate, so surge patients naturally rank above routine ones.</P>
      </>
    ),
  },
  {
    id: "failure",
    group: "scenario",
    title: "Resource failure and staff availability",
    tag: "Capacity changes",
    body: (
      <>
        <P>Capacity is a function of time, recomputed at each decision:</P>
        <Formula>{`cap_k(t) = max( 0,  C_k − failed_k · [t ≥ failureStart] + Σ staff_delta_k )\nfailed_k = min(failureUnits, C_k)`}</Formula>
        <Steps
          items={[
            "A treatment already running is never interrupted: a failed unit goes offline when its current treatment finishes.",
            "Staff changes are unforeseen. A decision at minute t never looks ahead to a later change, so history before a change is identical with or without it.",
            "Someone going off duty mid-treatment finishes that treatment and receives no new assignments. Only staff returning can unblock a waiting patient, so a departure is just a moment to re-plan.",
            "Doctors and nurses who are unavailable at the start take a unit off capacity from minute 0.",
          ]}
        />
        <P>Adding a patient during a live run re-runs the whole simulation from minute 0 with the new arrival, so everything before that minute stays exactly the same.</P>
      </>
    ),
  },
  {
    id: "stock",
    group: "scenario",
    title: "Medicine and equipment",
    tag: "Stock constraints",
    body: (
      <>
        <P>Each patient carries a list of requests (item, quantity). They start from a standard treatment protocol for the condition and can be edited on any patient.</P>
        <H>Standard requests</H>
        <Formula>{`requests(condition, urgency) = { line ∈ protocol[condition] : urgency ≥ line.minUrgency }\nresolved against the inventory by id, then by name; items the hospital does not stock are skipped`}</Formula>
        <P>For example a ventilator line applies only from urgency 4 up, while gloves apply to everyone.</P>
        <H>How the engine enforces them</H>
        <Steps
          items={[
            "A patient can start only if all resources and all requested items are available together (the same all-or-nothing rule as staff and beds).",
            "Medicines are consumed when treatment starts and never come back: left(m) ← left(m) − quantity.",
            "Equipment units are held for the whole treatment and returned when it ends: held(e) ≤ operable units(e). Equipment under maintenance contributes 0 units.",
            "A run works on a snapshot and never writes back, so re-running a scenario always starts from the same stock.",
          ]}
        />
        <P>
          Enforcement is opt-in (set NEXT_PUBLIC_ENABLE_STOCK_CONSTRAINTS=true). When it is off, requests are still saved and shown but do not delay anyone. Blocked minutes per item are reported as warnings.
        </P>
      </>
    ),
  },
  {
    id: "bottleneck",
    group: "measure",
    title: "Bottleneck attribution and utilisation",
    tag: "Metrics",
    body: (
      <>
        <H>Binding resource</H>
        <P>
          A queued patient may be short of several resources at once, so waiting is blamed on the one that would be resolved last: replay running treatments by end time and find, for each short
          resource, when enough units free up. The latest wins; ties go to the scarcer resource. Blocked patient-minutes accumulate over the time until the next event.
        </P>
        <H>Utilisation</H>
        <Formula>{"utilisation_k = Σ_t in_use_k(t) / ( C_k · horizon )      capped at 1\nhorizon = max(configured duration, actual completion time)"}</Formula>
        <P>A resource is shown as warning at ≥ 70% and critical at ≥ 90%. A bottleneck warning is raised when a resource was ≥ 90% in use for some minutes and was also the binding shortage for someone; the one with the most blocked patient-minutes is named as the bottleneck.</P>
      </>
    ),
  },
  {
    id: "objective",
    group: "measure",
    title: "Objective score and resource advice",
    tag: "Compare & advice",
    body: (
      <>
        <H>Objective (lower is better)</H>
        <Formula>{`J = ${OBJECTIVE_WEIGHTS.totalWaiting}·ΣW + ${OBJECTIVE_WEIGHTS.criticalWaiting}·ΣW_critical + ${OBJECTIVE_WEIGHTS.patientsRemaining}·untreated + ${OBJECTIVE_WEIGHTS.resourceOverload}·overload + ${OBJECTIVE_WEIGHTS.maxWaiting}·maxW + ${OBJECTIVE_WEIGHTS.completionTime}·T_end`}</Formula>
        <Where
          items={[
            ["ΣW", "total minutes waited by all patients who arrived"],
            ["ΣW_critical", "the same for critical patients (urgency ≥ 4), so they count five times in total"],
            ["untreated, overload", "huge penalties so an unfinished or over-capacity plan can never win"],
            ["maxW, T_end", "longest single wait and the minute the last patient finishes"],
          ]}
        />
        <H>Comparing strategies</H>
        <P>All four strategies run on identical input, so any difference in waits, safety-threshold breaches or J comes from the ordering rule alone.</P>
        <H>Which resource to add</H>
        <Formula>{"for each resource k:  re-run with C_k + 1  →  J_k\nbest = the k with the lowest J_k that is strictly below the baseline J\nimprovement % = (J_before − J_after) / max(|J_before|, 0.0001) · 100"}</Formula>
        <P>This is a what-if by exhaustive re-simulation (a baseline plus one run per resource), not an estimate. Ties keep the first resource in the fixed order doctor, nurse, bed, ICU bed, operating room.</P>
      </>
    ),
  },
];

const GROUPS: { value: "all" | Section["group"]; label: string }[] = [
  { value: "all", label: "All" },
  { value: "strategy", label: "Strategies" },
  { value: "scenario", label: "Scenarios" },
  { value: "measure", label: "Measures" },
];

export function Algorithms() {
  const [group, setGroup] = useState<"all" | Section["group"]>("all");
  const shown = SECTIONS.filter((s) => group === "all" || s.group === group);

  return (
    <div className="space-y-5">
      <p className="max-w-3xl text-sm leading-relaxed text-slate-600">
        The algorithms and formulas behind each simulation type. The numbers shown are the ones the engine uses right now, and the worked examples are calculated with the engine&rsquo;s own functions.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Segmented label="Show" value={group} onChange={setGroup} options={GROUPS} size="sm" />
        <nav aria-label="Jump to algorithm" className="flex flex-wrap gap-1.5">
          {shown.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => document.getElementById(`algo-${s.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" })}
              className="rounded-md border border-slate-200 bg-surface px-2 py-1 text-xs font-medium text-slate-600 hover:border-slate-300 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-600"
            >
              {s.title.split(" (")[0]}
            </button>
          ))}
        </nav>
      </div>
      {shown.map((s) => (
        <div key={s.id} id={`algo-${s.id}`} className="scroll-mt-20">
          <Card
            title={s.title}
            actions={
              <Badge tone={s.group === "strategy" ? "blue" : s.group === "scenario" ? "yellow" : "green"} className="font-mono">
                {s.tag}
              </Badge>
            }
            bodyClassName="space-y-3"
          >
            {s.body}
          </Card>
        </div>
      ))}
    </div>
  );
}
