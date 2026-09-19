import { compareStrategies, type Comparison } from "./compare";
import { runAllStrategies } from "./engine";
import { improvementPercent, recommendResource, type ResourceRecommendation } from "./efficiency";
import { treatmentOrder } from "./metrics";
import { STRATEGIES, STRATEGY_LABELS } from "./policies";
import { RESOURCE_LABELS, RESOURCE_SINGULAR } from "./resources";
import {
  RESOURCE_KEYS,
  type Metrics,
  type ResourceSet,
  type SimParams,
  type SimPatient,
  type SimulationOutput,
  type Strategy,
} from "./types";

/**
 * Strategy verdict and efficiency advice.
 *
 * Why not one blended score? A weighted sum such as "1·total wait + 4·critical
 * wait + 0.5·max wait" hides trade-offs and depends on weights someone chose.
 * Reordering a queue does not create capacity — it decides WHO waits — so a
 * strategy can "win" the sum while making low-urgency patients wait far longer.
 * Instead the verdict walks a short list of checks in priority order, and each
 * check only decides between strategies that are still tied on the ones before.
 * Everything here is deterministic and calculated from the simulation runs.
 */

interface Criterion {
  key: string;
  /** Short label for the "how this is decided" list. */
  title: string;
  /** Used mid-sentence: "… gives <phrase>". */
  phrase: string;
  unit: "patients" | "min";
  value: (m: Metrics) => number;
}

/** Priority order of the checks. Earlier checks outrank later ones. */
export const DECISION_CRITERIA: readonly Criterion[] = [
  {
    key: "remaining",
    title: "Every patient gets treated",
    phrase: "the fewest untreated patients",
    unit: "patients",
    value: (m) => m.patients_remaining,
  },
  {
    key: "breaches",
    title: "Fewest patients waiting past the safety limit",
    phrase: "the fewest patients waiting past the safety limit",
    unit: "patients",
    value: (m) => m.safety_threshold_breaches,
  },
  {
    key: "critical",
    title: "Shortest wait for critical patients",
    phrase: "the shortest average wait for critical patients",
    unit: "min",
    value: (m) => m.critical_wait,
  },
  {
    key: "max",
    title: "Shortest longest wait (fairness)",
    phrase: "the shortest longest wait",
    unit: "min",
    value: (m) => m.maximum_wait,
  },
  {
    key: "avg",
    title: "Shortest average wait",
    phrase: "the shortest average wait",
    unit: "min",
    value: (m) => m.average_wait,
  },
];

/** Minute-based results within 1 minute or 5% of the best count as tied. */
export const TIE_MIN_MINUTES = 1;
export const TIE_FRACTION = 0.05;

/** When strategies tie on every check, keep the simplest one. */
const TIE_ORDER: Strategy[] = ["fcfs", "dynamic", "urgency"];

const f1 = (n: number) => (Math.round(n * 10) / 10).toString();
const show = (c: Criterion, v: number) => (c.unit === "min" ? `${f1(v)} min` : String(v));

function isTied(c: Criterion, value: number, best: number): boolean {
  if (c.unit === "patients") return value === best;
  return value - best < Math.max(TIE_MIN_MINUTES, TIE_FRACTION * best);
}

/** Average wait of critical and non-critical patients who have arrived. */
function groupWaits(out: SimulationOutput) {
  const arrived = out.patients.filter((p) => p.status !== "not_arrived");
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  return {
    critical: mean(arrived.filter((p) => p.urgency >= out.params.criticalUrgency).map((p) => p.wait_time)),
    regular: mean(arrived.filter((p) => p.urgency < out.params.criticalUrgency).map((p) => p.wait_time)),
  };
}

export interface StrategyVerdict {
  strategy: Strategy;
  /** True when no check separated the strategies, so the simplest (First-Come, First-Served) is kept. */
  tie: boolean;
  headline: string;
  details: string[];
}

export function recommendStrategy(outputs: Record<Strategy, SimulationOutput>): StrategyVerdict {
  let candidates = [...STRATEGIES];
  let decisive: Criterion | null = null;
  for (const c of DECISION_CRITERIA) {
    const values = candidates.map((s) => c.value(outputs[s].metrics));
    const best = Math.min(...values);
    const kept = candidates.filter((_, i) => isTied(c, values[i], best));
    if (kept.length < candidates.length && decisive === null) decisive = c;
    candidates = kept;
  }
  const strategy = TIE_ORDER.find((s) => candidates.includes(s)) ?? "fcfs";
  const label = STRATEGY_LABELS[strategy];
  const fcfsLabel = STRATEGY_LABELS.fcfs;

  if (decisive === null) {
    return {
      strategy,
      tie: true,
      headline: `${fcfsLabel} is enough here: the three strategies perform almost the same.`,
      details: [
        "Reordering the queue only helps when patients compete for the same resource at the same time. The bigger lever in this scenario is capacity — see the advice below.",
      ],
    };
  }

  const mine = decisive.value(outputs[strategy].metrics);
  const base = decisive.value(outputs.fcfs.metrics);
  const headline =
    strategy === "fcfs"
      ? `${label} is recommended: it gives ${decisive.phrase} (${show(decisive, mine)}).`
      : `${label} is recommended: it gives ${decisive.phrase} (${show(decisive, mine)} vs ${show(decisive, base)} under ${fcfsLabel}).`;

  const details: string[] = [];
  if (strategy !== "fcfs") {
    const mineWaits = groupWaits(outputs[strategy]);
    const baseWaits = groupWaits(outputs.fcfs);
    const critical = baseWaits.critical - mineWaits.critical; // > 0 = critical patients wait less
    const regular = mineWaits.regular - baseWaits.regular; // > 0 = other patients wait more
    const parts: string[] = [];
    if (Math.abs(critical) >= 0.05) {
      parts.push(`critical patients wait ${f1(Math.abs(critical))} min ${critical > 0 ? "less" : "more"} on average`);
    }
    if (Math.abs(regular) >= 0.05) {
      parts.push(`other patients wait ${f1(Math.abs(regular))} min ${regular > 0 ? "more" : "less"}`);
    }
    if (parts.length > 0) {
      details.push(`Trade-off compared with ${fcfsLabel}: ${parts.join(" and ")}.`);
    }
  }
  return { strategy, tie: false, headline, details };
}

export interface UrgencyWaitRow {
  urgency: number;
  /** Patients at this urgency level (from the First-Come, First-Served run). */
  patients: number;
  /** Average wait in minutes per strategy. */
  average: Record<Strategy, number>;
}

/** Average wait for each urgency level under every strategy — shows who pays for a policy. */
export function waitByUrgency(outputs: Record<Strategy, SimulationOutput>): UrgencyWaitRow[] {
  const levels = new Set<number>();
  for (const s of STRATEGIES) {
    for (const p of outputs[s].patients) if (p.status !== "not_arrived") levels.add(p.urgency);
  }
  const avg = (s: Strategy, urgency: number) => {
    const waits = outputs[s].patients
      .filter((p) => p.status !== "not_arrived" && p.urgency === urgency)
      .map((p) => p.wait_time);
    return waits.length ? waits.reduce((a, b) => a + b, 0) / waits.length : 0;
  };
  return [...levels]
    .sort((a, b) => b - a)
    .map((urgency) => ({
      urgency,
      patients: outputs.fcfs.patients.filter((p) => p.status !== "not_arrived" && p.urgency === urgency).length,
      average: { fcfs: avg("fcfs", urgency), urgency: avg("urgency", urgency), dynamic: avg("dynamic", urgency) },
    }));
}

export type AdviceTone = "red" | "yellow" | "green" | "blue";

export interface AdviceItem {
  id: string;
  tone: AdviceTone;
  title: string;
  detail: string;
}

const SEVERITY: Record<AdviceTone, number> = { red: 0, yellow: 1, green: 2, blue: 3 };

const lower = (s: string) => s.toLowerCase();
const pct0 = (fraction: number) => `${Math.round(fraction * 100)}%`;

function change(label: string, saved: number): string | null {
  if (saved > 0.05) return `${label} falls by ${f1(saved)} min`;
  if (saved < -0.05) return `${label} rises by ${f1(Math.abs(saved))} min`;
  return null;
}

/** Concrete, calculated advice for the recommended strategy. Most urgent first. */
export function buildAdvice(
  outputs: Record<Strategy, SimulationOutput>,
  verdict: StrategyVerdict,
  recommendation: ResourceRecommendation,
): AdviceItem[] {
  const chosen = outputs[verdict.strategy];
  const m = chosen.metrics;
  const params = chosen.params;
  const resources: ResourceSet = chosen.resources;
  const stratLabel = STRATEGY_LABELS[verdict.strategy];
  const top = m.bottlenecks[0];
  const items: AdviceItem[] = [];

  if (!chosen.completed) {
    items.push({
      id: "incomplete",
      tone: "red",
      title: "Some patients could not be treated",
      detail: chosen.error ?? "Not every patient was treated in this run.",
    });
  }

  const best = recommendation.best;
  if (best) {
    const b = recommendation.baseline.metrics;
    const pct = improvementPercent(b.total_waiting_time, best.output.metrics.total_waiting_time, "lower");
    const clauses = [
      change("total waiting", best.totalWaitSaved),
      change("critical-patient waiting", best.criticalWaitSaved),
      best.completionSaved > 0 ? `the last patient finishes ${best.completionSaved} min sooner` : null,
    ].filter((c): c is string => c !== null);
    const bottleneckNote =
      top && top.resource === best.resource
        ? ` ${RESOURCE_LABELS[top.resource]} were the binding shortage for ${top.blocked_patient_minutes} patient-minutes of waiting.`
        : "";
    items.push({
      id: "add-resource",
      tone: "green",
      title: `Add 1 ${RESOURCE_SINGULAR[best.resource]}`,
      detail: `Re-running ${stratLabel} with one more ${RESOURCE_SINGULAR[best.resource]}: ${clauses.join(", ")}${
        Number.isFinite(pct) && Math.abs(pct) >= 0.5 ? ` (${f1(pct)}% ${pct >= 0 ? "less" : "more"} total waiting)` : ""
      }.${bottleneckNote} This is the best of five one-unit additions that were tested.`,
    });
  } else if (m.total_waiting_time > 0) {
    items.push({
      id: "no-single-unit",
      tone: "blue",
      title: "No single extra unit fixes the waiting",
      detail: `Adding one doctor, nurse, bed, ICU bed or operating room did not reduce waiting under ${stratLabel}. The delay may come from patients arriving in bursts or needing several resources at once — try adding more than one unit on the Resources page.`,
    });
  }

  if (top) {
    const idle = RESOURCE_KEYS.filter((k) => k !== top.resource && resources[k] >= 2 && m.resource_utilization[k] < 0.3).sort(
      (a, b) => m.resource_utilization[a] - m.resource_utilization[b],
    )[0];
    if (idle) {
      items.push({
        id: "idle-capacity",
        tone: "blue",
        title: `${RESOURCE_LABELS[idle]} are mostly idle`,
        detail: `Only ${pct0(m.resource_utilization[idle])} in use, while ${lower(RESOURCE_LABELS[top.resource])} are the bottleneck. If capacity is flexible, shifting some from ${lower(RESOURCE_LABELS[idle])} to ${lower(RESOURCE_LABELS[top.resource])} could cut waiting without extra cost.`,
      });
    }
  }

  if (m.safety_threshold_breaches > 0) {
    items.push({
      id: "safety-breaches",
      tone: "yellow",
      title: `${m.safety_threshold_breaches} patient${m.safety_threshold_breaches === 1 ? "" : "s"} waited longer than the ${params.safetyThreshold}-minute safety limit`,
      detail: `Adding capacity at the bottleneck is the most direct fix.${
        verdict.strategy === "dynamic"
          ? " Raising β (the waiting weight) in the advanced settings also makes long-waiting patients climb the queue sooner."
          : ""
      }`,
    });
  }

  const hot = RESOURCE_KEYS.filter((k) => resources[k] > 0 && m.resource_utilization[k] >= 0.9);
  if (hot.length > 0) {
    items.push({
      id: "near-capacity",
      tone: "yellow",
      title: `${hot.map((k) => RESOURCE_LABELS[k]).join(" and ")} ${hot.length === 1 ? "is" : "are"} almost fully used`,
      detail: `At 90% or more there is no slack left for an emergency (${hot.map((k) => `${lower(RESOURCE_LABELS[k])} ${pct0(m.resource_utilization[k])}`).join(", ")}). Extra capacity here also makes the system more resilient to a surge or failure.`,
    });
  }

  const order = (s: Strategy) => treatmentOrder(outputs[s]).join("|");
  if (order("dynamic") === order("urgency") && order("dynamic") !== order("fcfs")) {
    items.push({
      id: "dynamic-equals-urgency",
      tone: "blue",
      title: "Dynamic Priority behaved exactly like Urgency Only",
      detail:
        "Waiting time never outweighed a difference in urgency. Raise β (the waiting weight) in the advanced settings, or load the contrast scenario, to see the two diverge.",
    });
  }

  if (items.every((i) => i.tone !== "red" && i.tone !== "yellow") && chosen.completed && m.safety_threshold_breaches === 0) {
    items.push({
      id: "copes",
      tone: "green",
      title: "The system copes with this load",
      detail: `No patient waited past the ${params.safetyThreshold}-minute safety limit and everyone was treated by minute ${m.actual_completion_time}.${
        params.emergencySurge || params.resourceFailure
          ? ""
          : " Switch on an emergency surge or a resource failure to find where it breaks."
      }`,
    });
  }

  return items.sort((a, b) => SEVERITY[a.tone] - SEVERITY[b.tone]);
}

export interface Analysis {
  outputs: Record<Strategy, SimulationOutput>;
  comparison: Comparison;
  verdict: StrategyVerdict;
  recommendation: ResourceRecommendation;
  advice: AdviceItem[];
  urgencyWaits: UrgencyWaitRow[];
}

/** Run every strategy, pick the recommended one, test one-unit resource additions and write the advice. */
export function analyse(
  patients: SimPatient[],
  resources: ResourceSet,
  params: Partial<SimParams> = {},
): Analysis {
  const outputs = runAllStrategies(patients, resources, params);
  const verdict = recommendStrategy(outputs);
  const recommendation = recommendResource(patients, resources, params, verdict.strategy);
  return {
    outputs,
    comparison: compareStrategies(outputs),
    verdict,
    recommendation,
    advice: buildAdvice(outputs, verdict, recommendation),
    urgencyWaits: waitByUrgency(outputs),
  };
}
