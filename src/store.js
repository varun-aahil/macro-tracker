// everything lives in this device's indexeddb. nothing is sent anywhere.
const DB = "macro-tracker", VERSION = 1;
let opened;

function open() {
  opened ||= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      d.createObjectStore("foods", { keyPath: "id", autoIncrement: true });
      d.createObjectStore("meals", { keyPath: "id", autoIncrement: true });
      d.createObjectStore("settings");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return opened;
}

async function run(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const out = fn(t.objectStore(store));
    t.oncomplete = () => resolve(out && "result" in out ? out.result : out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export const all = store => run(store, "readonly", s => s.getAll());
export const get = (store, key) => run(store, "readonly", s => s.get(key));
// foods and meals carry a uid (same on every device) and a mod time, so they can be synced and merged.
// opts.quiet: change nothing about sync (device-only data like text embeddings). opts.keepMod: write the record exactly as given (applying a synced change).
export const EPOCH = "1970-01-01T00:00:00.000Z";
export const SYNC_SETTINGS = ["profile", "targets", "weights", "adapt", "avatar"];
const uuid = () => (globalThis.crypto && crypto.randomUUID ? crypto.randomUUID() : "u" + Date.now().toString(36) + Math.random().toString(36).slice(2));
let writeHook = null;
export const onWrite = fn => { writeHook = fn; };
export async function put(store, value, key, opts = {}) {
  if ((store === "foods" || store === "meals") && !opts.quiet && !opts.keepMod) {
    value.uid ||= uuid();
    value.mod = new Date().toISOString();
  }
  const out = await run(store, "readwrite", s => s.put(value, key));
  if (store === "settings" && SYNC_SETTINGS.includes(key) && !opts.quiet && !opts.keepMod) {
    const mods = (await get("settings", "mods")) || {};
    mods[key] = new Date().toISOString();
    await run("settings", "readwrite", s => s.put(mods, "mods"));
  }
  if (writeHook && !opts.quiet && !opts.keepMod && (store === "foods" || store === "meals" || SYNC_SETTINGS.includes(key))) writeHook();
  return out;
}
export async function del(store, key, opts = {}) {
  if ((store === "foods" || store === "meals") && !opts.quiet) {
    const rec = await get(store, key);
    if (rec && rec.uid) {
      const tombs = (await get("settings", "tombs")) || [];
      tombs.push({ kind: store === "foods" ? "food" : "meal", key: rec.uid, at: new Date().toISOString() });
      await run("settings", "readwrite", s => s.put(tombs.slice(-2000), "tombs"));
    }
  }
  const out = await run(store, "readwrite", s => s.delete(key));
  if (writeHook && !opts.quiet && (store === "foods" || store === "meals")) writeHook();
  return out;
}
export const clear = store => run(store, "readwrite", s => s.clear());

export async function getSetting(key, fallback) {
  const v = await get("settings", key);
  return v === undefined ? fallback : v;
}
export const setSetting = (key, value, opts) => put("settings", value, key, opts);

const ORIGINAL_SEED = 62;   // the first 62 entries of foods.json shipped in the first versions
// give older records a uid and mod time (once), without counting it as an edit
export async function ensureUids() {
  for (const f of await all("foods")) {
    if (f.uid) continue;
    await put("foods", { ...f, uid: f.source === "seed" ? "seed:" + f.name : uuid(), mod: f.source === "seed" ? EPOCH : new Date().toISOString() }, undefined, { quiet: true });
  }
  for (const m of await all("meals")) {
    if (m.uid) continue;
    await put("meals", { ...m, uid: uuid(), mod: m.created_at || new Date().toISOString() }, undefined, { quiet: true });
  }
}

export async function seedFoods() {
  await seedFoodsInner();
  await ensureUids();
}
async function seedFoodsInner() {
  const seed = await (await fetch("foods.json")).json();
  const have = await all("foods");
  let offered = await get("settings", "seed-offered");
  if (!have.length) {
    const db = await open();
    await new Promise((resolve, reject) => {
      const t = db.transaction("foods", "readwrite");
      for (const f of seed) t.objectStore("foods").add({ ...f, source: "seed", archived: 0, uid: "seed:" + f.name, mod: EPOCH });
      t.oncomplete = resolve; t.onerror = () => reject(t.error);
    });
    await setSetting("seed-offered", seed.map(f => f.name));
    return;
  }
  // existing install: fill in fibre on starter foods, and add new starter foods once (never re-adding ones you deleted)
  if (!offered) offered = seed.slice(0, ORIGINAL_SEED).map(f => f.name);
  const names = new Set(have.map(f => f.name.toLowerCase())), done = new Set(offered);
  const byName = Object.fromEntries(seed.map(f => [f.name, f]));
  for (const f of have) if (f.source === "seed" && f.fiber === undefined && byName[f.name]) await put("foods", { ...f, fiber: byName[f.name].fiber }, undefined, { quiet: true });
  for (const f of seed) {
    if (done.has(f.name)) continue;
    done.add(f.name);
    if (!names.has(f.name.toLowerCase())) await put("foods", { ...f, source: "seed", archived: 0, uid: "seed:" + f.name, mod: EPOCH }, undefined, { keepMod: true });
  }
  await setSetting("seed-offered", [...done]);
}

const SETTING_KEYS = SYNC_SETTINGS;

// ---- backup. browsers can wipe site data, so keep a copy somewhere safe ----
const blobToData = b => new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(b); });

export async function exportAll() {
  const [foods, meals, settings] = [await all("foods"), await all("meals"), {}];
  for (const k of SETTING_KEYS) settings[k] = await get("settings", k);
  const out = [];
  for (const m of meals) out.push({ ...m, photo: m.photo ? await blobToData(m.photo) : null });
  return JSON.stringify({ app: "macro-tracker", version: 1, foods, meals: out, settings });
}

export async function importAll(text) {
  const d = JSON.parse(text);
  if (d.app !== "macro-tracker" && d.app !== "plate") throw new Error("That isn't a Macro Tracker backup");
  await clear("foods"); await clear("meals");
  for (const f of d.foods) await put("foods", f);
  for (const m of d.meals) {
    const photo = m.photo ? await (await fetch(m.photo)).blob() : null;
    await put("meals", { ...m, photo });
  }
  for (const k of SETTING_KEYS) if (d.settings && d.settings[k] !== undefined && d.settings[k] !== null) await setSetting(k, d.settings[k]);
}
