import * as store from "./store.js";
import { $, esc, today, isoOf, parseISO, shiftDay, niceDate, ICON, toast } from "./ui.js";
import { renderOnboarding } from "./onboarding.js";
import { renderMe, getCheckin, planInput, latestWeight } from "./me.js";
import { ageFrom } from "./plan.js";
import * as embed from "./embed.js";
import { rank, pickDraft, buildExamples, typicalGrams, evaluate, foodGate, GATE_FOOD, GATE_OTHER } from "./learner.js";
import { MEAL_TYPES, DEFAULT_TARGETS, macrosFor, sumMacros, validateFood, num, buildItems,
  applyActual, dayTotals, nextSplit, stats } from "./logic.js";

if (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) document.documentElement.classList.add("native");

const MEAL_LABELS = { breakfast: "Breakfast", lunch: "Lunch", snack: "Snacks", dinner: "Dinner" };
const guessMeal = () => { const h = new Date().getHours(); return h < 11 ? "breakfast" : h < 16 ? "lunch" : h < 19 ? "snack" : "dinner"; };
let mealPick = null;

let tab = "today", date = today(), draft = null;
let foods = [], meals = [], targets = DEFAULT_TARGETS;
let profile = null, weights = [], adapt = null, editing = false, pending = null;

async function reload() {
  foods = (await store.all("foods")).filter(f => !f.archived).sort((a, b) => a.name.localeCompare(b.name));
  meals = (await store.all("meals")).sort((a, b) => a.created_at.localeCompare(b.created_at));
  targets = await store.getSetting("targets", DEFAULT_TARGETS);
  profile = await store.getSetting("profile", null);
  weights = await store.getSetting("weights", []);
  adapt = await store.getSetting("adapt", null);
  const c = profile ? getCheckin({ profile, targets, meals, weights, adapt, todayISO: today() }) : null;
  pending = c && c.state === "suggest" ? c : null;
}
const foodMap = () => Object.fromEntries(foods.map(f => [f.id, f]));

function renderNav() {
  const tabs = [["today", "Today"], ["add", "Add"], ["foods", "Foods"], ["me", "Me"]];
  $("#nav").innerHTML = tabs.map(([k, l]) =>
    `<button class="${tab === k ? "on" : ""}${k === "add" ? " plus" : ""}" data-t="${k}"><span class="ic">${ICON[k]}${k === "me" && pending ? '<i class="dot"></i>' : ""}</span><span>${l}</span></button>`).join("");
  $("#nav").querySelectorAll("button").forEach(b => b.onclick = () => { tab = b.dataset.t; draft = null; mealPick = null; show(); });
}

async function finishOnboarding({ profile: p, weightKg, targets: t }) {
  const old = profile;
  await store.setSetting("profile", { ...p, startWeightKg: old && old.startWeightKg ? old.startWeightKg : weightKg });
  await store.setSetting("targets", t);
  const now = today(), last = weights.length ? weights[weights.length - 1].kg : null;
  if (last === null || last !== weightKg) {
    await store.setSetting("weights", weights.filter(w => w.date !== now).concat({ date: now, kg: weightKg }).sort((x, y) => x.date.localeCompare(y.date)));
  }
  editing = false; tab = old ? "me" : "today"; show();
}

async function show() {
  const app = $("#app");
  try {
    await reload();
    renderNav();
    const gate = !profile || editing;
    document.body.classList.toggle("onboarding", gate);
    if (gate) {
      const existing = profile ? { profile, age: ageFrom(profile.birthYear), weightKg: latestWeight(weights, 70), targets } : null;
      renderOnboarding(app, {
        existing, onFinish: finishOnboarding,
        onCancel: () => { editing = false; show(); },
        onRestore: async file => {
          try { await store.importAll(await file.text()); show(); } catch (err) { toast(err.message || "That backup didn't work"); }
        },
      });
      window.scrollTo(0, 0);
      return;
    }
    if (tab === "today") viewToday(app);
    else if (tab === "add") draft ? viewReview(app) : viewAdd(app);
    else if (tab === "foods") viewFoods(app);
    else renderMe(app, { profile, weights, targets, meals, foods, adapt, refresh: show, editProfile: () => { editing = true; show(); } });
  } catch (e) { app.innerHTML = `<div class="card warn">${esc(e.message)}</div>`; }
}

/* ---------- today ---------- */
function barRow(label, val, target, color) {
  const pct = Math.min(100, target ? (val / target) * 100 : 0);
  return `<div><div class="row spread"><span class="muted">${label}</span><span><b>${Math.round(val)}</b><span class="muted"> / ${target}g</span></span></div>
    <div class="bar"><i style="width:${pct}%;background:${color}"></i></div></div>`;
}
const greeting = () => { const h = new Date().getHours(); return h < 5 ? "Hello" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening"; };

function viewToday(app) {
  const day = meals.filter(m => m.log_date === date);
  const t = dayTotals(day), left = Math.round(targets.kcal - t.kcal);
  const urls = [];
  app.innerHTML = `
    <div class="muted greet">${esc(greeting())}, ${esc(profile.name)}</div>
    <h1>Macro Tracker</h1>
    ${pending ? `<button class="banner" id="gocheck"><b>Your weekly check-in is ready</b><span>Suggested target: ${pending.kcal} kcal</span></button>` : ""}
    <div class="datebar">
      <button class="icb" id="dprev" aria-label="Previous day">${ICON.left}</button>
      <button class="datechip" id="dopen">${ICON.today}<span>${esc(niceDate(date))}</span></button>
      <button class="icb" id="dnext" aria-label="Next day">${ICON.right}</button>
    </div>
    <div class="card">
      <div class="big">${Math.round(t.kcal)}<span class="muted" style="font-size:16px"> kcal</span></div>
      <div class="muted">${left >= 0 ? left + " left of " + targets.kcal : (-left) + " over " + targets.kcal}</div>
      <div class="bar"><i style="width:${Math.min(100, t.kcal / targets.kcal * 100)}%;background:var(--chili)"></i></div>
      <div style="display:grid;gap:12px;margin-top:16px">
        ${barRow("Protein", t.protein, targets.protein, "var(--leaf)")}
        ${barRow("Carbs", t.carbs, targets.carbs, "var(--wheat)")}
        ${barRow("Fat", t.fat, targets.fat, "var(--sky)")}
      </div></div>
    ${MEAL_TYPES.map(type => {
      const ms = day.filter(m => (MEAL_TYPES.includes(m.meal_type) ? m.meal_type : "snack") === type);
      const st = dayTotals(ms);
      return `<section class="sec">
        <div class="sechead"><div><b>${MEAL_LABELS[type]}</b>
          <div class="muted">${ms.length ? `${Math.round(st.kcal)} kcal · P ${Math.round(st.protein)} · C ${Math.round(st.carbs)} · F ${Math.round(st.fat)}` : "Nothing yet"}</div></div>
          <button class="small ghost" data-addto="${type}">+ Add</button></div>
        ${ms.map(m => { const u = m.photo ? URL.createObjectURL(m.photo) : null; if (u) urls.push(u);
          const time = new Date(m.created_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
          return `<div class="card meal">
          ${u ? `<img src="${u}" alt="">` : ""}
          <div class="row spread"><span class="muted">${esc(time)}</span><b>${Math.round(m.totals.kcal)} kcal</b></div>
          <div>${m.items.map(i => esc(i.food_name) + " " + Math.round(i.grams) + "g").join(" · ")}</div>
          <div class="muted">P ${Math.round(m.totals.protein)} · C ${Math.round(m.totals.carbs)} · F ${Math.round(m.totals.fat)}${m.actual ? " · numbers you entered" : ""}</div>
          <button class="danger" data-del="${m.id}">Delete</button></div>`; }).join("")}
      </section>`;
    }).join("")}`;
  app.querySelectorAll("[data-addto]").forEach(b => b.onclick = () => { mealPick = b.dataset.addto; tab = "add"; draft = null; show(); });
  const gc = $("#gocheck"); if (gc) gc.onclick = () => { tab = "me"; show(); };
  $("#dprev").onclick = () => { date = shiftDay(date, -1); show(); };
  $("#dnext").onclick = () => { date = shiftDay(date, 1); show(); };
  $("#dopen").onclick = openCalendar;
  app.querySelectorAll("[data-del]").forEach(b => b.onclick = async () => {
    if (!confirm("Delete this meal?")) return;
    await store.del("meals", +b.dataset.del); show();
  });
}

/* ---------- calendar ---------- */
function openCalendar() {
  const logged = new Set(meals.map(m => m.log_date));
  const view = parseISO(date); view.setDate(1);
  const sheet = document.createElement("div"); sheet.className = "sheet";
  document.body.appendChild(sheet);
  const close = () => sheet.remove();
  sheet.onclick = e => { if (e.target === sheet) close(); };
  const draw = () => {
    const y = view.getFullYear(), m = view.getMonth();
    const lead = new Date(y, m, 1).getDay(), count = new Date(y, m + 1, 0).getDate();
    const cells = Array.from({ length: lead }, () => "<span></span>");
    for (let d = 1; d <= count; d++) {
      const iso = isoOf(new Date(y, m, d));
      cells.push(`<button class="day${iso === date ? " sel" : ""}${iso === today() ? " now" : ""}" data-d="${iso}">${d}${logged.has(iso) ? "<i></i>" : ""}</button>`);
    }
    sheet.innerHTML = `<div>
      <div class="row spread"><button class="icb" id="cp" aria-label="Previous month">${ICON.left}</button>
        <b class="calt">${view.toLocaleDateString([], { month: "long", year: "numeric" })}</b>
        <button class="icb" id="cn" aria-label="Next month">${ICON.right}</button></div>
      <div class="cal wk">${["S", "M", "T", "W", "T", "F", "S"].map(x => `<span>${x}</span>`).join("")}</div>
      <div class="cal">${cells.join("")}</div>
      <div class="row spread" style="margin-top:14px"><button class="ghost small" id="ct">Today</button><button class="ghost small" id="cx">Close</button></div></div>`;
    $("#cp", sheet).onclick = () => { view.setMonth(view.getMonth() - 1); draw(); };
    $("#cn", sheet).onclick = () => { view.setMonth(view.getMonth() + 1); draw(); };
    $("#cx", sheet).onclick = close;
    $("#ct", sheet).onclick = () => { date = today(); close(); show(); };
    sheet.querySelectorAll(".day").forEach(b => b.onclick = () => { date = b.dataset.d; close(); show(); });
  };
  draw();
}

/* ---------- add ---------- */
async function shrink(file) {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  const k = Math.min(1, 640 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise(res => c.toBlob(res, "image/jpeg", 0.85));
}

async function ensureTextEmbeddings(onStep) {
  const todo = foods.filter(f => !f.textEmb || f.textFor !== embed.promptFor(f));
  let n = 0;
  for (const f of todo) {
    onStep(++n, todo.length);
    f.textEmb = await embed.embedText(embed.promptFor(f));
    f.textFor = embed.promptFor(f);
    await store.put("foods", f);
  }
}

async function ensureGate() {
  let g = await store.getSetting("gate-v1", null);
  if (g) return g;
  g = { food: [], other: [] };
  for (const t of GATE_FOOD) g.food.push(await embed.embedText(t));
  for (const t of GATE_OTHER) g.other.push(await embed.embedText(t));
  await store.setSetting("gate-v1", g);
  return g;
}

async function buildDraft(blob, emb) {
  const fresh = (await store.all("foods")).filter(x => !x.archived);
  const picked = pickDraft(rank(emb, fresh, buildExamples(meals)));
  const byId = Object.fromEntries(fresh.map(x => [x.id, x]));
  const items = picked.items.map(r => {
    const food = byId[r.food_id], grams = typicalGrams(food, meals);
    return { food_id: food.id, grams, from_pred: true, pred_grams: grams, prob: r.prob };
  });
  const more = picked.more.map(r => ({ food_id: r.food_id, prob: r.prob }));
  const pred = sumMacros(items.map(i => macrosFor(byId[i.food_id], i.grams)));
  draft = { blob, emb, items, more, pred_kcal: pred.kcal, pred_count: items.length };
  show();
}

function viewAdd(app) {
  app.innerHTML = `<h1>Add a meal</h1>
    <p class="muted">Photo from above, whole plate in frame, good light.</p>
    <label class="cam">Take a photo
      <input type="file" accept="image/*" capture="environment" id="file"></label>
    <label class="cam alt">Choose from gallery
      <input type="file" accept="image/*" id="gal"></label>
    <button class="ghost" id="manual" style="width:100%;margin-top:14px">Log without a photo</button>
    <div id="busy"></div>`;
  $("#manual").onclick = () => { draft = { blob: null, emb: null, items: [], more: [], pred_kcal: null, pred_count: 0 }; show(); };
  const handle = async e => {
    const f = e.target.files[0]; if (!f) return;
    const busy = $("#busy");
    const say = html => busy.innerHTML = html;
    try {
      say('<p class="muted">Preparing photo…</p>');
      const blob = await shrink(f);
      if (!embed.ready()) {
        say('<p class="muted">Downloading the food model (about 150 MB, once). Keep this open.</p><progress id="pg" max="100"></progress>');
        await embed.loadModel(p => { if (p.status === "progress" && $("#pg")) $("#pg").value = p.progress; });
      }
      await ensureTextEmbeddings((n, t) => say(`<p class="muted">Learning your food names (one time) ${n} / ${t}</p><progress max="${t}" value="${n}"></progress>`));
      say('<p class="muted">Looking at your plate…</p>');
      const emb = await embed.embedImage(blob);
      const gate = await ensureGate();
      if (!foodGate(emb, gate).isFood) {
        say(`<div class="card"><b>No food detected</b>
          <p class="muted">I couldn't see a meal in that photo. Try again with the plate in frame and good light.</p>
          <button class="ghost" id="anyway" style="width:100%">It is food, continue anyway</button></div>`);
        $("#anyway").onclick = () => buildDraft(blob, emb);
        return;
      }
      await buildDraft(blob, emb);
    } catch (err) {
      say(`<p class="warn">${esc(err.message || err)}. If this is the first run, check your internet connection and try again.</p>`);
    }
    e.target.value = "";
  };
  $("#file").onchange = handle;
  $("#gal").onchange = handle;
}

/* ---------- review ---------- */
function liveTotals() {
  const fm = foodMap();
  return sumMacros(draft.items.filter(i => fm[i.food_id]).map(i => macrosFor(fm[i.food_id], Number(i.grams) || 0)));
}
function viewReview(app) {
  const d = draft, fm = foodMap(), t = liveTotals();
  const url = d.blob ? URL.createObjectURL(d.blob) : null;
  const guess = mealPick || guessMeal();
  app.innerHTML = `<h1>Check this</h1>
    ${url ? `<img class="photo" src="${url}" alt="">` : ""}
    ${d.blob ? '<p class="muted">This is a guess from the photo. Fix it below. Every correction teaches the app your food and your portions.</p>' : ""}
    <div class="card" id="items">${d.items.length ? "" : '<span class="muted">No foods yet.</span>'}
      ${d.items.map((it, n) => { const f = fm[it.food_id]; return `<div class="item">
        <div class="row spread"><span class="name">${esc(f.name)}${it.prob != null ? ` <span class="muted">${Math.round(it.prob * 100)}%</span>` : ""}</span>
          <button class="danger" data-rm="${n}">Remove</button></div>
        <div class="row" style="margin-top:6px"><input type="number" inputmode="decimal" min="1" value="${it.grams}" data-g="${n}" style="width:110px"><span class="muted">grams${f.unit_name && f.unit_grams ? ` (1 ${esc(f.unit_name)} ≈ ${f.unit_grams}g)` : ""}</span></div>
      </div>`; }).join("")}
      <button class="ghost" id="addfood" style="margin-top:8px;width:100%">+ Add food</button></div>
    ${d.more.length ? `<div class="muted">Other guesses:</div>${d.more.map((s, n) => `<span class="chip" data-more="${n}">+ ${esc(fm[s.food_id]?.name || "")}</span>`).join("")}` : ""}
    <div class="card"><div class="row spread"><b id="tk">${Math.round(t.kcal)} kcal</b>
      <span class="muted" id="tm">P ${Math.round(t.protein)} · C ${Math.round(t.carbs)} · F ${Math.round(t.fat)}</span></div>
      <label>Meal</label><select id="mt">${MEAL_TYPES.map(m => `<option value="${m}" ${m === guess ? "selected" : ""}>${MEAL_LABELS[m]}</option>`).join("")}</select></div>
    <div class="card"><b>Know the real numbers?</b>
      <div class="note">From a label, a weighed plate or a restaurant menu. Enter what you know. Calories rescale your portions, protein, carbs and fat replace the estimate. This is what trains it.</div>
      <div class="row"><div><label>kcal</label><input id="ak" type="number" inputmode="decimal"></div><div><label>Protein</label><input id="ap" type="number" inputmode="decimal"></div></div>
      <div class="row"><div><label>Carbs</label><input id="ac" type="number" inputmode="decimal"></div><div><label>Fat</label><input id="af" type="number" inputmode="decimal"></div></div></div>
    <div class="row"><button id="save" style="flex:1">Save meal</button><button class="ghost" id="cancel">Cancel</button></div>`;

  const refresh = () => {
    const x = liveTotals();
    $("#tk").textContent = Math.round(x.kcal) + " kcal";
    $("#tm").textContent = `P ${Math.round(x.protein)} · C ${Math.round(x.carbs)} · F ${Math.round(x.fat)}`;
  };
  app.querySelectorAll("[data-g]").forEach(inp => inp.oninput = () => { d.items[+inp.dataset.g].grams = parseFloat(inp.value) || 0; refresh(); });
  app.querySelectorAll("[data-rm]").forEach(b => b.onclick = () => { d.items.splice(+b.dataset.rm, 1); show(); });
  const addItem = f => { d.items.push({ food_id: f.id, grams: typicalGrams(f, meals), from_pred: false, pred_grams: null }); show(); };
  $("#addfood").onclick = () => openPicker(addItem);
  app.querySelectorAll("[data-more]").forEach(c => c.onclick = () => {
    const s = d.more[+c.dataset.more]; d.more.splice(+c.dataset.more, 1); addItem(fm[s.food_id]);
  });
  $("#cancel").onclick = () => { draft = null; show(); };
  $("#save").onclick = async () => {
    if (!d.items.length) { toast("Add at least one food"); return; }
    $("#save").disabled = true;
    try {
      const built = buildItems(d.items, fm);
      const { items, totals, actual } = applyActual(built, { kcal: $("#ak").value, protein: $("#ap").value, carbs: $("#ac").value, fat: $("#af").value });
      await store.put("meals", {
        log_date: date, created_at: new Date().toISOString(), meal_type: $("#mt").value,
        photo: d.blob, emb: d.emb, split: d.emb ? nextSplit(meals) : null,
        pred_kcal: d.pred_kcal, pred_count: d.pred_count, items, totals, actual,
        engine: d.emb ? "clip" : "manual",
      });
      draft = null; mealPick = null; tab = "today"; toast("Saved"); show();
    } catch (e) { toast(e.message); $("#save").disabled = false; }
  };
}

/* ---------- food picker and form ---------- */
function openPicker(onPick) {
  const s = document.createElement("div"); s.className = "sheet";
  s.innerHTML = `<div><div class="row spread"><b>Choose a food</b><button class="ghost small" id="x">Close</button></div>
    <input id="q" placeholder="Search" style="margin:10px 0"><div id="list"></div>
    <button class="ghost" id="new" style="width:100%;margin-top:10px">+ New food</button><div id="form"></div></div>`;
  document.body.appendChild(s);
  const close = () => s.remove();
  $("#x", s).onclick = close; s.onclick = e => { if (e.target === s) close(); };
  const load = () => {
    const q = $("#q", s).value.trim().toLowerCase();
    const list = foods.filter(f => f.name.toLowerCase().includes(q)).slice(0, 60);
    $("#list", s).innerHTML = list.map(f => `<div class="pick" data-id="${f.id}">${esc(f.name)}<div class="muted">${f.kcal} kcal · P ${f.protein} · C ${f.carbs} · F ${f.fat} per 100g</div></div>`).join("") || '<p class="muted">No match.</p>';
    s.querySelectorAll(".pick").forEach(p => p.onclick = () => { close(); onPick(foods.find(f => f.id === +p.dataset.id)); });
  };
  $("#q", s).oninput = load;
  $("#new", s).onclick = () => foodForm($("#form", s), null, async f => { await reload(); close(); onPick(foods.find(x => x.id === f.id)); });
  load();
}

function foodForm(el, food, done) {
  const v = k => food ? food[k] ?? "" : "";
  el.innerHTML = `<div class="card"><label>Name</label><input id="fn" value="${esc(v("name"))}">
    <p class="muted">Values per 100 g (check the label).</p>
    <div class="row"><div><label>kcal</label><input id="fk" type="number" inputmode="decimal" value="${v("kcal")}"></div>
    <div><label>Protein</label><input id="fp" type="number" inputmode="decimal" value="${v("protein")}"></div></div>
    <div class="row"><div><label>Carbs</label><input id="fc" type="number" inputmode="decimal" value="${v("carbs")}"></div>
    <div><label>Fat</label><input id="ff" type="number" inputmode="decimal" value="${v("fat")}"></div></div>
    <div class="row"><div><label>Unit (optional, e.g. roti)</label><input id="un" value="${esc(v("unit_name"))}"></div>
    <div><label>Unit grams</label><input id="ug" type="number" inputmode="decimal" value="${v("unit_grams")}"></div></div>
    <label>How the model should picture it (optional, e.g. "chicken breast pieces marinated in red masala")</label><input id="fpr" value="${esc(v("prompt"))}">
    <div class="row" style="margin-top:12px"><button id="fs" style="flex:1">Save food</button><button class="ghost" id="fc2">Cancel</button></div><div class="warn" id="fe"></div></div>`;
  $("#fc2", el).onclick = () => { el.innerHTML = ""; };
  $("#fs", el).onclick = async () => {
    const data = { name: $("#fn", el).value.trim(), kcal: $("#fk", el).value, protein: $("#fp", el).value,
      carbs: $("#fc", el).value, fat: $("#ff", el).value, unit_name: $("#un", el).value.trim() || null, unit_grams: $("#ug", el).value };
    const err = validateFood(data);
    if (err) { $("#fe", el).textContent = err; return; }
    if (foods.some(f => f.name.toLowerCase() === data.name.toLowerCase() && (!food || f.id !== food.id))) { $("#fe", el).textContent = "You already have a food with that name"; return; }
    const rec = { ...(food || { source: "custom", archived: 0 }), name: data.name,
      kcal: num(data.kcal), protein: num(data.protein), carbs: num(data.carbs), fat: num(data.fat),
      unit_name: data.unit_name, unit_grams: data.unit_name ? num(data.unit_grams) : null,
      prompt: $("#fpr", el).value.trim() || undefined };
    const id = await store.put("foods", rec);
    done({ ...rec, id: rec.id ?? id });
  };
}

/* ---------- food info ---------- */
function openFoodInfo(food, { onEdit, onDelete }) {
  const uses = meals.filter(m => m.items.some(i => i.food_id === food.id));
  const typical = typicalGrams(food, meals);
  const at = g => { const x = macrosFor(food, g); return `${Math.round(x.kcal)} kcal · P ${Math.round(x.protein)} · C ${Math.round(x.carbs)} · F ${Math.round(x.fat)}`; };
  const e = { p: food.protein * 4, c: food.carbs * 4, f: food.fat * 9 }, total = e.p + e.c + e.f;
  const share = k => total ? Math.round(e[k] / total * 100) : 0;
  const last = uses.length ? uses[uses.length - 1].log_date : null;
  const sheet = document.createElement("div"); sheet.className = "sheet";
  sheet.innerHTML = `<div>
    <div class="row spread"><b class="calt" style="min-width:0">${esc(food.name)}</b><button class="ghost small" id="fi-x">Close</button></div>
    <div class="big" style="margin-top:10px">${food.kcal}<span class="muted" style="font-size:16px"> kcal per 100 g</span></div>
    ${total ? `<div class="split"><i style="width:${share("p")}%;background:var(--leaf)"></i><i style="width:${share("c")}%;background:var(--wheat)"></i><i style="width:${share("f")}%;background:var(--sky)"></i></div>
    <div class="legend"><span><u style="background:var(--leaf)"></u>Protein ${food.protein} g · ${share("p")}%</span>
      <span><u style="background:var(--wheat)"></u>Carbs ${food.carbs} g · ${share("c")}%</span>
      <span><u style="background:var(--sky)"></u>Fat ${food.fat} g · ${share("f")}%</span></div>
    <p class="note">Percentages are the share of the calories that come from each macro.</p>` : ""}
    <div class="irows">
      ${food.unit_name ? `<div><span class="muted">1 ${esc(food.unit_name)} (${food.unit_grams} g)</span><b>${at(food.unit_grams)}</b></div>` : ""}
      <div><span class="muted">${uses.length ? "Your usual portion" : "Starting portion"} (${typical} g)</span><b>${at(typical)}</b></div>
      <div><span class="muted">Logged</span><b>${uses.length ? `${uses.length} time${uses.length === 1 ? "" : "s"}, last ${esc(niceDate(last))}` : "Not yet"}</b></div>
    </div>
    <p class="note">${food.source === "seed" ? "A starting value from a general table, so check it against your packet or IFCT and edit it if it's off." : "You added this food."}</p>
    <div class="row" style="margin-top:10px"><button id="fi-e" class="ghost" style="flex:1">Edit</button><button id="fi-d" class="ghost danger" style="flex:1">Delete</button></div></div>`;
  document.body.appendChild(sheet);
  const close = () => sheet.remove();
  sheet.onclick = ev => { if (ev.target === sheet) close(); };
  $("#fi-x", sheet).onclick = close;
  $("#fi-e", sheet).onclick = () => { close(); onEdit(food); };
  $("#fi-d", sheet).onclick = async () => { if (await onDelete(food.id)) close(); };
}

/* ---------- foods ---------- */
function viewFoods(app) {
  app.innerHTML = `<div class="row spread"><h1>Foods</h1><button class="small" id="nf">+ New</button></div>
    <input id="q" placeholder="Search" style="margin:12px 0"><div id="form"></div><div id="list"></div>`;
  const load = () => {
    const q = $("#q").value.trim().toLowerCase();
    const list = foods.filter(f => f.name.toLowerCase().includes(q));
    $("#list").innerHTML = list.map(f => `<div class="card tap" data-info="${f.id}"><div class="row spread"><b>${esc(f.name)}</b>
      <span><button class="small ghost" data-e="${f.id}">Edit</button> <button class="danger" data-a="${f.id}">Delete</button></span></div>
      <div class="muted">${f.kcal} kcal · P ${f.protein} · C ${f.carbs} · F ${f.fat} per 100g${f.unit_name ? ` · 1 ${esc(f.unit_name)} = ${f.unit_grams}g` : ""}</div></div>`).join("");
    const edit = f => { foodForm($("#form"), f, async () => { await reload(); $("#form").innerHTML = ""; load(); }); window.scrollTo({ top: 0, behavior: "smooth" }); };
    const remove = async id => {
      if (!confirm("Delete this food? Meals you already logged keep it.")) return false;
      await store.del("foods", id); await reload(); load(); return true;
    };
    app.querySelectorAll("[data-info]").forEach(c => c.onclick = e => {
      if (e.target.closest("button")) return;
      openFoodInfo(foods.find(f => f.id === +c.dataset.info), { onEdit: edit, onDelete: remove });
    });
    app.querySelectorAll("[data-e]").forEach(b => b.onclick = () => edit(foods.find(f => f.id === +b.dataset.e)));
    app.querySelectorAll("[data-a]").forEach(b => b.onclick = () => remove(+b.dataset.a));
  };
  $("#q").oninput = load;
  $("#nf").onclick = () => foodForm($("#form"), null, async () => { await reload(); $("#form").innerHTML = ""; load(); });
  load();
}

/* ---------- me ---------- */
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) navigator.serviceWorker.register("sw.js").catch(() => {});
store.seedFoods().then(show);
