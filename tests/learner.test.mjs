import test from "node:test";
import assert from "node:assert/strict";
import { normalize, rank, pickDraft, buildExamples, evaluate, typicalGrams } from "../src/learner.js";
import { applyActual, buildItems, stats, nextSplit, validateFood, history } from "../src/logic.js";

let seed = 7;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
const vec = (d = 64) => normalize(Array.from({ length: d }, rnd));
const mix = (parts) => normalize(parts[0][1].map((_, i) => parts.reduce((s, [w, v]) => s + w * v[i], 0)));

const N = 8;
const text = Array.from({ length: N }, vec);       // what clip knows about each food name
const look = Array.from({ length: N }, vec);       // how *your* version of the food looks
const foods = text.map((t, i) => ({ id: i + 1, name: "f" + i, textEmb: t, unit_grams: 100 }));
// zero-shot signal is weak: the photo only partly resembles the name
const photo = (f) => mix([[0.25, text[f]], [1, look[f]], [0.35, vec()]]);

function meals(n, startSplit = true) {
  return Array.from({ length: n }, (_, k) => {
    const f = k % N;
    return { id: k + 1, emb: photo(f), split: k % 5 === 4 ? "holdout" : "train",
      items: [{ food_id: f + 1, grams: 100 + f }] };
  });
}

test("learning from corrections beats zero-shot on holdout", () => {
  const ev = evaluate(meals(80), foods);
  assert.ok(ev.holdout >= 10);
  assert.ok(ev.adaptive.top1 > ev.zeroShot.top1, JSON.stringify(ev));
  assert.ok(ev.adaptive.top1 >= 0.8, JSON.stringify(ev));
});

test("no examples means plain zero-shot ordering", () => {
  const r = rank(text[3], foods, {});
  assert.equal(r[0].food_id, 4);
  assert.ok(Math.abs(r.reduce((s, x) => s + x.prob, 0) - 1) < 1e-9);
});

test("holdout meals never become examples", () => {
  const ex = buildExamples(meals(10));
  const total = Object.values(ex).reduce((s, a) => s + a.length, 0);
  assert.equal(total, 8);
});

test("draft keeps top food and close runners-up only", () => {
  const d = pickDraft([{ food_id: 1, prob: 0.6 }, { food_id: 2, prob: 0.3 }, { food_id: 3, prob: 0.05 }]);
  assert.deepEqual(d.items.map(i => i.food_id), [1, 2]);
  assert.deepEqual(d.more.map(i => i.food_id), [3]);
});

test("typical grams uses your history", () => {
  const f = { id: 1, unit_grams: 40 };
  assert.equal(typicalGrams(f, []), 40);
  assert.equal(typicalGrams(f, [{ items: [{ food_id: 1, grams: 120 }] }, { items: [{ food_id: 1, grams: 100 }] }]), 110);
});

test("typed kcal rescales grams and typed macros override", () => {
  const food = { id: 1, name: "x", kcal: 200, protein: 10, carbs: 20, fat: 5 };
  const items = buildItems([{ food_id: 1, grams: 100, from_pred: true, pred_grams: 100 }], { 1: food });
  const r = applyActual(items, { kcal: 600, protein: 40 });
  assert.equal(r.items[0].grams, 300);
  assert.equal(r.totals.kcal, 600);
  assert.equal(r.totals.protein, 40);
  assert.equal(r.totals.carbs, 60);
});

test("stats measure the first guess against the corrected meal", () => {
  const m = [{ pred_kcal: 400, pred_count: 2, totals: { kcal: 600 },
    items: [{ from_pred: true, pred_grams: 100, grams: 150 }, { from_pred: false, grams: 20 }] }];
  const s = stats(m);
  assert.equal(s.precision, 0.5);
  assert.equal(s.recall, 0.5);
  assert.equal(s.kcal.bias, -200);
  assert.equal(s.grams.mae, 50);
});

test("every 5th photo meal is holdout; validation; history", () => {
  assert.equal(nextSplit(meals(4)), "holdout");
  assert.equal(nextSplit(meals(3)), "train");
  assert.ok(validateFood({ name: "", kcal: 1, protein: 1, carbs: 1, fat: 1 }));
  assert.equal(validateFood({ name: "ok", kcal: 100, protein: 10, carbs: 10, fat: 1 }), null);
  assert.equal(history([], "2026-10-10", 7).length, 7);
});
