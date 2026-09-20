"use client";

import { StaffRoster } from "@/components/StaffRoster";
import { PageHeader } from "@/components/ui";

export default function StaffPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Faculty and Medical Staff" description="Doctors, nurses and technicians: who is on shift, who is available, and who is treating whom." />
      <StaffRoster />
    </div>
  );
}
