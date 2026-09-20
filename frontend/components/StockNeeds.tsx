"use client";

import { Plus, RotateCcw, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge, Button, inputClass } from "./ui";
import type { StockRequirementInput } from "@/lib/database";
import { useStore } from "@/lib/store";
import { suggestStock } from "@/lib/treatments";

export interface StockDraft {
  /** What will be saved with the patient: the edited list, or the standard set until it is edited. */
  value: StockRequirementInput[];
  /** True once someone has changed the standard set for this patient. */
  edited: boolean;
  condition: string;
  /** Standard items this hospital does not stock, so they are not requested. */
  missing: string[];
  setValue: (next: StockRequirementInput[]) => void;
  /** Go back to the standard set (also what a form does after saving a patient). */
  reset: () => void;
}

/**
 * A patient's requests start as the standard set for their condition and urgency, and follow it
 * as those change, until someone edits the list by hand. After that the list is theirs.
 */
export function useStockDraft(condition: string, urgency: number): StockDraft {
  const { medicines, equipment } = useStore();
  const [custom, setCustom] = useState<StockRequirementInput[] | null>(null);
  const suggestion = useMemo(
    () => suggestStock(condition, urgency, medicines, equipment),
    [condition, urgency, medicines, equipment],
  );
  return {
    value: custom ?? suggestion.requirements,
    edited: custom !== null,
    condition,
    missing: suggestion.missing,
    setValue: setCustom,
    reset: () => setCustom(null),
  };
}

/** "This treatment needs…" picker: pre-filled from the condition, and every line can be changed. */
export function StockNeeds({ draft }: { draft: StockDraft }) {
  const { medicines, equipment, stockEnabled } = useStore();
  const { value, edited, condition, missing } = draft;
  const onChange = draft.setValue;
  const [item, setItem] = useState("");
  const [quantity, setQuantity] = useState("1");
  if (medicines.length + equipment.length === 0) return null;

  const options = [
    ...equipment.map((e) => ({ key: `equipment:${e.id}`, label: `${e.name} (equipment)` })),
    ...medicines.map((m) => ({ key: `medicine:${m.id}`, label: `${m.name} (${m.unit})` })),
  ];
  const labelOf = (r: StockRequirementInput) =>
    options.find((o) => o.key === `${r.item_type}:${r.item_id}`)?.label ?? `${r.item_id} (removed)`;

  const add = () => {
    if (!item) return;
    const [type, ...rest] = item.split(":");
    const amount = Math.max(1, Math.floor(Number(quantity) || 1));
    const id = rest.join(":");
    const existing = value.find((r) => r.item_type === type && r.item_id === id);
    onChange(
      existing
        ? value.map((r) => (r === existing ? { ...r, quantity: r.quantity + amount } : r))
        : [...value, { item_type: type as StockRequirementInput["item_type"], item_id: id, quantity: amount }],
    );
    setItem("");
    setQuantity("1");
  };

  return (
    <fieldset>
      <legend className="mb-1 flex flex-wrap items-center gap-2 text-sm font-medium text-slate-800">
        Medicine and equipment needed
        <Badge tone={edited ? "yellow" : "green"}>{edited ? "Edited" : `Standard for ${condition.toLowerCase()}`}</Badge>
        {edited && (
          <Button variant="ghost" size="sm" onClick={draft.reset}>
            <RotateCcw size={13} aria-hidden /> Reset to standard
          </Button>
        )}
      </legend>
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="Item from stock" className={`${inputClass} !w-56`} value={item} onChange={(e) => setItem(e.target.value)}>
          <option value="">Choose an item…</option>
          {options.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))}
        </select>
        <input
          aria-label="Quantity needed"
          type="number"
          min={1}
          className={`${inputClass} !w-20`}
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
        />
        <Button variant="secondary" disabled={!item} onClick={add}>
          <Plus size={15} aria-hidden /> Add
        </Button>
      </div>
      {value.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {value.map((r) => (
            <li key={`${r.item_type}:${r.item_id}`}>
              <Badge tone="blue" className="gap-1.5">
                {labelOf(r)} ×{r.quantity}
                <button
                  type="button"
                  aria-label={`Remove ${labelOf(r)}`}
                  className="rounded hover:text-red-700 focus-visible:outline-2 focus-visible:outline-blue-600"
                  onClick={() => onChange(value.filter((x) => x !== r))}
                >
                  <X size={12} aria-hidden />
                </button>
              </Badge>
            </li>
          ))}
        </ul>
      )}
      {value.length === 0 && <p className="mt-2 text-xs text-slate-500">Nothing requested for this patient.</p>}
      {!edited && missing.length > 0 && (
        <p className="mt-1 text-xs text-slate-500">Not requested because the hospital does not stock: {missing.join(", ")}.</p>
      )}
      <p className="mt-1 text-xs text-slate-500">
        {stockEnabled
          ? "The simulation holds this patient back until every item is in stock."
          : "Saved with the patient. Stock is only enforced when stock constraints are switched on (see the Inventory page)."}
      </p>
    </fieldset>
  );
}
