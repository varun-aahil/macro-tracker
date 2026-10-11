import * as store from "./store.js";
import * as embed from "./embed.js";
import { rank, pickDraft, buildExamples, typicalGrams, evaluate } from "./learner.js";
import { MEAL_TYPES, DEFAULT_TARGETS, macrosFor, sumMacros, validateFood, num, buildItems,
  applyActual, dayTotals, nextSplit, stats } from "./logic.js";

const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const today = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };

let tab = "today", date = today(), draft = null;
let foods = [], meals = [], targets = DEFAULT_TARGETS;

async function reload() {
  foods = (await store.all("foods")).filter(f => !f.archived).sort((a, b) => a.name.localeCompare(b.name));
  meals = (await store.all("meals")).sort((a, b) => a.created_at.localeCompare(b.created_at));
  targets = await store.getSetting("targets", DEFAULT_TARGETS);
}
const foodMap = () => Object.fromEntries(foods.map(f => [f.id, f]));

function toast(msg) {
  const t = document.createElement("div"); t.className = "toast"; t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), 2600);
}

function renderNav() {
  const tabs = [["today", "Today"], ["add", "Add"], ["foods", "Foods"], ["me", "Me"]];
  $("#nav").innerHTML = tabs.map(([k, l]) => `<button class="${tab === k ? "on" : ""}" data-t="${k}">${l}</button>`).join("");
  $("#nav").querySelectorAll("button").forEach(b => b.onclick = () => { tab = b.dataset.t; draft = null; show(); });
}

async function show() {
  renderNav();
  const app = $("#app");
  try {
    await reload();
    if (tab === "today") viewToday(app);
    else if (tab === "add") draft ? viewReview(app) : viewAdd(app);
    else if (tab === "foods") viewFoods(app);
    else viewMe(app);
  } catch (e) { app.innerHTML = `<div class="card warn">${esc(e.message)}</div>`; }
}

/* ---------- today ---------- */
function barRow(label, val, target, color) {
  const pct = Math.min(100, target ? (val / target) * 100 : 0);
  return `<div><div class="row spread"><span class="muted">${label}</span><span><b>${Math.round(val)}</b><span class="muted"> / ${target}g</span></span></div>
    <div class="bar"><i style="width:${pct}%;background:${color}"></i></div></div>`;
}
function viewToday(app) {
  const day = meals.filter(m => m.log_date === date);
  const t = dayTotals(day), left = Math.round(targets.kcal - t.kcal);
  const urls = [];
  app.innerHTML = `
    <div class="row spread"><h1>Macro Tracker</h1><input type="date" id="dt" value="${date}" style="width:auto"></div>
    <div class="card">
      <div class="big">${Math.round(t.kcal)}<span class="muted" style="font-size:16px"> kcal</span></div>
      <div class="muted">${left >= 0 ? left + " left of " + targets.kcal : (-left) + " over " + targets.kcal}</div>
      <div class="bar"><i style="width:${Math.min(100, t.kcal / targets.kcal * 100)}%;background:var(--chili)"></i></div>
      <div style="display:grid;gap:12px;margin-top:16px">
        ${barRow("Protein", t.protein, targets.protein, "var(--leaf)")}
        ${barRow("Carbs", t.carbs, targets.carbs, "var(--wheat)")}
        ${barRow("Fat", t.fat, targets.fat, "var(--sky)")}
      </div></div>
    ${day.length ? "" : '<p class="muted">Nothing logged yet. Tap Add and take a photo.</p>'}
    ${day.map(m => { const u = m.photo ? URL.createObjectURL(m.photo) : null; if (u) urls.push(u); return `<div class="card meal">
      ${u ? `<img src="${u}" alt="">` : ""}
      <div class="row spread"><b style="text-transform:capitalize">${esc(m.meal_type || "meal")}</b><span>${Math.round(m.totals.kcal)} kcal</span></div>
      <div class="muted">${m.items.map(i => esc(i.food_name) + " " + Math.round(i.grams) + "g").join(" · ")}</div>
      <div class="muted">P ${Math.round(m.totals.protein)} · C ${Math.round(m.totals.carbs)} · F ${Math.round(m.totals.fat)}${m.actual ? " · numbers you entered" : ""}</div>
      <button class="danger" data-del="${m.id}">Delete</button></div>`; }).join("")}`;
  $("#dt").onchange = e => { date = e.target.value || today(); show(); };
  app.querySelectorAll("[data-del]").forEach(b => b.onclick = async () => {
    if (!confirm("Delete this meal?")) return;
    await store.del("meals", +b.dataset.del); show();
  });
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

function viewAdd(app) {
  app.innerHTML = `<h1>Add a meal</h1><p class="muted">Photo from above, whole plate in frame, good light.</p>
    <label class="cam">Take or choose a photo
      <input type="file" accept="image/*" capture="environment" id="file"></label>
    <button class="ghost" id="manual" style="width:100%;margin-top:14px">Log without a photo</button>
    <div id="busy"></div>`;
  $("#manual").onclick = () => { draft = { blob: null, emb: null, items: [], more: [], pred_kcal: null, pred_count: 0 }; show(); };
  $("#file").onchange = async e => {
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
      const fresh = (await store.all("foods")).filter(x => !x.archived);
      const ranked = rank(emb, fresh, buildExamples(meals));
      const picked = pickDraft(ranked);
      const byId = Object.fromEntries(fresh.map(x => [x.id, x]));
      const items = picked.items.map(r => {
        const food = byId[r.food_id], grams = typicalGrams(food, meals);
        return { food_id: food.id, grams, from_pred: true, pred_grams: grams, prob: r.prob };
      });
      const more = picked.more.map(r => ({ food_id: r.food_id, prob: r.prob }));
      const pred = sumMacros(items.map(i => macrosFor(byId[i.food_id], i.grams)));
      draft = { blob, emb, items, more, pred_kcal: pred.kcal, pred_count: items.length };
      show();
    } catch (err) {
      say(`<p class="warn">${esc(err.message || err)}. If this is the first run, check your internet connection and try again.</p>`);
    }
  };
}

/* ---------- review ---------- */
function liveTotals() {
  const fm = foodMap();
  return sumMacros(draft.items.filter(i => fm[i.food_id]).map(i => macrosFor(fm[i.food_id], Number(i.grams) || 0)));
}
function viewReview(app) {
  const d = draft, fm = foodMap(), t = liveTotals();
  const url = d.blob ? URL.createObjectURL(d.blob) : null;
  const hour = new Date().getHours();
  const guess = hour < 11 ? "breakfast" : hour < 16 ? "lunch" : hour < 19 ? "snack" : "dinner";
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
      <label>Meal</label><select id="mt">${MEAL_TYPES.map(m => `<option ${m === guess ? "selected" : ""}>${m}</option>`).join("")}</select></div>
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
      draft = null; tab = "today"; toast("Saved"); show();
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
    <button id="fs" style="width:100%;margin-top:12px">Save food</button><div class="warn" id="fe"></div></div>`;
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

/* ---------- foods ---------- */
function viewFoods(app) {
  app.innerHTML = `<div class="row spread"><h1>Foods</h1><button class="small" id="nf">+ New</button></div>
    <input id="q" placeholder="Search" style="margin:12px 0"><div id="form"></div><div id="list"></div>`;
  const load = () => {
    const q = $("#q").value.trim().toLowerCase();
    const list = foods.filter(f => f.name.toLowerCase().includes(q));
    $("#list").innerHTML = list.map(f => `<div class="card"><div class="row spread"><b>${esc(f.name)}</b>
      <span><button class="small ghost" data-e="${f.id}">Edit</button> <button class="danger" data-a="${f.id}">Hide</button></span></div>
      <div class="muted">${f.kcal} kcal · P ${f.protein} · C ${f.carbs} · F ${f.fat} per 100g${f.unit_name ? ` · 1 ${esc(f.unit_name)} = ${f.unit_grams}g` : ""}</div></div>`).join("");
    app.querySelectorAll("[data-e]").forEach(b => b.onclick = () => foodForm($("#form"), foods.find(f => f.id === +b.dataset.e), async () => { await reload(); $("#form").innerHTML = ""; load(); }));
    app.querySelectorAll("[data-a]").forEach(b => b.onclick = async () => {
      if (!confirm("Hide this food? Past meals keep it.")) return;
      const f = foods.find(x => x.id === +b.dataset.a); await store.put("foods", { ...f, archived: 1 }); await reload(); load();
    });
  };
  $("#q").oninput = load;
  $("#nf").onclick = () => foodForm($("#form"), null, async () => { await reload(); $("#form").innerHTML = ""; load(); });
  load();
}

/* ---------- me ---------- */
function viewMe(app) {
  const s = stats(meals), ev = evaluate(meals, foods);
  const pct = x => Math.round(x * 100) + "%";
  app.innerHTML = `<h1>Me</h1><h2>Daily targets</h2><div class="card">
    <div class="row"><div><label>kcal</label><input id="tk" type="number" value="${targets.kcal}"></div><div><label>Protein</label><input id="tp" type="number" value="${targets.protein}"></div></div>
    <div class="row"><div><label>Carbs</label><input id="tc" type="number" value="${targets.carbs}"></div><div><label>Fat</label><input id="tf" type="number" value="${targets.fat}"></div></div>
    <button id="ts" style="width:100%;margin-top:12px">Save targets</button></div>
    <h2>How wrong is the first guess?</h2><div class="card">
    ${!s.photoMeals ? '<p class="muted">Log a few photo meals and this fills in.</p>' : `
      <p class="muted">${s.photoMeals} photo meals</p>
      <p>Of foods it listed, you kept <b>${pct(s.precision)}</b>. Of foods you ate, it listed <b>${pct(s.recall)}</b>.</p>
      ${s.kcal ? `<p>Calories off by <b>${s.kcal.mae} kcal</b> on average (${s.kcal.mape}%). ${s.kcal.bias < 0 ? "Underestimates" : "Overestimates"} by ${Math.abs(s.kcal.bias)} kcal per meal.</p>` : ""}`}</div>
    <h2>Is it learning?</h2><div class="card">
    ${ev ? `<p class="muted">Tested on ${ev.holdout} meals it never learned from, using ${ev.train} to learn.</p>
      <p>Right food in its top 3: <b>${pct(ev.zeroShot.top3)}</b> at the start, <b>${pct(ev.adaptive.top3)}</b> now.</p>
      <p>Top pick correct: <b>${pct(ev.zeroShot.top1)}</b> at the start, <b>${pct(ev.adaptive.top1)}</b> now.</p>`
      : '<p class="muted">Every 5th photo meal is set aside as a test. Log about 10 photo meals to see this.</p>'}</div>
    <h2>Your data</h2><div class="card">
    <p class="muted">Everything stays on this device. Browsers can clear site data, so save a backup now and then.</p>
    <div class="row"><button id="ex" class="ghost" style="flex:1">Save backup</button><button id="im" class="ghost" style="flex:1">Restore</button></div>
    <input type="file" id="imf" accept="application/json" style="display:none"></div>`;
  $("#ts").onclick = async () => {
    const t = { kcal: num($("#tk").value), protein: num($("#tp").value), carbs: num($("#tc").value), fat: num($("#tf").value) };
    if (Object.values(t).some(v => v === null || v <= 0)) { toast("Enter all four targets"); return; }
    await store.setSetting("targets", t); toast("Saved");
  };
  $("#ex").onclick = async () => {
    const blob = new Blob([await store.exportAll()], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = `macro-tracker-backup-${today()}.json`; a.click();
  };
  $("#im").onclick = () => $("#imf").click();
  $("#imf").onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    if (!confirm("This replaces everything on this device with the backup. Continue?")) return;
    try { await store.importAll(await f.text()); toast("Restored"); show(); } catch (err) { toast(err.message); }
  };
}

if ("serviceWorker" in navigator && location.protocol.startsWith("http")) navigator.serviceWorker.register("sw.js").catch(() => {});
store.seedFoods().then(show);
