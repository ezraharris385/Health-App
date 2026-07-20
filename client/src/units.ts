/**
 * Imperial units: the single source of truth for unit conversion, formatting,
 * and labels across the client. The DB stays canonical (see the units contract
 * in the increment brief) and conversion happens ONLY here, at the UI edge —
 * no page should convert inline.
 *
 * Canonical storage vs. what the UI shows:
 *  - body weight (weight_logs.weight): canonical lb, shown as lb (no conversion)
 *  - lifted weight: canonical lb, shown as lb (no conversion)
 *  - height (profile.heightCm): canonical cm, shown as ft + in
 *  - cardio distance (cardio.distance_km): canonical km, shown as miles
 *  - water (water_logs.amount_ml / goals.waterGoalMl): canonical ml, shown as fl oz
 *
 * Pure module: no React and no DB imports.
 */

// Conversion constants (exact) --------------------------------------------------
export const LB_TO_KG = 0.45359237; // 1 lb = 0.45359237 kg
export const MI_TO_KM = 1.609344; // 1 mi = 1.609344 km
export const FLOZ_TO_ML = 29.5735; // 1 US fl oz = 29.5735 ml
export const IN_TO_CM = 2.54; // 1 in = 2.54 cm
export const IN_PER_FT = 12; // 1 ft = 12 in

// Display labels ----------------------------------------------------------------
export const LB = "lb";
export const MI = "mi";
export const FLOZ = "fl oz";

// Weight (lb <-> kg) ------------------------------------------------------------
export function kgFromLb(lb: number): number {
  return lb * LB_TO_KG;
}

export function lbFromKg(kg: number): number {
  return kg / LB_TO_KG;
}

// Distance (mi <-> km) ----------------------------------------------------------
export function kmFromMi(mi: number): number {
  return mi * MI_TO_KM;
}

export function miFromKm(km: number): number {
  return km / MI_TO_KM;
}

// Volume (fl oz <-> ml) ---------------------------------------------------------
export function mlFromFloz(floz: number): number {
  return floz * FLOZ_TO_ML;
}

export function flozFromMl(ml: number): number {
  return ml / FLOZ_TO_ML;
}

// Height (ft/in <-> cm) ---------------------------------------------------------
export function cmFromFtIn(ft: number, inch: number): number {
  return (ft * IN_PER_FT + inch) * IN_TO_CM;
}

/** Split a cm height into whole feet + whole inches (inches carry to feet at 12). */
export function ftInFromCm(cm: number): { ft: number; inch: number } {
  const totalInches = cm / IN_TO_CM;
  let ft = Math.floor(totalInches / IN_PER_FT);
  let inch = Math.round(totalInches - ft * IN_PER_FT);
  if (inch >= IN_PER_FT) {
    ft += 1;
    inch -= IN_PER_FT;
  }
  return { ft, inch };
}

// Formatters --------------------------------------------------------------------
/** Body/lifted weight — canonical lb, shown directly. */
export function fmtLb(lb: number, digits = 1): string {
  return `${lb.toFixed(digits)} ${LB}`;
}

/** Cardio distance — takes canonical km, shows miles. */
export function fmtMiles(km: number, digits = 2): string {
  return `${miFromKm(km).toFixed(digits)} ${MI}`;
}

/** Water — takes canonical ml, shows fl oz. */
export function fmtFloz(ml: number, digits = 0): string {
  return `${flozFromMl(ml).toFixed(digits)} ${FLOZ}`;
}

/** Height — takes canonical cm, shows ft + in (e.g. "5 ft 10 in"). */
export function fmtHeight(cm: number): string {
  const { ft, inch } = ftInFromCm(cm);
  return `${ft} ft ${inch} in`;
}
