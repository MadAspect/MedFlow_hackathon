"use client";

import { AppointmentForm, AppointmentList, BookedLoad } from "@/components/Appointments";
import { PageHeader } from "@/components/ui";

export default function AppointmentsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Appointments"
        description="Book slots in advance. The simulation keeps resources free so nobody waits more than 10 minutes past their slot."
      />
      <AppointmentForm />
      <BookedLoad />
      <AppointmentList />
    </div>
  );
}
