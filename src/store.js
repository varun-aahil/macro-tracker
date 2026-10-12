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
export const put = (store, value, key) => run(store, "readwrite", s => s.put(value, key));
export const del = (store, key) => run(store, "readwrite", s => s.delete(key));
export const clear = store => run(store, "readwrite", s => s.clear());

export async function getSetting(key, fallback) {
  const v = await get("settings", key);
  return v === undefined ? fallback : v;
}
export const setSetting = (key, value) => put("settings", value, key);

export async function seedFoods() {
  const have = await all("foods");
  if (have.length) {   // older installs: fill in fibre for the starter foods, never touching edited values
    const seed = await (await fetch("foods.json")).json(), by = Object.fromEntries(seed.map(f => [f.name, f.fiber]));
    for (const f of have) if (f.source === "seed" && f.fiber === undefined && by[f.name] !== undefined) await put("foods", { ...f, fiber: by[f.name] });
    return;
  }
  const seed = await (await fetch("foods.json")).json();
  const db = await open();
  await new Promise((resolve, reject) => {
    const t = db.transaction("foods", "readwrite");
    for (const f of seed) t.objectStore("foods").add({ ...f, source: "seed", archived: 0 });
    t.oncomplete = resolve; t.onerror = () => reject(t.error);
  });
}

const SETTING_KEYS = ["targets", "profile", "weights", "adapt", "avatar"];

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
