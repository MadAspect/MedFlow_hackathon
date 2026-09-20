"use client";

import { Inventory } from "@/components/Inventory";
import { PageHeader } from "@/components/ui";

export default function InventoryPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Inventory" description="Medicine and medical-equipment stock: what is in stock, what is running low, and what is out of service." />
      <Inventory />
    </div>
  );
}
