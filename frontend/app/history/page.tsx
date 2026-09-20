"use client";

import { HistoryTable } from "@/components/HistoryTable";
import { PageHeader } from "@/components/ui";

export default function HistoryPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="History"
        description="Every saved run. Open one to replay it."
      />
      <HistoryTable />
    </div>
  );
}
