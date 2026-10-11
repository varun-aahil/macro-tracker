// plain functions, no browser apis, so they can be tested in node
export const KEYS = ["kcal", "protein", "carbs", "fat"];
export const MEAL_TYPES = ["breakfast", "lunch", "snack", "dinner"];
export const DEFAULT_TARGETS = { kcal: 2200, protein: 150, carbs: 250, fat: 70 };

const r1 = n => Math.round(n * 10) / 10;

export function macrosFor(food, grams) {
  const out = {};
  for (const k of KEYS) out[k] = r1((food[k] || 0) * grams / 100);
  return out;
}

export function sumMacros(rows) {
  const out = {};
  for (const k of KEYS) out[k] = r1(rows.reduce((a, r) => a + (r[k] || 0), 0));
  return out;
}

export function num(v) {
  if (v === "" || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function validateFood(d) {
  const name = String(d.name || "").trim();
  if (!name) return "Give the food a name";
  if (name.length > 80) return "Name is too long";
  for (const k of KEYS) {
    const n = num(d[k]);
    if (n === null || n < 0) return `Enter ${k} per 100 g`;
  }
  if (num(d.kcal) > 900) return "That's more than 900 kcal per 100 g, check the number";
  if (num(d.protein) + num(d.carbs) + num(d.fat) > 105) return "Protein + carbs + fat can't be over 100 g per 100 g";
  const ug = num(d.unit_grams);
  if ((d.unit_name && ug === null) || (ug !== null && !d.unit_name)) return "Fill both unit name and unit grams, or neither";
  return null;
}

// build saved items from what is on the review screen
export function buildItems(items, foodsById) {
  return items.map(it => {
    const f = foodsById[it.food_id];
    const grams = Math.max(0.1, Math.min(5000, Number(it.grams) || 0));
    return { food_id: f.id, food_name: f.name, grams: r1(grams),
      from_pred: !!it.from_pred, pred_grams: it.pred_grams ?? null, ...macrosFor(f, grams) };
  });
}

// the user can type the real numbers. kcal rescales the grams so food-level learning stays honest.
// protein/carbs/fat typed in replace the computed ones for that meal.
export function applyActual(items, actual) {
  const a = {};
  for (const k of KEYS) { const n = num(actual && actual[k]); if (n !== null && n >= 0) a[k] = n; }
  let scaled = items;
  const computed = sumMacros(items);
  if (a.kcal && computed.kcal > 0) {
    const f = Math.max(0.1, Math.min(10, a.kcal / computed.kcal));
    scaled = items.map(it => {
      const grams = r1(it.grams * f);
      return { ...it, grams, kcal: r1(it.kcal * f), protein: r1(it.protein * f), carbs: r1(it.carbs * f), fat: r1(it.fat * f) };
    });
  }
  const totals = { ...sumMacros(scaled), ...a };
  return { items: scaled, totals, actual: Object.keys(a).length ? a : null };
}

export function dayTotals(meals) { return sumMacros(meals.map(m => m.totals)); }

export function history(meals, endDate, days) {
  const end = new Date(endDate + "T00:00:00");
  const out = [];
  for (let n = days - 1; n >= 0; n--) {
    const d = new Date(end); d.setDate(d.getDate() - n);
    const key = d.toISOString().slice(0, 10);
    out.push({ date: key, ...dayTotals(meals.filter(m => m.log_date === key)) });
  }
  return out;
}

export function nextSplit(meals) {
  const n = meals.filter(m => m.emb).length + 1;   // this will be photo meal number n
  return n % 5 === 0 ? "holdout" : "train";
}

// how wrong the first guess was, from your corrections
export function stats(meals) {
  const photo = meals.filter(m => m.pred_kcal != null);
  let kept = 0, pred = 0, added = 0;
  const gram = [], kc = [];
  for (const m of photo) {
    for (const it of m.items) {
      if (it.from_pred) { kept++; if (it.pred_grams != null) gram.push([it.pred_grams, it.grams]); }
      else added++;
    }
    pred += m.pred_count || 0;
    kc.push([m.pred_kcal, m.totals.kcal]);
  }
  const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
  const kcalOut = kc.length ? {
    meals: kc.length,
    mae: r1(mean(kc.map(([p, t]) => Math.abs(p - t)))),
    mape: r1(100 * mean(kc.filter(([, t]) => t > 0).map(([p, t]) => Math.abs(p - t) / t))),
    bias: r1(mean(kc.map(([p, t]) => p - t))),
  } : null;
  const gramOut = gram.length ? {
    items: gram.length,
    mae: r1(mean(gram.map(([p, t]) => Math.abs(p - t)))),
    bias: r1(mean(gram.map(([p, t]) => p - t))),
  } : null;
  return {
    photoMeals: photo.length,
    precision: pred ? Math.round(1000 * kept / pred) / 1000 : null,
    recall: (kept + added) ? Math.round(1000 * kept / (kept + added)) / 1000 : null,
    kcal: kcalOut, grams: gramOut,
  };
}
