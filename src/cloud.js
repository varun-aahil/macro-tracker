// sign in with Google (through Supabase) and keep this device in step with your account.
// local first: the app works fully offline, and sync is a background extra. photos are never uploaded.
import * as store from "./store.js";
import { toast } from "./ui.js";
import { SUPABASE_URL, SUPABASE_KEY, APP_SCHEME } from "./config.js";
import { plan, foodRow, mealRow, settingRow, mealFromRow } from "./sync.js";

const LIB = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";
const cap = () => globalThis.Capacitor;
export const isNative = () => !!(cap() && cap().isNativePlatform && cap().isNativePlatform());
// Google sign-in needs a normal web address or the Android app. the Windows build (file://) can't do it.
export const available = () => !!globalThis.PLATE_FAKE_CLOUD || isNative() || location.protocol === "https:" || ["localhost", "127.0.0.1"].includes(location.hostname);

// a short trail of what the sign-in did, shown on screen so a failure is never silent
const logKey = "mt-signin-log";
export const getLog = () => { try { return JSON.parse(localStorage.getItem(logKey) || "[]"); } catch { return []; } };
const log = msg => { try { const l = getLog(); l.push(new Date().toTimeString().slice(0, 8) + " " + msg); localStorage.setItem(logKey, JSON.stringify(l.slice(-12))); } catch {} try { listeners.forEach(f => f(state)); } catch {} };
export const clearLog = () => { try { localStorage.removeItem(logKey); } catch {} };

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
  async user() { const { data } = await (await client()).auth.getSession(); const u = data.session && data.session.user; return u ? { id: u.id, email: u.email, name: (u.user_metadata && (u.user_metadata.full_name || u.user_metadata.name)) || "" } : null; },
  async signIn() {
    const c = await client(), native = isNative();
    const { data, error } = await c.auth.signInWithOAuth({ provider: "google", options: { redirectTo: native ? APP_SCHEME : location.origin + location.pathname, skipBrowserRedirect: native } });
    if (error) throw error;
    let v = false; try { v = !!localStorage.getItem("mt-auth-code-verifier"); } catch {}
    log("started; secret saved: " + v);
    if (native) {
      toast("Finish signing in in your browser, then you'll come back here");
      const Browser = cap().registerPlugin ? cap().registerPlugin("Browser") : null;
      try { await Browser.open({ url: data.url }); } catch { location.href = data.url; }
    }
  },
  async finish(url) {   // the app was reopened by the sign-in link
    const u = new URL(url), code = u.searchParams.get("code"), hash = new URLSearchParams(u.hash.slice(1));
    const err = u.searchParams.get("error_description") || hash.get("error_description");
    log("link opened: " + (code ? "has code" : hash.get("access_token") ? "has token" : err ? "error" : "no code"));
    if (err) throw new Error(err);
    const c = await client();
    if (code) {
      let { error } = await c.auth.exchangeCodeForSession(code);
      if (error) {   // try the plain web call with the saved secret
        let ver = ""; try { ver = localStorage.getItem("mt-auth-code-verifier") || ""; } catch {}
        log("exchange failed: " + error.message + "; secret present: " + !!ver);
        if (!ver) throw error;
        const r = await fetch(SUPABASE_URL + "/auth/v1/token?grant_type=pkce", { method: "POST", headers: { apikey: SUPABASE_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ auth_code: code, code_verifier: ver.split("/")[0] }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.access_token) throw new Error(j.error_description || j.msg || j.message || "Sign-in failed (" + r.status + ")");
        const { error: e2 } = await c.auth.setSession({ access_token: j.access_token, refresh_token: j.refresh_token });
        if (e2) throw e2;
      }
    }
    else if (hash.get("access_token") && hash.get("refresh_token")) { const { error } = await c.auth.setSession({ access_token: hash.get("access_token"), refresh_token: hash.get("refresh_token") }); if (error) throw error; }
    else throw new Error("The sign-in link came back without a code. Check the Redirect URLs in Supabase.");
    log("signed in");
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

// Signing in from the Android app happens in the phone's browser. Google/Supabase then send the browser back to the web
// page with ?code=... If this page was opened that way (the sign-in was started by the app, so this browser doesn't hold
// the matching secret), pass the code on to the app through its link instead of trying to use it here.
function relayToApp() {
  if (isNative() || globalThis.PLATE_FAKE_CLOUD) return false;
  let hasVerifier = false;
  try { hasVerifier = !!localStorage.getItem("mt-auth-code-verifier"); } catch {}
  if (!/[?&]code=/.test(location.search) || hasVerifier || !/Android/i.test(navigator.userAgent)) return false;
  const link = APP_SCHEME + "?" + location.search.slice(1);
  document.body.classList.add("onboarding");
  document.getElementById("app").innerHTML = `<div class="ob"><div class="obbody obhero"><h1>Almost done</h1>
    <p class="lead">Google sign-in worked. Tap the button to finish in the Macro Tracker app.</p>
    <div class="welcomeacts"><a class="bigbtn" id="relay" href="${link.replace(/"/g, "&quot;")}" style="text-align:center;text-decoration:none;box-sizing:border-box">Open Macro Tracker</a>
    <p class="muted">If nothing happens, make sure the Macro Tracker app is installed on this phone.</p></div></div></div>`;
  setTimeout(() => { location.href = link; }, 400);
  return true;
}

// ---- start up: restore a session, listen for the sign-in link on Android ----
export async function init(onChange) {
  state.onChange = onChange;
  if (!available()) return;
  if (relayToApp()) return;
  store.onWrite(() => scheduleSync());
  if (isNative() && cap().registerPlugin) {
    try {
      const App = cap().registerPlugin("App"), scheme = APP_SCHEME.split("://")[0] + "://";
      let lastUrl = "";
      const handle = async url => {
        if (!url || !url.startsWith(scheme) || url === lastUrl) return;
        lastUrl = url;
        try { await backend().finish(url); await refreshUser(); if (state.user) { toast("Signed in"); await sync(); } else throw new Error("Signed in, but no session was saved on this phone."); } catch (e) { log("failed: " + (e.message || e)); emit({ error: e.message || String(e) }); }
      };
      App.addListener("appUrlOpen", ({ url }) => { log("app got link"); handle(url); });
      App.addListener("appStateChange", async ({ isActive }) => { if (isActive) { try { const l = await App.getLaunchUrl(); if (l && l.url) handle(l.url); } catch {} if (!state.user) { let has = false; try { has = !!localStorage.getItem("mt-auth"); } catch {} if (has) { await refreshUser(); if (state.user) sync(); } } } });
      try { const l = await App.getLaunchUrl(); if (l && l.url) { log("app started by link"); handle(l.url); } } catch {}   // app was started by the sign-in link
    } catch (e) { emit({ error: "Sign-in link handling isn't available: " + (e.message || e) }); }
  }
  let hasSession = false;
  try { hasSession = !!localStorage.getItem("mt-auth") || /[?&]code=/.test(location.search); } catch {}
  if (globalThis.PLATE_FAKE_CLOUD || hasSession) { await refreshUser(); if (state.user) sync(); }
}

async function refreshUser() {
  try { emit({ user: await backend().user(), error: null }); } catch (e) { emit({ user: null, error: e.message || String(e) }); }
  if (state.user && /[?&]code=/.test(location.search)) history.replaceState(null, "", location.pathname);
}

export async function signIn() { clearLog(); emit({ error: null }); try { await backend().signIn(); } catch (e) { emit({ error: e.message || String(e) }); } }
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
