// targets, weekly stats and the optional weekly check-in. plain functions, no browser apis.

export const KCAL_PER_KG = 7700;   // rough energy in a kilo of body weight change

export const ACTIVITY = {
  sedentary: { mult: 1.2, label: "Mostly sitting", hint: "Desk job, little exercise" },
  light: { mult: 1.375, label: "Lightly active", hint: "On your feet some, or 1 to 3 workouts a week" },
  moderate: { mult: 1.55, label: "Moderately active", hint: "3 to 5 workouts a week" },
  very: { mult: 1.725, label: "Very active", hint: "6 to 7 hard workouts a week" },
  athlete: { mult: 1.9, label: "Extremely active", hint: "Physical job plus training" },
};

export const GOALS = {
  lose: { label: "Lose fat", hint: "Eat a little less than you burn", paces: [0.25, 0.5, 0.75], def: 0.5 },
  maintain: { label: "Maintain weight", hint: "Stay where you are", paces: [], def: 0 },
  gain: { label: "Build muscle", hint: "Eat a little more than you burn", paces: [0.25, 0.5], def: 0.25 },
};

export const PACE_NAME = { 0.25: "Gentle", 0.5: "Steady", 0.75: "Faster" };

// ---- small helpers ----
const r1 = n => Math.round(n * 10) / 10;
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

export const cmToFtIn = cm => { const t = cm / 2.54; let ft = Math.floor(t / 12), inch = Math.round(t - ft * 12); if (inch === 12) { ft++; inch = 0; } return { ft, inch }; };
export const ftInToCm = (ft, inch) => r1((Number(ft) * 12 + Number(inch || 0)) * 2.54);
export const kgToLb = kg => r1(kg * 2.2046226);
export const lbToKg = lb => r1(lb / 2.2046226);

export function ageFrom(birthYear, now = new Date()) { return now.getFullYear() - birthYear; }

const dayMs = 86400000;
const toUTC = iso => { const [y, m, d] = iso.split("-").map(Number); return Date.UTC(y, m - 1, d); };
export const daysBetween = (a, b) => Math.round((toUTC(b) - toUTC(a)) / dayMs);
export function addDays(iso, n) { return new Date(toUTC(iso) + n * dayMs).toISOString().slice(0, 10); }

// ---- the plan ----
// mifflin-st jeor. "other" uses the midpoint of the two offsets.
export function bmr({ sex, weightKg, heightCm, age }) {
  const offset = sex === "male" ? 5 : sex === "female" ? -161 : -78;
  return 10 * weightKg + 6.25 * heightCm - 5 * age + offset;
}
export const tdee = p => bmr(p) * ACTIVITY[p.activity].mult;
export const floorKcal = sex => (sex === "male" ? 1500 : 1200);

export function macrosFromKcal({ kcal, weightKg, goal }) {
  const perKg = { lose: 2.0, maintain: 1.6, gain: 1.8 }[goal] || 1.6;
  let protein = clamp(perKg * weightKg, 0.8 * weightKg, Math.max(0.8 * weightKg, 0.35 * kcal / 4));
  let fat = Math.max(0.25 * kcal / 9, 0.6 * weightKg);
  let carbs = (kcal - protein * 4 - fat * 9) / 4;
  if (carbs < 0) { carbs = 0; fat = Math.max(0, (kcal - protein * 4) / 9); }
  return { protein: Math.round(protein), carbs: Math.round(carbs), fat: Math.round(fat) };
}

export const fiberTarget = kcal => Math.max(20, Math.round(kcal / 1000 * 14));   // about 14 g per 1000 kcal

// p: { sex, age, heightCm, weightKg, activity, goal, pace }
export function makeTargets(p, tdeeOverride) {
  const t = tdeeOverride ?? tdee(p);
  const notes = [];
  let delta = 0;
  if (p.goal === "lose") delta = -Math.min((p.pace || 0.5) * KCAL_PER_KG / 7, t * 0.25);
  if (p.goal === "gain") delta = Math.min((p.pace || 0.25) * KCAL_PER_KG / 7, t * 0.20);
  let kcal = t + delta;
  const floor = floorKcal(p.sex);
  if (kcal < floor) { kcal = floor; notes.push(`I won't suggest less than ${floor} kcal a day.`); }
  kcal = Math.round(kcal / 10) * 10;
  return { kcal, ...macrosFromKcal({ kcal, weightKg: p.weightKg, goal: p.goal }), fiber: fiberTarget(kcal),
    bmr: Math.round(bmr(p)), tdee: Math.round(t), delta: Math.round(kcal - t), notes };
}

export function validateProfile(p) {
  const name = String(p.name || "").trim();
  if (!name) return "Tell me what to call you";
  if (name.length > 30) return "That name is a bit long";
  if (!["male", "female", "other"].includes(p.sex)) return "Pick one option";
  if (!(p.age >= 13 && p.age <= 100)) return "Age should be between 13 and 100";
  if (!(p.heightCm >= 100 && p.heightCm <= 250)) return "Height should be between 100 and 250 cm";
  if (!(p.weightKg >= 25 && p.weightKg <= 300)) return "Weight should be between 25 and 300 kg";
  if (!ACTIVITY[p.activity]) return "Pick how active you are";
  if (!GOALS[p.goal]) return "Pick a goal";
  return null;
}

// ---- how the week looks ----
export function dailyTotals(meals) {
  const by = {};
  for (const m of meals) {
    const d = (by[m.log_date] ||= { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, meals: 0 });
    for (const k of ["kcal", "protein", "carbs", "fat", "fiber"]) d[k] += m.totals[k] || 0;
    d.meals++;
  }
  return by;
}

export function weeklySummary(meals, endISO, targetKcal, days = 7) {
  const by = dailyTotals(meals);
  const row = d => by[d] ? { date: d, logged: true, ...by[d] } : { date: d, logged: false, kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, meals: 0 };
  const list = Array.from({ length: days }, (_, i) => row(addDays(endISO, i - days + 1)));
  const avgOf = rows => {
    const L = rows.filter(r => r.logged);
    if (!L.length) return null;
    const m = k => Math.round(L.reduce((a, r) => a + r[k], 0) / L.length);
    return { kcal: m("kcal"), protein: m("protein"), carbs: m("carbs"), fat: m("fat"), fiber: m("fiber") };
  };
  const prev = Array.from({ length: days }, (_, i) => row(addDays(endISO, i - 2 * days + 1)));
  const logged = list.filter(r => r.logged);
  return {
    days: list, loggedDays: logged.length, avg: avgOf(list), prevAvg: avgOf(prev),
    onTarget: logged.filter(r => Math.abs(r.kcal - targetKcal) <= targetKcal * 0.10).length,
  };
}

export function streak(meals, todayISO) {
  const have = new Set(meals.map(m => m.log_date));
  let d = have.has(todayISO) ? todayISO : addDays(todayISO, -1);
  let n = 0;
  while (have.has(d)) { n++; d = addDays(d, -1); }
  return n;
}

// least-squares slope of weight over time, in kg per week
export function weightTrend(weights, endISO, windowDays = 21) {
  const pts = weights.filter(w => daysBetween(w.date, endISO) >= 0 && daysBetween(w.date, endISO) < windowDays)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (pts.length < 2) return { n: pts.length, spanDays: 0, perWeek: null };
  const x0 = pts[0].date;
  const xs = pts.map(p => daysBetween(x0, p.date)), ys = pts.map(p => p.kg);
  const n = pts.length, mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  const den = xs.reduce((a, x) => a + (x - mx) ** 2, 0);
  const slope = den ? xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / den : 0;
  return { n, spanDays: xs[n - 1], perWeek: r1(slope * 7), first: pts[0], last: pts[n - 1] };
}

// ---- weekly check-in (only used if the person opted in) ----
export const CHECKIN = { intakeDays: 14, needUsableDays: 10, weightWindow: 21, needWeighIns: 3, needSpan: 10, maxStep: 200, minChange: 100 };

// profile needs: sex, age, heightCm, weightKg (latest), activity, goal, pace
export function suggestAdjustment({ profile, targets, meals, weights, today }) {
  const C = CHECKIN;
  const by = dailyTotals(meals);
  // days that look fully logged: at least half the target, so a single snack doesn't count
  const usable = [];
  for (let i = 0; i < C.intakeDays; i++) {
    const d = by[addDays(today, -i)];
    if (d && d.kcal >= targets.kcal * 0.5) usable.push(d.kcal);
  }
  const trend = weightTrend(weights, today, C.weightWindow);
  const progress = { usableDays: usable.length, needDays: C.needUsableDays, weighIns: trend.n,
    needWeighIns: C.needWeighIns, spanDays: trend.spanDays, needSpan: C.needSpan };
  if (usable.length < C.needUsableDays || trend.n < C.needWeighIns || trend.spanDays < C.needSpan) {
    return { status: "not_enough_data", progress };
  }

  const avgIntake = usable.reduce((a, b) => a + b, 0) / usable.length;
  const burnedKcal = avgIntake - trend.perWeek * KCAL_PER_KG / 7;       // what the scale says you burn
  const formula = tdee(profile);
  const blended = clamp(0.5 * formula + 0.5 * burnedKcal, formula * 0.8, formula * 1.2);
  const wanted = makeTargets(profile, blended).kcal;
  const step = clamp(wanted - targets.kcal, -C.maxStep, C.maxStep);
  const suggested = Math.max(floorKcal(profile.sex), Math.round((targets.kcal + step) / 25) * 25);
  const change = suggested - targets.kcal;

  const goalRate = profile.goal === "lose" ? -(profile.pace || 0.5) : profile.goal === "gain" ? (profile.pace || 0.25) : 0;
  const facts = { avgIntake: Math.round(avgIntake), perWeek: trend.perWeek, goalRate, estBurn: Math.round(burnedKcal),
    usableDays: usable.length, weighIns: trend.n };
  if (Math.abs(change) < C.minChange) return { status: "on_track", facts, progress };
  return { status: "suggest", kcal: suggested, change, ...macrosFromKcal({ kcal: suggested, weightKg: profile.weightKg, goal: profile.goal }), facts, progress };
}
