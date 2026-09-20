"use client";

import { Plus, Search, Trash2, Wrench } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge, Button, Card, EmptyState, Field, Notice, Stat, Tabs, inputClass, type Tone } from "./ui";
import { useStore } from "@/lib/store";
import {
  EQUIPMENT_STATUS_LABEL,
  MEDICINE_STATUS_LABEL,
  equipmentLow,
  equipmentStatus,
  filterEquipment,
  filterMedicines,
  isExpired,
  medicineStatus,
  stockWarnings,
  summarizeInventory,
} from "@/lib/inventory";

type Tab = "medicines" | "equipment";

const MEDICINE_TONE: Record<ReturnType<typeof medicineStatus>, Tone> = { available: "green", low: "yellow", out_of_stock: "red" };

/** A number that is committed on blur or Enter, so typing "12" does not save "1" on the way. */
function InlineNumber({ label, value, onCommit }: { label: string; value: number; onCommit: (n: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const n = Number(draft);
    setDraft(null);
    if (draft.trim() !== "" && n !== value) onCommit(n);
  };
  return (
    <input
      type="number"
      inputMode="numeric"
      aria-label={label}
      className={`${inputClass} !h-8 !w-24 tabular-nums`}
      value={draft ?? String(value)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") setDraft(null);
      }}
    />
  );
}

function MedicineForm() {
  const { saveMedicine } = useStore();
  const empty = { name: "", category: "", quantity: "0", minimum: "0", unit: "", expiry: "" };
  const [f, setF] = useState(empty);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof empty) => (e: React.ChangeEvent<HTMLInputElement>) => setF((p) => ({ ...p, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const ok = await saveMedicine({
      name: f.name,
      category: f.category,
      quantity: Number(f.quantity),
      minimum_threshold: Number(f.minimum),
      unit: f.unit,
      expiry_date: f.expiry || null,
    });
    setBusy(false);
    if (ok) setF(empty);
  }

  return (
    <form onSubmit={submit} noValidate aria-label="Add medicine" className="grid items-end gap-3 sm:grid-cols-3 lg:grid-cols-7">
      <Field label="Name" htmlFor="med_name">
        <input id="med_name" className={inputClass} value={f.name} onChange={set("name")} maxLength={80} />
      </Field>
      <Field label="Category" htmlFor="med_category">
        <input id="med_category" className={inputClass} value={f.category} onChange={set("category")} maxLength={40} />
      </Field>
      <Field label="Quantity" htmlFor="med_quantity">
        <input id="med_quantity" type="number" inputMode="numeric" className={inputClass} value={f.quantity} onChange={set("quantity")} />
      </Field>
      <Field label="Minimum threshold" htmlFor="med_min">
        <input id="med_min" type="number" inputMode="numeric" className={inputClass} value={f.minimum} onChange={set("minimum")} />
      </Field>
      <Field label="Unit" htmlFor="med_unit">
        <input id="med_unit" className={inputClass} value={f.unit} onChange={set("unit")} placeholder="sets, pcs…" maxLength={20} />
      </Field>
      <Field label="Expiry (optional)" htmlFor="med_expiry">
        <input id="med_expiry" type="date" className={inputClass} value={f.expiry} onChange={set("expiry")} />
      </Field>
      <Button type="submit" disabled={busy}>
        <Plus size={16} aria-hidden /> Add medicine
      </Button>
    </form>
  );
}

function EquipmentForm() {
  const { saveEquipment } = useStore();
  const empty = { name: "", category: "", quantity: "1", minimum: "0" };
  const [f, setF] = useState(empty);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof empty) => (e: React.ChangeEvent<HTMLInputElement>) => setF((p) => ({ ...p, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const ok = await saveEquipment({ name: f.name, category: f.category, quantity: Number(f.quantity), minimum_threshold: Number(f.minimum) });
    setBusy(false);
    if (ok) setF(empty);
  }

  return (
    <form onSubmit={submit} noValidate aria-label="Add equipment" className="grid items-end gap-3 sm:grid-cols-3 lg:grid-cols-5">
      <Field label="Name" htmlFor="eq_name">
        <input id="eq_name" className={inputClass} value={f.name} onChange={set("name")} maxLength={80} />
      </Field>
      <Field label="Category" htmlFor="eq_category">
        <input id="eq_category" className={inputClass} value={f.category} onChange={set("category")} maxLength={40} />
      </Field>
      <Field label="Units owned" htmlFor="eq_quantity">
        <input id="eq_quantity" type="number" inputMode="numeric" className={inputClass} value={f.quantity} onChange={set("quantity")} />
      </Field>
      <Field label="Minimum threshold" htmlFor="eq_min">
        <input id="eq_min" type="number" inputMode="numeric" className={inputClass} value={f.minimum} onChange={set("minimum")} />
      </Field>
      <Button type="submit" disabled={busy}>
        <Plus size={16} aria-hidden /> Add equipment
      </Button>
    </form>
  );
}

export function Inventory() {
  const {
    medicines,
    equipment,
    stockEnabled,
    saveMedicine,
    removeMedicine,
    setEquipmentAvailable,
    setEquipmentMaintenance,
    removeEquipment,
    loadExampleInventory,
  } = useStore();
  const [tab, setTab] = useState<Tab>("medicines");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState("");

  const summary = useMemo(() => summarizeInventory(medicines, equipment), [medicines, equipment]);
  const warnings = useMemo(() => stockWarnings(medicines, equipment), [medicines, equipment]);
  const shownMedicines = useMemo(() => filterMedicines(medicines, { query, category, status }), [medicines, query, category, status]);
  const shownEquipment = useMemo(() => filterEquipment(equipment, { query, category, status }), [equipment, query, category, status]);
  const categories = [...new Set((tab === "medicines" ? medicines : equipment).map((x) => x.category))].sort();
  const isEmpty = medicines.length + equipment.length === 0;

  const switchTab = (next: Tab) => {
    setTab(next);
    setCategory("");
    setStatus("");
  };

  return (
    <div className="space-y-5">
      <Notice tone={stockEnabled ? "green" : "grey"}>
        {stockEnabled ? (
          <>
            <strong>Stock constraints are on.</strong> A patient whose treatment needs a medicine or equipment waits until it is in stock. Medicines are used up when treatment starts; equipment is held for the treatment and returned when it ends. A simulation works on a copy of this stock, so running it never changes the quantities below.
          </>
        ) : (
          <>
            <strong>Stock constraints are off.</strong> You can manage stock here, and patients can be given stock needs, but simulations ignore them so existing results do not change. Set <code>NEXT_PUBLIC_ENABLE_STOCK_CONSTRAINTS=true</code> in <code>.env.local</code> and restart to enforce them.
          </>
        )}
      </Notice>

      <div className="stagger grid grid-cols-2 gap-3 lg:grid-cols-6">
        <Stat label="Total stock" value={summary.medicineUnitsTotal + summary.equipmentUnitsTotal} sub={`${summary.medicineItems} medicines, ${equipment.length} equipment types`} />
        <Stat label="Available stock" value={summary.availableStock} sub="in stock and usable now" />
        <Stat label="Low stock" value={summary.lowStock} tone={summary.lowStock > 0 ? "yellow" : undefined} sub="at or below minimum" />
        <Stat label="Out of stock" value={summary.outOfStock} tone={summary.outOfStock > 0 ? "red" : undefined} sub="none usable" />
        <Stat label="Equipment in use" value={summary.equipmentInUse} sub="units with a patient" />
        <Stat label="Under maintenance" value={summary.equipmentUnderMaintenance} tone={summary.equipmentUnderMaintenance > 0 ? "yellow" : undefined} sub="types offline" />
      </div>

      {warnings.length > 0 && (
        <Card title={`Stock warnings (${warnings.length})`}>
          <ul className="space-y-1.5" aria-label="Stock warnings">
            {warnings.map((w, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <Badge tone={w.level === "critical" ? "red" : "yellow"}>{w.level === "critical" ? "Critical" : "Warning"}</Badge>
                <span>{w.message}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card
        title="Add stock"
        actions={
          <Button variant="secondary" onClick={() => void loadExampleInventory()}>
            Load example inventory
          </Button>
        }
      >
        <div className="space-y-5">
          <MedicineForm />
          <EquipmentForm />
        </div>
      </Card>

      <div>
        <Tabs
          label="Stock"
          value={tab}
          onChange={switchTab}
          tabs={[
            { value: "medicines", label: "Medicines", count: medicines.length },
            { value: "equipment", label: "Equipment", count: equipment.length },
          ]}
        />
        <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="mt-5 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full sm:w-64">
              <Search size={16} aria-hidden className="absolute top-2.5 left-2.5 text-slate-400" />
              <input type="search" aria-label="Search stock" placeholder="Search name or category" className={`${inputClass} pl-8`} value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            <select aria-label="Filter by category" className={`${inputClass} !w-44`} value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
            <select aria-label="Filter by status" className={`${inputClass} !w-44`} value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All statuses</option>
              <option value="available">{tab === "medicines" ? "In stock" : "Available"}</option>
              <option value="low">Low stock</option>
              <option value={tab === "medicines" ? "out_of_stock" : "unavailable"}>{tab === "medicines" ? "Out of stock" : "Unavailable"}</option>
            </select>
          </div>

          {isEmpty ? (
            <EmptyState>No stock yet. Add an item above or choose “Load example inventory”.</EmptyState>
          ) : tab === "medicines" ? (
            shownMedicines.length === 0 ? (
              <EmptyState>No medicines match.</EmptyState>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-200 bg-surface">
                <table className="w-full min-w-[820px] text-left text-sm">
                  <thead className="border-b border-slate-200 text-xs tracking-wide text-slate-600 uppercase">
                    <tr>
                      {["Medicine", "Category", "Quantity", "Minimum", "Unit", "Status", "Expiry", ""].map((h) => (
                        <th key={h} scope="col" className="px-3 py-2 font-semibold">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {shownMedicines.map((m) => {
                      const st = medicineStatus(m);
                      return (
                        <tr key={m.id}>
                          <th scope="row" className="px-3 py-2 font-semibold">
                            {m.name}
                          </th>
                          <td className="px-3 py-2">{m.category}</td>
                          <td className="px-3 py-2">
                            <InlineNumber label={`Quantity of ${m.name}`} value={m.quantity} onCommit={(n) => void saveMedicine({ quantity: n }, m.id)} />
                          </td>
                          <td className="px-3 py-2 tabular-nums">{m.minimum_threshold}</td>
                          <td className="px-3 py-2">{m.unit}</td>
                          <td className="px-3 py-2">
                            <Badge tone={MEDICINE_TONE[st]}>{MEDICINE_STATUS_LABEL[st]}</Badge>
                          </td>
                          <td className="px-3 py-2 text-xs whitespace-nowrap">
                            {m.expiry_date ? (isExpired(m) ? <Badge tone="red">Expired {m.expiry_date}</Badge> : m.expiry_date) : "–"}
                          </td>
                          <td className="px-3 py-2">
                            <Button variant="ghost" className="!px-2 !py-1 text-red-700" aria-label={`Remove ${m.name}`} title="Remove" onClick={() => void removeMedicine(m.id)}>
                              <Trash2 size={16} aria-hidden />
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )
          ) : shownEquipment.length === 0 ? (
            <EmptyState>No equipment matches.</EmptyState>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-surface">
              <table className="w-full min-w-[900px] text-left text-sm">
                <thead className="border-b border-slate-200 text-xs tracking-wide text-slate-600 uppercase">
                  <tr>
                    {["Equipment", "Category", "Owned", "Available", "In use", "Minimum", "Status", "Maintenance", ""].map((h) => (
                      <th key={h} scope="col" className="px-3 py-2 font-semibold">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {shownEquipment.map((e) => {
                    const st = equipmentStatus(e);
                    const maintenance = e.maintenance_status === "maintenance";
                    return (
                      <tr key={e.id}>
                        <th scope="row" className="px-3 py-2 font-semibold">
                          {e.name}
                        </th>
                        <td className="px-3 py-2">{e.category}</td>
                        <td className="px-3 py-2 tabular-nums">{e.quantity}</td>
                        <td className="px-3 py-2">
                          <InlineNumber label={`Available units of ${e.name}`} value={e.available_quantity} onCommit={(n) => void setEquipmentAvailable(e.id, n)} />
                        </td>
                        <td className="px-3 py-2 tabular-nums">{e.in_use_quantity}</td>
                        <td className="px-3 py-2 tabular-nums">{e.minimum_threshold}</td>
                        <td className="px-3 py-2">
                          <span className="inline-flex flex-wrap gap-1">
                            <Badge tone={st === "unavailable" ? "red" : "green"}>{EQUIPMENT_STATUS_LABEL[st]}</Badge>
                            {equipmentLow(e) && <Badge tone="yellow">Low</Badge>}
                            {maintenance && <Badge tone="grey">Maintenance</Badge>}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <Button variant="secondary" size="sm" onClick={() => void setEquipmentMaintenance(e.id, !maintenance)}>
                            <Wrench size={14} aria-hidden /> {maintenance ? "Mark available" : "Mark maintenance"}
                          </Button>
                        </td>
                        <td className="px-3 py-2">
                          <Button variant="ghost" className="!px-2 !py-1 text-red-700" aria-label={`Remove ${e.name}`} title="Remove" onClick={() => void removeEquipment(e.id)}>
                            <Trash2 size={16} aria-hidden />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
