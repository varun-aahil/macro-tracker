// sign in with Google (through Supabase) and keep this device in step with your account.
// local first: the app works fully offline, and sync is a background extra. photos are never uploaded.
import * as store from "./store.js";
import { SUPABASE_URL, SUPABASE_KEY, APP_SCHEME } from "./config.js";
import { plan, foodRow, mealRow, settingRow, mealFromRow } from "./sync.js";

const LIB = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";
const cap = () => globalThis.Capacitor;
export const isNative = () => !!(cap() && cap().isNativePlatform && cap().isNativePlatform());
// Google sign-in needs a normal web address or the Android app. the Windows build (file://) can't do it.
export const available = () => !!globalThis.PLATE_FAKE_CLOUD || isNative() || location.protocol === "https:";

let sb = null, lib = null, listeners = new Set(), syncing = null, timer = null;
let state = { user: null, last: null, error: null, busy: false };
export const getState = () => state;
export const subscribe = fn => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = patch => { state = { ...state, ...patch }; listeners.forEach(f => f(state)); };

async function client() {
  if (sb) return sb;
  lib ||= await import(LIB);
  sb = lib.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { flowType: "pkce", persistSession: true, autoRefreshToken: true, detectSessionInUrl: !isNative(), storageKey: "mt-auth" } });
  return sb;
}

const real = {
  async user() { const { data } = await (await client()).auth.getSession(); const u = data.session && data.session.user; return u ? { id: u.id, email: u.email } : null; },
  async signIn() {
    const c = await client(), native = isNative();
    const { data, error } = await c.auth.signInWithOAuth({ provider: "google", options: { redirectTo: native ? APP_SCHEME : location.origin + location.pathname, skipBrowserRedirect: native } });
    if (error) throw error;
    if (native) {
      const Browser = cap().registerPlugin ? cap().registerPlugin("Browser") : null;
      try { await Browser.open({ url: data.url }); } catch { location.href = data.url; }
    }
  },
  async finish(url) {   // the app was reopened by the sign-in link
    const u = new URL(url), code = u.searchParams.get("code");
    const err = u.searchParams.get("error_description") || new URLSearchParams(u.hash.slice(1)).get("error_description");
    if (err) throw new Error(err);
    if (!code) return;
    const { error } = await (await client()).auth.exchangeCodeForSession(code);
    if (error) throw error;
    try { await cap().registerPlugin("Browser").close(); } catch {}
  },
  async signOut() { await (await client()).auth.signOut(); },
  async pull(since) {
    const c = await client(), out = [];
    for (let from = 0; ; from += 1000) {
      let q = c.from("sync_items").select("kind,key,data,mod,deleted,updated_at").order("updated_at").order("key").range(from, from + 999);
      if (since) q = q.gt("updated_at", since);
      const { data, error } = await q;
      if (error) throw error;
      out.push(...data);
      if (data.length < 1000) break;
    }
    return out;
  },
  async push(rows, userId) {
    const c = await client();
    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await c.from("sync_items").upsert(rows.slice(i, i + 200).map(r => ({ ...r, user_id: userId })), { onConflict: "user_id,kind,key" });
      if (error) throw error;
    }
  },
  async deleteAll(userId) { const { error } = await (await client()).from("sync_items").delete().eq("user_id", userId); if (error) throw error; },
};
const backend = () => globalThis.PLATE_FAKE_CLOUD || real;

// ---- start up: restore a session, listen for the sign-in link on Android ----
export async function init(onChange) {
  state.onChange = onChange;
  if (!available()) return;
  store.onWrite(() => scheduleSync());
  if (isNative() && cap().registerPlugin) {
    try {
      cap().registerPlugin("App").addListener("appUrlOpen", async ({ url }) => {
        if (!url || !url.startsWith(APP_SCHEME.split("://")[0] + "://")) return;
        try { await backend().finish(url); await refreshUser(); await sync(); } catch (e) { emit({ error: e.message || String(e) }); }
      });
    } catch {}
  }
  let hasSession = false;
  try { hasSession = !!localStorage.getItem("mt-auth") || /[?&]code=/.test(location.search); } catch {}
  if (globalThis.PLATE_FAKE_CLOUD || hasSession) { await refreshUser(); if (state.user) sync(); }
}

async function refreshUser() {
  try { emit({ user: await backend().user(), error: null }); } catch (e) { emit({ user: null, error: e.message || String(e) }); }
  if (state.user && /[?&]code=/.test(location.search)) history.replaceState(null, "", location.pathname);
}

export async function signIn() { emit({ error: null }); try { await backend().signIn(); } catch (e) { emit({ error: e.message || String(e) }); } }
export async function signOut() { await backend().signOut(); emit({ user: null, last: null }); }
export async function deleteCloudData() {
  if (!state.user) return;
  await backend().deleteAll(state.user.id);
  await store.setSetting("sync-state", null, { quiet: true });
}

// run a sync soon, once, however many changes happen in a row
export function scheduleSync(ms = 3000) { if (!state.user) return; clearTimeout(timer); timer = setTimeout(() => sync(), ms); }

export function sync() {
  if (!state.user) return Promise.resolve(false);
  syncing ||= run().finally(() => { syncing = null; });
  return syncing;
}

async function run() {
  emit({ busy: true, error: null });
  try {
    await store.ensureUids();
    const started = new Date().toISOString();
    const st = (await store.getSetting("sync-state", null)) || { lastSync: null, lastPull: null };
    const remote = await backend().pull(st.lastPull);

    const foods = await store.all("foods"), meals = await store.all("meals");
    const uidById = Object.fromEntries(foods.map(f => [f.id, f.uid]));
    const mods = (await store.getSetting("mods", {})) || {};
    const local = [...foods.map(foodRow), ...meals.map(m => mealRow(m, uidById))];
    for (const k of store.SYNC_SETTINGS) {
      const v = await store.getSetting(k, undefined);
      if (v === undefined || (v === null && !mods[k])) continue;
      if (!mods[k]) { mods[k] = started; await store.put("settings", mods, "mods", { quiet: true }); }
      local.push(settingRow(k, v, mods[k]));
    }
    const tombs = (await store.getSetting("tombs", [])) || [];
    const { push, apply, remove } = plan({ local, remote, tombs, lastSync: st.lastSync });

    // write what changed elsewhere into this device: foods first, so meals can find them
    const byUid = Object.fromEntries(foods.map(f => [f.uid, f]));
    for (const r of apply.filter(x => x.kind === "food")) {
      const ex = byUid[r.key], rec = { ...r.data, uid: r.key, mod: r.mod };
      if (ex) { rec.id = ex.id; if (ex.textEmb) { rec.textEmb = ex.textEmb; rec.textFor = ex.textFor; } }
      const id = await store.put("foods", rec, undefined, { keepMod: true });
      byUid[r.key] = { ...rec, id: rec.id ?? id };
    }
    for (const r of remove.filter(x => x.kind === "food")) { const ex = byUid[r.key]; if (ex) { await store.del("foods", ex.id, { quiet: true }); delete byUid[r.key]; } }
    const idByUid = Object.fromEntries(Object.entries(byUid).map(([u, f]) => [u, f.id]));
    const mByUid = Object.fromEntries(meals.map(m => [m.uid, m]));
    for (const r of apply.filter(x => x.kind === "meal")) await store.put("meals", mealFromRow(r, idByUid, mByUid[r.key]), undefined, { keepMod: true });
    for (const r of remove.filter(x => x.kind === "meal")) { const ex = mByUid[r.key]; if (ex) await store.del("meals", ex.id, { quiet: true }); }
    const newMods = { ...mods };
    for (const r of apply.filter(x => x.kind === "setting")) { await store.setSetting(r.key, r.data.value, { keepMod: true }); newMods[r.key] = r.mod; }
    for (const r of remove.filter(x => x.kind === "setting")) { await store.setSetting(r.key, null, { keepMod: true }); newMods[r.key] = r.mod; }
    await store.put("settings", newMods, "mods", { quiet: true });

    if (push.length) await backend().push(push, state.user.id);
    const lastPull = remote.reduce((a, r) => (r.updated_at > a ? r.updated_at : a), st.lastPull || "") || null;
    await store.setSetting("sync-state", { lastSync: started, lastPull }, { quiet: true });
    await store.setSetting("tombs", tombs.filter(t => t.at > started), { quiet: true });
    emit({ busy: false, last: new Date().toISOString() });
    if ((apply.length || remove.length) && state.onChange) state.onChange();
    return true;
  } catch (e) {
    emit({ busy: false, error: e.message || String(e) });
    return false;
  }
}
