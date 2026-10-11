// ranks foods for a photo embedding. starts from clip zero-shot (photo vs food name),
// then leans on your own corrected photos as you add them.

export const SCALE = 100;      // clip's logit scale
const BONUS = 60;              // how hard your own examples can push a food up or down
const FULL_AFTER = 4;          // examples of a food before its bonus is at full strength
const MAX_EXAMPLES = 40;       // per food, newest kept

export function normalize(v) {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i] * v[i];
  s = Math.sqrt(s) || 1;
  const out = new Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] / s;
  return out;
}

export function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function softmax(xs) {
  const m = Math.max(...xs);
  const e = xs.map(x => Math.exp(x - m));
  const t = e.reduce((a, b) => a + b, 0);
  return e.map(x => x / t);
}

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : 0;
}

// examples: { [foodId]: [embedding, ...] } built from confirmed photo meals
export function buildExamples(meals) {
  const ex = {};
  for (const m of meals) {
    if (!m.emb || m.split === "holdout") continue;
    for (const it of m.items) (ex[it.food_id] ||= []).push(m.emb);
  }
  for (const k in ex) ex[k] = ex[k].slice(-MAX_EXAMPLES);
  return ex;
}

// foods: [{id, textEmb}]. returns [{food_id, prob}] best first
export function rank(imgEmb, foods, examples = {}) {
  const usable = foods.filter(f => f.textEmb);
  if (!usable.length) return [];
  const logits = usable.map(f => SCALE * dot(imgEmb, f.textEmb));

  // image-to-image similarity against what you've confirmed before
  const sims = usable.map(f => {
    const ex = examples[f.id];
    if (!ex || !ex.length) return null;
    const s = ex.map(e => dot(imgEmb, e)).sort((a, b) => b - a);
    return s.length > 1 ? (s[0] + s[1]) / 2 : s[0];
  });
  const have = sims.filter(s => s !== null);
  if (have.length) {
    const mid = median(have);
    usable.forEach((f, i) => {
      if (sims[i] === null) return;
      const weight = Math.min(1, examples[f.id].length / FULL_AFTER);
      logits[i] += BONUS * weight * (sims[i] - mid);
    });
  }

  const probs = softmax(logits);
  return usable.map((f, i) => ({ food_id: f.id, prob: probs[i] }))
    .sort((a, b) => b.prob - a.prob);
}

// what to put on the draft: the top food, plus others that are close behind it
export function pickDraft(ranked, { maxItems = 4, minProb = 0.12, relative = 0.35 } = {}) {
  if (!ranked.length) return { items: [], more: [] };
  const top = ranked[0].prob;
  const items = ranked.filter((r, i) => i === 0 || (r.prob >= minProb && r.prob >= top * relative)).slice(0, maxItems);
  const used = new Set(items.map(i => i.food_id));
  return { items, more: ranked.filter(r => !used.has(r.food_id)).slice(0, 5) };
}

// grams you usually eat of a food, falling back to a unit or 100 g
export function typicalGrams(food, meals) {
  const seen = [];
  for (const m of meals) for (const it of m.items) if (it.food_id === food.id) seen.push(it.grams);
  if (seen.length >= 2) return Math.round(median(seen.slice(-10)));
  if (seen.length === 1) return Math.round(seen[0]);
  return Math.round(food.unit_grams || 100);
}

// does learning from you help? scores zero-shot vs adaptive on the held-out meals
export function evaluate(meals, foods) {
  const photo = meals.filter(m => m.emb);
  const hold = photo.filter(m => m.split === "holdout");
  const train = photo.filter(m => m.split !== "holdout");
  if (!hold.length) return null;
  const ex = buildExamples(train);
  let zs = { top1: 0, top3: 0 }, ad = { top1: 0, top3: 0 };
  for (const m of hold) {
    const truth = new Set(m.items.map(i => i.food_id));
    for (const [acc, examples] of [[zs, {}], [ad, ex]]) {
      const r = rank(m.emb, foods, examples);
      if (r[0] && truth.has(r[0].food_id)) acc.top1++;
      if (r.slice(0, 3).some(x => truth.has(x.food_id))) acc.top3++;
    }
  }
  const n = hold.length, f = x => Math.round(1000 * x / n) / 1000;
  return { holdout: n, train: train.length,
    zeroShot: { top1: f(zs.top1), top3: f(zs.top3) },
    adaptive: { top1: f(ad.top1), top3: f(ad.top3) } };
}

// ---- is there food in the photo at all? ----
// the food ranking above always picks something, so this checks first.
// it compares the photo against "food" prompts and "not food" prompts and takes the stronger side.
export const GATE_FOOD = [
  "a photo of food", "a plate of food", "a bowl of food", "a home cooked meal",
  "a photo of a snack", "a photo of a drink", "a photo of fruit", "a photo of Indian food",
  "a photo of packaged food",
];
export const GATE_OTHER = [
  "a photo of a person", "a selfie of a face", "a photo of hair", "a photo of a room",
  "a photo of a wall", "a photo of a ceiling", "a photo of a table", "a photo of a hand",
  "a blurry photo", "a photo of a phone screen", "a photo of a document with text",
  "a photo of an animal", "a photo of a street outside", "a photo of an empty plate",
  "a very dark photo", "a photo of furniture",
];

export function foodGate(imgEmb, gate, threshold = 0.5) {
  const best = list => Math.max(...list.map(e => SCALE * dot(imgEmb, e)));
  const pFood = 1 / (1 + Math.exp(best(gate.other) - best(gate.food)));
  return { pFood, isFood: pFood >= threshold };
}
