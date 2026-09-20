"use client";

import { PatientForm } from "@/components/PatientForm";
import { PatientTable } from "@/components/PatientTable";
import { PageHeader } from "@/components/ui";

export default function PatientsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Patients"
        description="Walk-in patients. Add your own or load examples."
      />
      <PatientForm />
      <PatientTable />
    </div>
  );
}
