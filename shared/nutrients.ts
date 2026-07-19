import type { NutrientDef } from "./types";

/**
 * Tracked micronutrients with general-adult daily targets (NIH DRI-based).
 * Targets can be overridden per-user in Settings.nutrientTargetOverrides.
 * Keys are stable identifiers used in Food.micros and Supplement.nutrients.
 */
export const NUTRIENTS: NutrientDef[] = [
  { key: "vitamin_a_mcg", label: "Vitamin A", unit: "mcg", dailyTarget: 900, upperLimit: 3000 },
  { key: "vitamin_c_mg", label: "Vitamin C", unit: "mg", dailyTarget: 90, upperLimit: 2000 },
  { key: "vitamin_d_mcg", label: "Vitamin D", unit: "mcg", dailyTarget: 15, upperLimit: 100 },
  { key: "vitamin_e_mg", label: "Vitamin E", unit: "mg", dailyTarget: 15, upperLimit: 1000 },
  { key: "vitamin_k_mcg", label: "Vitamin K", unit: "mcg", dailyTarget: 120, upperLimit: null },
  { key: "thiamin_mg", label: "Thiamin (B1)", unit: "mg", dailyTarget: 1.2, upperLimit: null },
  { key: "riboflavin_mg", label: "Riboflavin (B2)", unit: "mg", dailyTarget: 1.3, upperLimit: null },
  { key: "niacin_mg", label: "Niacin (B3)", unit: "mg", dailyTarget: 16, upperLimit: 35 },
  { key: "vitamin_b6_mg", label: "Vitamin B6", unit: "mg", dailyTarget: 1.3, upperLimit: 100 },
  { key: "folate_mcg", label: "Folate", unit: "mcg", dailyTarget: 400, upperLimit: 1000 },
  { key: "vitamin_b12_mcg", label: "Vitamin B12", unit: "mcg", dailyTarget: 2.4, upperLimit: null },
  { key: "calcium_mg", label: "Calcium", unit: "mg", dailyTarget: 1000, upperLimit: 2500 },
  { key: "iron_mg", label: "Iron", unit: "mg", dailyTarget: 8, upperLimit: 45 },
  { key: "magnesium_mg", label: "Magnesium", unit: "mg", dailyTarget: 400, upperLimit: null },
  { key: "zinc_mg", label: "Zinc", unit: "mg", dailyTarget: 11, upperLimit: 40 },
  { key: "potassium_mg", label: "Potassium", unit: "mg", dailyTarget: 3400, upperLimit: null },
  { key: "selenium_mcg", label: "Selenium", unit: "mcg", dailyTarget: 55, upperLimit: 400 },
  { key: "fiber_g", label: "Fiber", unit: "g", dailyTarget: 30, upperLimit: null },
];

export const NUTRIENT_BY_KEY: Record<string, NutrientDef> = Object.fromEntries(
  NUTRIENTS.map((n) => [n.key, n]),
);

export const NUTRIENT_KEYS = NUTRIENTS.map((n) => n.key);
