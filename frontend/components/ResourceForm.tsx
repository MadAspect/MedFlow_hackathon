"use client";

import { RotateCcw, Save, Download } from "lucide-react";
import { useState } from "react";
import { Button, Card, Field, NumberInput, Notice } from "./ui";
import { useStore } from "@/lib/store";
import { DEFAULT_RESOURCES, RESOURCE_KEYS, RESOURCE_LABELS, type ResourceSet } from "@/lib/simulation";
import { validateResources, type FieldErrors } from "@/lib/validation";

export function ResourceForm() {
  const { resources, resourcesSaved, saveResources, loadLatestResources } = useStore();
  const [draft, setDraft] = useState<ResourceSet>(resources);
  const [errors, setErrors] = useState<FieldErrors>({});

  // Follow the saved configuration when it changes (e.g. after a demo run).
  const [seen, setSeen] = useState(resources);
  if (seen !== resources) {
    setSeen(resources);
    setDraft(resources);
  }

  const dirty = RESOURCE_KEYS.some((k) => draft[k] !== resources[k]);

  async function save() {
    const result = validateResources(draft);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    await saveResources(result.data);
  }

  return (
    <Card
      title="Resource configuration"
      description="Whole numbers, zero or more."
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {RESOURCE_KEYS.map((key) => (
          <Field key={key} label={RESOURCE_LABELS[key]} htmlFor={`cap-${key}`} error={errors[key]}>
            <NumberInput id={`cap-${key}`} value={draft[key]} min={0} step={1} invalid={!!errors[key]} onValue={(n) => setDraft((d) => ({ ...d, [key]: n }))} />
          </Field>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button onClick={() => void save()}>
          <Save size={16} aria-hidden /> Save
        </Button>
        <Button
          variant="secondary"
          onClick={async () => {
            const loaded = await loadLatestResources();
            if (loaded) {
              setDraft(loaded);
              setErrors({});
            }
          }}
        >
          <Download size={16} aria-hidden /> Load saved
        </Button>
        <Button variant="ghost" onClick={() => setDraft(DEFAULT_RESOURCES)}>
          <RotateCcw size={16} aria-hidden /> Use defaults
        </Button>
        {dirty && <span className="text-xs font-medium text-amber-700">Unsaved changes</span>}
      </div>
      {!resourcesSaved && (
        <Notice tone="yellow" className="mt-3">
          Save a configuration before running a simulation.
        </Notice>
      )}
    </Card>
  );
}
