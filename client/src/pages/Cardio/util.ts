import type { CardioSession, CardioType } from "@shared/types";

/** All cardio activity types, in the order shown in the picker. */
export const CARDIO_TYPES: CardioType[] = [
  "run",
  "jog",
  "walk",
  "interval",
  "hiit",
  "cycling",
  "rowing",
  "elliptical",
  "other",
];

/** Human labels for the picker (activity types are otherwise shown verbatim). */
export const CARDIO_TYPE_LABEL: Record<CardioType, string> = {
  run: "Run",
  jog: "Jog",
  walk: "Walk",
  interval: "Interval",
  hiit: "HIIT",
  cycling: "Cycling",
  rowing: "Rowing",
  elliptical: "Elliptical",
  other: "Other",
};

/** Display name for a session — 'other' sessions surface their free-text label. */
export function cardioActivityName(c: CardioSession): string {
  if (c.type === "other" && c.activityLabel.trim()) return c.activityLabel.trim();
  return CARDIO_TYPE_LABEL[c.type] ?? c.type;
}
