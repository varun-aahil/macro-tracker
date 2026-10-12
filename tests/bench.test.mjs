import test from "node:test";
import assert from "node:assert/strict";
import { evaluateSet, fewShotCurve } from "../bench/metrics.mjs";
import { normalize } from "../src/learner.js";

// tiny synthetic world: each food has a text direction; photos are a noisy mix of the right food and a confusable one
function world() {
  const dim = 24, rnd = (() => { let s = 7; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296 - 0.5; })();
  const vec = () => normalize(Array.from({ length: dim }, rnd));
  const foods = [1, 2, 3, 4].map(id => ({ id, name: "f" + id, textEmb: vec() }));
  const add = (a, b, w) => normalize(a.map((x, i) => x + w * b[i]));
  const photo = (food, other) => add(add(food.textEmb, vec(), 0.35), other.textEmb, 0.55);   // text is misleading, so examples have to help
  return { foods, photo };
}

test("scores a perfect and a hopeless ranker", () => {
  const { foods } = world();
  const items = foods.map(f => ({ emb: f.textEmb, truth: new Set([f.id]) }));
  const good = evaluateSet(items, foods);
  assert.equal(good.top1, 1); assert.equal(good.n, 4);
  const bad = evaluateSet(foods.map(f => ({ emb: f.textEmb, truth: new Set([99]) })), foods);
  assert.equal(bad.top1, 0);
});

test("accuracy goes up when the app has seen your photos", () => {
  const { foods, photo } = world();
  const pool = {}, tests = [];
  for (const f of foods) {
    const other = foods[(f.id) % foods.length];
    pool[f.id] = Array.from({ length: 16 }, () => photo(f, other));
    for (let i = 0; i < 12; i++) tests.push({ emb: photo(f, other), truth: new Set([f.id]) });
  }
  const curve = fewShotCurve({ pool, test: tests, foods, ks: [0, 4, 16] });
  assert.equal(curve.length, 3);
  assert.ok(curve[2].top1 >= curve[0].top1, JSON.stringify(curve));
  assert.ok(curve.every(c => c.top1 >= 0 && c.top1 <= 1 && c.ece >= 0));
});
