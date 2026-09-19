import { RESOURCE_KEYS, type ResourceKey, type ResourceSet } from "./types";

export const RESOURCE_LABELS: Record<ResourceKey, string> = {
  doctor: "Doctors",
  nurse: "Nurses",
  bed: "General beds",
  icu_bed: "ICU beds",
  operating_room: "Operating rooms",
};

/** Singular form, used in sentences such as "1 × ICU bed offline". */
export const RESOURCE_SINGULAR: Record<ResourceKey, string> = {
  doctor: "doctor",
  nurse: "nurse",
  bed: "general bed",
  icu_bed: "ICU bed",
  operating_room: "operating room",
};

/** Sensible hospital defaults from the product brief. */
export const DEFAULT_RESOURCES: ResourceSet = {
  doctor: 5,
  nurse: 10,
  bed: 20,
  icu_bed: 5,
  operating_room: 2,
};

export function emptyResourceSet(value = 0): ResourceSet {
  return {
    doctor: value,
    nurse: value,
    bed: value,
    icu_bed: value,
    operating_room: value,
  };
}

export function cloneResourceSet(set: ResourceSet): ResourceSet {
  return { ...set };
}

export function totalUnits(set: ResourceSet): number {
  return RESOURCE_KEYS.reduce((sum, k) => sum + set[k], 0);
}
