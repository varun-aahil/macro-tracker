import test from "node:test";
import assert from "node:assert/strict";
import { parseOFF, validCode } from "../src/barcode.js";
import { unsure } from "../src/learner.js";

test("barcode digits", () => {
  assert.ok(validCode("8901058000290")); assert.ok(!validCode("12ab")); assert.ok(!validCode("1234567"));
});

test("open food facts product becomes a food per 100 g", () => {
  const f = parseOFF({ status: 1, product: { product_name: "Masala Oats", brands: "Saffola, Marico", serving_quantity: "40",
    nutriments: { "energy-kcal_100g": 380, proteins_100g: 11.2, carbohydrates_100g: 65, fat_100g: 7.5, fiber_100g: 9 } } });
  assert.equal(f.name, "Saffola Masala Oats"); assert.equal(f.kcal, 380); assert.equal(f.fiber, 9);
  assert.equal(f.unit_name, "serving"); assert.equal(f.unit_grams, 40);
});

test("kj fallback, and unusable products are rejected", () => {
  assert.equal(parseOFF({ status: 1, product: { product_name: "X", nutriments: { energy_100g: 1000 } } }).kcal, 239);
  assert.equal(parseOFF({ status: 0 }), null);
  assert.equal(parseOFF({ status: 1, product: { product_name: "X", nutriments: {} } }), null);
  assert.equal(parseOFF({ status: 1, product: { product_name: "X", nutriments: { "energy-kcal_100g": 100, proteins_100g: 60, carbohydrates_100g: 60 } } }), null);
});

test("ask when the top guess is not clearly ahead", () => {
  const r = (...p) => p.map((prob, i) => ({ food_id: i + 1, prob }));
  assert.equal(unsure(r(0.9, 0.05, 0.03)), null);
  assert.deepEqual(unsure(r(0.45, 0.3, 0.1)), [1, 2, 3]);
  assert.deepEqual(unsure(r(0.55, 0.4, 0.05)), [1, 2, 3]);
});
