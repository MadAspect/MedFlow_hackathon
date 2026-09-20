"use client";

import { AmbulanceForm, InboundBoard } from "@/components/Ambulances";
import { PageHeader } from "@/components/ui";

export default function AmbulancesPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Ambulances"
        description="Log ambulances that are on their way. The hospital is warned at the dispatch and keeps the resources free, so the patient is received within 10 minutes of arriving."
      />
      <AmbulanceForm />
      <InboundBoard />
    </div>
  );
}
