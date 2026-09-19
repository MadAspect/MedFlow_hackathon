"use client";

import { Eye } from "lucide-react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, EmptyState, fmt1, pct0 } from "./ui";
import { useStore } from "@/lib/store";
import { STRATEGY_LABELS, type Strategy } from "@/lib/simulation";

export function HistoryTable() {
  const { runs, current, openRun } = useStore();
  const router = useRouter();

  return (
    <Card title={`Simulation history (${runs.length})`} description="Every run is saved to the database and survives a page refresh.">
      {runs.length === 0 ? (
        <EmptyState>No simulations have been run yet.</EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="border-b border-slate-200 text-xs text-slate-600 uppercase">
              <tr>
                {["Run at", "Strategy", "Duration", "Scenario", "Treated", "Avg wait", "Max wait", "ICU util.", "Remaining", ""].map((h) => (
                  <th key={h} scope="col" className="px-2 py-2 font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {runs.map(({ run, result }) => (
                <tr key={run.id} className={current?.runId === run.id ? "bg-blue-50" : undefined}>
                  <td className="px-2 py-2 whitespace-nowrap">{new Date(run.created_at).toLocaleString()}</td>
                  <td className="px-2 py-2">{STRATEGY_LABELS[run.strategy as Strategy] ?? run.strategy}</td>
                  <td className="px-2 py-2 tabular-nums">{run.simulation_time} min</td>
                  <td className="px-2 py-2">
                    <div className="flex flex-wrap gap-1">
                      {run.emergency_surge && <Badge tone="yellow">Surge</Badge>}
                      {run.resource_failure && <Badge tone="red">Failure: {run.failed_resource}</Badge>}
                      {run.is_placeholder && <Badge tone="yellow">Placeholder</Badge>}
                      {!run.emergency_surge && !run.resource_failure && !run.is_placeholder && <span className="text-slate-500">Normal</span>}
                    </div>
                  </td>
                  <td className="px-2 py-2 tabular-nums">{result?.patients_treated ?? "–"}</td>
                  <td className="px-2 py-2 tabular-nums">{result ? `${fmt1(result.average_waiting_time)} min` : "–"}</td>
                  <td className="px-2 py-2 tabular-nums">{result ? `${result.maximum_waiting_time} min` : "–"}</td>
                  <td className="px-2 py-2 tabular-nums">{result ? pct0(result.icu_utilization) : "–"}</td>
                  <td className="px-2 py-2 tabular-nums">{result?.patients_remaining ?? "–"}</td>
                  <td className="px-2 py-2">
                    <Button
                      variant="secondary"
                      className="!px-2.5 !py-1"
                      disabled={!result}
                      onClick={async () => {
                        if (await openRun(run.id)) router.push("/simulation");
                      }}
                    >
                      <Eye size={14} aria-hidden /> Open
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
