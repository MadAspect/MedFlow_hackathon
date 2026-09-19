"use client";

import { HistoryTable } from "@/components/HistoryTable";
import { PageHeader } from "@/components/ui";

export default function HistoryPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="History"
        description="Past simulation runs. Open one to review its hospital view, charts and allocation decisions."
      />
      <HistoryTable />
    </div>
  );
}
