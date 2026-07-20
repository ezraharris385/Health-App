import type { NutrientDef } from "./types";

/**
 * Tracked micronutrients with general-adult daily targets (NIH DRI-based).
 * Targets can be overridden per-user in Settings.nutrientTargetOverrides.
 * Keys are stable identifiers used in Food.micros and Supplement.nutrients.
 */
const VIT = "Vitamins";
const MIN = "Minerals";
const BRAIN = "Brain & fatty acids";
const OTHER = "Other";

export const NUTRIENTS: NutrientDef[] = [
  { key: "vitamin_a_mcg", label: "Vitamin A", unit: "mcg", dailyTarget: 900, upperLimit: 3000, group: VIT },
  { key: "vitamin_c_mg", label: "Vitamin C", unit: "mg", dailyTarget: 90, upperLimit: 2000, group: VIT },
  { key: "vitamin_d_mcg", label: "Vitamin D", unit: "mcg", dailyTarget: 15, upperLimit: 100, group: VIT },
  { key: "vitamin_e_mg", label: "Vitamin E", unit: "mg", dailyTarget: 15, upperLimit: 1000, group: VIT },
  { key: "vitamin_k_mcg", label: "Vitamin K", unit: "mcg", dailyTarget: 120, upperLimit: null, group: VIT },
  { key: "thiamin_mg", label: "Thiamin (B1)", unit: "mg", dailyTarget: 1.2, upperLimit: null, group: VIT },
  { key: "riboflavin_mg", label: "Riboflavin (B2)", unit: "mg", dailyTarget: 1.3, upperLimit: null, group: VIT },
  { key: "niacin_mg", label: "Niacin (B3)", unit: "mg", dailyTarget: 16, upperLimit: 35, group: VIT },
  { key: "vitamin_b6_mg", label: "Vitamin B6", unit: "mg", dailyTarget: 1.3, upperLimit: 100, group: VIT },
  { key: "folate_mcg", label: "Folate", unit: "mcg", dailyTarget: 400, upperLimit: 1000, group: VIT },
  { key: "vitamin_b12_mcg", label: "Vitamin B12", unit: "mcg", dailyTarget: 2.4, upperLimit: null, group: VIT },
  { key: "calcium_mg", label: "Calcium", unit: "mg", dailyTarget: 1000, upperLimit: 2500, group: MIN },
  { key: "iron_mg", label: "Iron", unit: "mg", dailyTarget: 8, upperLimit: 45, group: MIN },
  { key: "magnesium_mg", label: "Magnesium", unit: "mg", dailyTarget: 400, upperLimit: null, group: MIN },
  { key: "zinc_mg", label: "Zinc", unit: "mg", dailyTarget: 11, upperLimit: 40, group: MIN },
  { key: "potassium_mg", label: "Potassium", unit: "mg", dailyTarget: 3400, upperLimit: null, group: MIN },
  { key: "selenium_mcg", label: "Selenium", unit: "mcg", dailyTarget: 55, upperLimit: 400, group: MIN },
  // Brain & cognition: the omega-3 fatty acids (EPA/DHA are the cognition-active
  // ones; ALA is the plant precursor) plus choline (acetylcholine / cell
  // membranes). Targets are general-adult adequate intakes.
  { key: "omega3_epa_mg", label: "Omega-3 EPA", unit: "mg", dailyTarget: 250, upperLimit: null, group: BRAIN },
  { key: "omega3_dha_mg", label: "Omega-3 DHA", unit: "mg", dailyTarget: 250, upperLimit: null, group: BRAIN },
  { key: "omega3_ala_g", label: "Omega-3 ALA", unit: "g", dailyTarget: 1.6, upperLimit: null, group: BRAIN },
  { key: "choline_mg", label: "Choline", unit: "mg", dailyTarget: 550, upperLimit: 3500, group: BRAIN },
  { key: "fiber_g", label: "Fiber", unit: "g", dailyTarget: 30, upperLimit: null, group: OTHER },
];

/** Group display order for the coverage UI (Brain surfaced first). */
export const NUTRIENT_GROUP_ORDER = [BRAIN, VIT, MIN, OTHER];

export const NUTRIENT_BY_KEY: Record<string, NutrientDef> = Object.fromEntries(
  NUTRIENTS.map((n) => [n.key, n]),
);

export const NUTRIENT_KEYS = NUTRIENTS.map((n) => n.key);
