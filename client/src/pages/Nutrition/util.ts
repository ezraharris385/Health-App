import type { MealType } from "@shared/types";

export const MEALS: MealType[] = ["breakfast", "lunch", "dinner", "snack"];

/** "2026-07-19" -> "7/19" for compact chart axes */
export function fmtDay(date: string): string {
  const parts = date.split("-");
  return `${Number(parts[1])}/${Number(parts[2])}`;
}

export function r1(n: number): number {
  return Math.round(n * 10) / 10;
}
