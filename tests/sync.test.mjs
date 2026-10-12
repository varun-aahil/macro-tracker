import test from "node:test";
import assert from "node:assert/strict";
import { plan, foodRow, mealRow, mealFromRow, settingRow } from "../src/sync.js";

const T = n => new Date(Date.UTC(2026, 9, 12, 10, n)).toISOString();
const food = (uid, mod, extra = {}) => ({ kind: "food", key: uid, data: { name: uid, uid, mod }, mod, deleted: false, ...extra });

test("first sync pushes everything local and pulls everything remote", () => {
  const p = plan({ local: [food("a", T(1))], remote: [food("b", T(2))] });
  assert.deepEqual(p.push.map(r => r.key), ["a"]);
  assert.deepEqual(p.apply.map(r => r.key), ["b"]);
});

test("the newer change wins, in either direction", () => {
  const p = plan({ local: [food("a", T(5)), food("b", T(1))], remote: [food("a", T(3)), food("b", T(4))] });
  assert.deepEqual(p.push.map(r => r.key), ["a"]);
  assert.deepEqual(p.apply.map(r => r.key), ["b"]);
});

test("equal times mean nothing to do", () => {
  const p = plan({ local: [food("a", T(5))], remote: [food("a", T(5))] });
  assert.equal(p.push.length + p.apply.length + p.remove.length, 0);
});

test("a delete on one device removes it on the other, unless edited after", () => {
  const gone = { kind: "food", key: "a", data: null, mod: T(5), deleted: true };
  assert.deepEqual(plan({ local: [food("a", T(2))], remote: [gone] }).remove, [{ kind: "food", key: "a" }]);
  const p = plan({ local: [food("a", T(9))], remote: [gone] });
  assert.equal(p.remove.length, 0); assert.deepEqual(p.push.map(r => r.key), ["a"]);
});

test("deleting here is sent as a tombstone", () => {
  const p = plan({ local: [], remote: [], tombs: [{ kind: "meal", key: "m1", at: T(3) }], lastSync: T(1) });
  assert.deepEqual(p.push, [{ kind: "meal", key: "m1", data: null, mod: T(3), deleted: true }]);
  // already synced earlier: not sent again
  assert.equal(plan({ local: [], remote: [], tombs: [{ kind: "meal", key: "m1", at: T(3) }], lastSync: T(4) }).push.length, 0);
  // someone edited it after we deleted: their edit wins
  const p2 = plan({ local: [], remote: [food("x", T(9))], tombs: [{ kind: "food", key: "x", at: T(3) }] });
  assert.deepEqual(p2.apply.map(r => r.key), ["x"]);
});

test("later syncs only push what changed since the last one, and skip untouched starter foods", () => {
  const seed = { kind: "food", key: "seed:Apple", data: { source: "seed" }, mod: "1970-01-01T00:00:00.000Z", deleted: false };
  const p = plan({ local: [food("old", T(1)), food("new", T(8)), seed], remote: [], lastSync: T(5) });
  assert.deepEqual(p.push.map(r => r.key), ["new"]);
  assert.equal(plan({ local: [seed], remote: [], lastSync: null }).push.length, 0);
});

test("meals travel by food uid and come back with this device's food ids", () => {
  const meal = { id: 7, uid: "m1", mod: T(2), log_date: "2026-10-12", meal_type: "lunch", photo: new Blob(["x"]), emb: [0.123456789, 0.5],
    items: [{ food_id: 3, food_name: "Apple", grams: 100 }, { food_id: 99, food_name: "Gone", grams: 5 }], totals: { kcal: 52 } };
  const row = mealRow(meal, { 3: "seed:Apple" });
  assert.equal(row.data.photo, undefined); assert.equal(row.data.id, undefined);
  assert.deepEqual(row.data.emb, [0.1235, 0.5]);
  const back = mealFromRow(row, { "seed:Apple": 41 }, null);
  assert.deepEqual(back.items.map(i => i.food_id), [41]);    // the unknown food is dropped
  assert.equal(back.uid, "m1"); assert.equal(back.photo, null);
  const kept = mealFromRow(row, { "seed:Apple": 41 }, { id: 12, photo: "P", emb: [1] });
  assert.equal(kept.id, 12); assert.equal(kept.photo, "P"); assert.deepEqual(kept.emb, [1]);
});

test("rows for food and settings", () => {
  assert.equal(foodRow({ id: 1, uid: "u", mod: T(1), name: "x", textEmb: [1], textFor: "y" }).data.textEmb, undefined);
  assert.deepEqual(settingRow("targets", { kcal: 2000 }, T(1)).data, { value: { kcal: 2000 } });
});
