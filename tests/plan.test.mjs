import test from "node:test";
import assert from "node:assert/strict";
import { bmr, tdee, makeTargets, macrosFromKcal, validateProfile, weeklySummary, streak, weightTrend,
  suggestAdjustment, addDays, daysBetween, cmToFtIn, ftInToCm, kgToLb, lbToKg } from "../src/plan.js";

const person = { name: "A", sex: "male", age: 28, heightCm: 175, weightKg: 80, activity: "light", goal: "lose", pace: 0.5 };

test("mifflin-st jeor numbers", () => {
  assert.equal(Math.round(bmr(person)), 1759);
  assert.equal(Math.round(tdee(person)), 2418);
  assert.equal(Math.round(bmr({ ...person, sex: "female" })), 1593);
});

test("lose fat target is about 550 kcal under maintenance", () => {
  const t = makeTargets(person);
  assert.equal(t.kcal, 1870);
  assert.equal(t.delta, -548);
  assert.ok(t.protein >= 150 && t.protein <= 165);
  assert.ok(Math.abs(t.protein * 4 + t.carbs * 4 + t.fat * 9 - t.kcal) < 40);
});

test("never goes below the safety floor and says so", () => {
  const small = { sex: "female", age: 50, heightCm: 150, weightKg: 45, activity: "sedentary", goal: "lose", pace: 0.75 };
  const t = makeTargets(small);
  assert.ok(t.kcal >= 1200);
  assert.ok(t.notes.length >= 1);
});

test("deficit is capped at 25% of maintenance, surplus at 20%", () => {
  const t = tdee(person);
  assert.ok(makeTargets({ ...person, pace: 0.75 }).delta >= -t * 0.25 - 10);
  assert.ok(makeTargets({ ...person, goal: "gain", pace: 0.5 }).delta <= t * 0.2 + 10);
  assert.equal(makeTargets({ ...person, goal: "maintain" }).delta, Math.round(Math.round(t / 10) * 10 - t));
});

test("macros never go negative", () => {
  const m = macrosFromKcal({ kcal: 1200, weightKg: 120, goal: "lose" });
  assert.ok(m.carbs >= 0 && m.fat >= 0 && m.protein > 0);
});

test("validation", () => {
  assert.equal(validateProfile(person), null);
  assert.ok(validateProfile({ ...person, name: " " }));
  assert.ok(validateProfile({ ...person, age: 9 }));
  assert.ok(validateProfile({ ...person, heightCm: 20 }));
  assert.ok(validateProfile({ ...person, sex: "x" }));
});

test("unit conversions round trip", () => {
  assert.deepEqual(cmToFtIn(175), { ft: 5, inch: 9 });
  assert.ok(Math.abs(ftInToCm(5, 9) - 175.3) < 0.2);
  assert.ok(Math.abs(lbToKg(kgToLb(80)) - 80) < 0.1);
  assert.equal(daysBetween("2026-02-27", "2026-03-02"), 3);
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
});

const meal = (date, kcal) => ({ log_date: date, totals: { kcal, protein: kcal / 20, carbs: kcal / 10, fat: kcal / 30 } });

test("weekly summary averages only logged days", () => {
  const meals = [meal("2026-10-10", 2000), meal("2026-10-10", 200), meal("2026-10-08", 1800)];
  const s = weeklySummary(meals, "2026-10-11", 2000);
  assert.equal(s.loggedDays, 2);
  assert.equal(s.avg.kcal, 2000);
  assert.equal(s.onTarget, 2);
  assert.equal(s.days.length, 7);
});

test("streak survives an empty today until the day ends", () => {
  const meals = [meal("2026-10-10", 1), meal("2026-10-09", 1), meal("2026-10-08", 1), meal("2026-10-06", 1)];
  assert.equal(streak(meals, "2026-10-11"), 3);
  assert.equal(streak([meal("2026-10-11", 1), ...meals], "2026-10-11"), 4);
  assert.equal(streak([], "2026-10-11"), 0);
});

test("weight trend slope", () => {
  const w = [0, 7, 14].map((d, i) => ({ date: addDays("2026-10-01", d), kg: 80 - 0.5 * i }));
  const t = weightTrend(w, "2026-10-15");
  assert.equal(t.perWeek, -0.5);
  assert.equal(t.spanDays, 14);
});

function history(kcal, start, days) {
  return Array.from({ length: days }, (_, i) => meal(addDays(start, i), kcal));
}

test("check-in needs enough data first", () => {
  const r = suggestAdjustment({ profile: person, targets: { kcal: 1870 }, meals: history(1800, "2026-10-05", 4),
    weights: [{ date: "2026-10-05", kg: 80 }], today: "2026-10-11" });
  assert.equal(r.status, "not_enough_data");
  assert.equal(r.progress.usableDays, 4);
});

test("stalled weight on a deficit suggests a small cut, never more than 200", () => {
  const today = "2026-10-20";
  const meals = history(2100, addDays(today, -13), 14);
  const weights = [0, 7, 13].map(d => ({ date: addDays(today, -13 + d), kg: 80 }));
  const r = suggestAdjustment({ profile: person, targets: { kcal: 1870 }, meals, weights, today });
  assert.equal(r.status, "suggest");
  assert.ok(r.change < 0 && r.change >= -200);
  assert.ok(r.kcal >= 1500);
});

test("losing at the planned rate means no change", () => {
  const today = "2026-10-20";
  const meals = history(1870, addDays(today, -13), 14);
  const weights = [0, 7, 13].map((d, i) => ({ date: addDays(today, -13 + d), kg: 80 - i * 0.46 }));
  const r = suggestAdjustment({ profile: person, targets: { kcal: 1870 }, meals, weights, today });
  assert.ok(["on_track", "suggest"].includes(r.status));
  if (r.status === "suggest") assert.ok(Math.abs(r.change) <= 200);
});

test("incomplete logging days are ignored", () => {
  const today = "2026-10-20";
  const meals = history(500, addDays(today, -13), 14);
  const weights = [0, 7, 13].map(d => ({ date: addDays(today, -13 + d), kg: 80 }));
  assert.equal(suggestAdjustment({ profile: person, targets: { kcal: 1870 }, meals, weights, today }).status, "not_enough_data");
});
