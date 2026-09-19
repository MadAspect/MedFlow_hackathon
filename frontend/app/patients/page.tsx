"use client";

import { PatientForm } from "@/components/PatientForm";
import { PatientTable } from "@/components/PatientTable";
import { PageHeader } from "@/components/ui";

export default function PatientsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Patients"
        description="Add synthetic patients or load example data. Everything here is stored in the database and survives a page refresh."
      />
      <PatientForm />
      <PatientTable />
    </div>
  );
}
