// the first-run questions. also reused (pre-filled) when someone edits their profile.
import { $, esc, ICON } from "./ui.js";
import { ACTIVITY, GOALS, PACE_NAME, makeTargets, validateProfile, cmToFtIn, ftInToCm, kgToLb, lbToKg } from "./plan.js";
import { num } from "./logic.js";

const FLOW = ["welcome", "name", "about", "body", "activity", "goal", "targets", "adaptive"];

const SEX = [["male", "Male"], ["female", "Female"], ["other", "Prefer not to say"]];

function fresh(existing) {
  if (!existing) return { units: "metric", sex: null, activity: null, goal: null, pace: null, adaptive: null, touched: false };
  const { ft, inch } = cmToFtIn(existing.profile.heightCm);
  return { ...existing.profile, name: existing.profile.name, age: existing.age, adaptive: existing.profile.adaptive || null,
    hIn: String(existing.profile.heightCm), wIn: String(existing.weightKg), ft: String(ft), inch: String(inch),
    units: existing.profile.units || "metric", touched: true, targets: { ...existing.targets },
    goalWeightIn: existing.profile.goalWeightKg ? String(existing.profile.goalWeightKg) : "" };
}

// metric values from whatever is typed in the body step
function bodyMetric(d) {
  if (d.units === "imperial") return { heightCm: ftInToCm(num(d.ft) || 0, num(d.inch) || 0), weightKg: lbToKg(num(d.wIn) || 0) };
  return { heightCm: num(d.hIn), weightKg: num(d.wIn) };
}

function asPlanInput(d) {
  const b = bodyMetric(d);
  return { sex: d.sex, age: num(d.age), heightCm: b.heightCm, weightKg: b.weightKg, activity: d.activity, goal: d.goal, pace: d.pace };
}

function check(step, d) {
  if (step === "name") {
    const n = String(d.name || "").trim();
    if (!n) return "Tell me what to call you";
    if (n.length > 30) return "That name is a bit long";
  }
  if (step === "about") {
    if (!d.sex) return "Pick one option";
    const a = num(d.age);
    if (a === null || a < 13 || a > 100) return "Age should be between 13 and 100";
  }
  if (step === "body") {
    const b = bodyMetric(d);
    if (!(b.heightCm >= 100 && b.heightCm <= 250)) return "Check your height, it should be between 100 and 250 cm";
    if (!(b.weightKg >= 25 && b.weightKg <= 300)) return "Check your weight, it should be between 25 and 300 kg";
  }
  if (step === "activity" && !d.activity) return "Pick the one that fits best";
  if (step === "goal") {
    if (!d.goal) return "Pick a goal";
    if (d.goal === "lose" && num(d.age) < 18) return "Weight loss targets aren't offered under 18";
    const gw = num(d.goalWeightIn), cur = bodyMetric(d).weightKg;
    if (d.goalWeightIn && d.goal !== "maintain") {
      const kg = d.units === "imperial" ? lbToKg(gw) : gw;
      if (!(kg >= 25 && kg <= 300)) return "Check your goal weight";
      if (d.goal === "lose" && kg >= cur) return "Your goal weight should be lower than your current weight";
      if (d.goal === "gain" && kg <= cur) return "Your goal weight should be higher than your current weight";
    }
  }
  if (step === "targets") {
    const t = d.targets || {};
    if (!(t.kcal >= 800 && t.kcal <= 6000)) return "Calories should be between 800 and 6000";
    for (const k of ["protein", "carbs", "fat"]) if (!(t[k] >= 0 && t[k] <= 800)) return "Check the " + k + " number";
  }
  if (step === "adaptive" && !d.adaptive) return "Pick one. You can change it later in the Me tab";
  return null;
}

let unsubAcct = null;
export function renderOnboarding(app, { existing = null, onFinish, onCancel, onRestore, onSignIn = null, account = null }) {
  const edit = !!existing;
  const flow = edit ? FLOW.filter(s => s !== "welcome") : FLOW;
  const d = fresh(existing);
  let i = 0, autoAdvanced = false;

  const goalText = () => d.goal === "lose" ? `lose about ${d.pace} kg a week` : d.goal === "gain" ? `gain about ${d.pace} kg a week` : "stay at your weight";

  function computeTargets() {
    const t = makeTargets(asPlanInput(d));
    d.targets = { kcal: t.kcal, protein: t.protein, carbs: t.carbs, fat: t.fat };
    d.calc = t;
  }

  function opt(value, current, label, hint, extra = "") {
    return `<button class="opt${value === current ? " on" : ""}${extra}" data-v="${esc(value)}"><b>${esc(label)}</b>${hint ? `<span class="muted">${esc(hint)}</span>` : ""}</button>`;
  }

  function body(step) {
    if (step === "welcome") return `<div class="obhero">
        <img src="icon-192.png" alt="" class="logo-lg">
        <h1>Macro Tracker</h1>
        <p class="lead">Snap your meal, check the guess, see your macros. A few quick questions first so your targets fit you. It takes about a minute.</p>
        <p class="muted">Your data stays on this phone unless you sign in to back it up. No account needed to start.</p></div>`;
    if (step === "name") return `<h2 class="q">What should we call you?</h2>
      <input id="f-name" placeholder="Your first name" maxlength="30" value="${esc(d.name || "")}" autocomplete="given-name">`;
    if (step === "about") return `<h2 class="q">A bit about you</h2>
      <p class="muted">Used only to estimate how many calories you burn. It stays on this phone.</p>
      <label>Sex</label><div class="opts row3" id="o-sex">${SEX.map(([v, l]) => opt(v, d.sex, l, "")).join("")}</div>
      <label>Age</label><input id="f-age" type="number" inputmode="numeric" placeholder="Years" value="${esc(d.age ?? "")}">
      <div class="note" id="agenote">${num(d.age) !== null && num(d.age) < 18 ? "Under 18, the app only offers maintaining or building. For weight loss, please talk to a doctor or dietitian." : ""}</div>`;
    if (step === "body") {
      const imp = d.units === "imperial";
      return `<h2 class="q">Your height and weight</h2>
        <div class="seg two" id="o-units"><button class="${!imp ? "on" : ""}" data-v="metric">cm / kg</button><button class="${imp ? "on" : ""}" data-v="imperial">ft / lb</button></div>
        <label>Height</label>
        ${imp ? `<div class="row"><input id="f-ft" type="number" inputmode="numeric" placeholder="ft" value="${esc(d.ft ?? "")}"><input id="f-in" type="number" inputmode="numeric" placeholder="in" value="${esc(d.inch ?? "")}"></div>`
          : `<input id="f-h" type="number" inputmode="decimal" placeholder="cm" value="${esc(d.hIn ?? "")}">`}
        <label>Weight</label>
        <input id="f-w" type="number" inputmode="decimal" placeholder="${imp ? "lb" : "kg"}" value="${esc(d.wIn ?? "")}">`;
    }
    if (step === "activity") return `<h2 class="q">How active are you?</h2>
      <p class="muted">Think of a normal week, not your best one.</p>
      <div class="opts" id="o-act">${Object.entries(ACTIVITY).map(([k, a]) => opt(k, d.activity, a.label, a.hint)).join("")}</div>`;
    if (step === "goal") {
      const minor = num(d.age) < 18, imp = d.units === "imperial";
      const g = GOALS[d.goal];
      return `<h2 class="q">What's your goal?</h2>
        <div class="opts" id="o-goal">${Object.entries(GOALS).map(([k, x]) => (k === "lose" && minor) ? "" : opt(k, d.goal, x.label, x.hint)).join("")}</div>
        ${g && g.paces.length ? `<label>How quickly?</label><div class="opts" id="o-pace">${g.paces.map(p => opt(String(p), String(d.pace), `${PACE_NAME[p] || ""} · ${imp ? kgToLb(p) + " lb" : p + " kg"} a week`, p === g.def ? "Recommended" : "")).join("")}</div>
        <label>Goal weight, optional (${imp ? "lb" : "kg"})</label><input id="f-gw" type="number" inputmode="decimal" placeholder="Leave blank if unsure" value="${esc(d.goalWeightIn ?? "")}">` : ""}`;
    }
    if (step === "targets") {
      const t = d.targets, c = d.calc;
      const sum = Math.round((t.protein || 0) * 4 + (t.carbs || 0) * 4 + (t.fat || 0) * 9);
      return `<h2 class="q">Your daily targets</h2>
        ${c ? `<p class="muted">You burn about <b>${c.bmr}</b> kcal at rest and about <b>${c.tdee}</b> on an average day. To ${esc(goalText())}, these are the daily targets we suggest.</p>` : ""}
        <div class="card tgt">
          <label>Calories</label><input id="t-kcal" type="number" inputmode="numeric" value="${esc(t.kcal)}">
          <div class="row"><div><label>Protein (g)</label><input id="t-p" type="number" inputmode="numeric" value="${esc(t.protein)}"></div>
            <div><label>Carbs (g)</label><input id="t-c" type="number" inputmode="numeric" value="${esc(t.carbs)}"></div>
            <div><label>Fat (g)</label><input id="t-f" type="number" inputmode="numeric" value="${esc(t.fat)}"></div></div>
          <div class="note" id="tsum">Macros add up to ${sum} kcal.</div></div>
        <p class="muted">Following a coach or dietitian? Type in their numbers instead, they're yours to change.</p>
        ${c && c.notes.length ? `<p class="warn">${esc(c.notes.join(" "))}</p>` : ""}
        <p class="note">These are estimates, not medical advice. If you have a health condition, are pregnant, or have a history of disordered eating, check with a doctor or dietitian first.</p>
        <div class="row" style="margin-top:6px"><button class="ghost small" id="t-reset">Reset to calculated</button>${edit ? '<button class="ghost small" id="t-keep">Keep my current targets</button>' : ""}</div>`;
    }
    if (step === "adaptive") return `<h2 class="q">Keep your targets up to date?</h2>
      <p class="muted">Everyone burns calories a little differently. Turn this on and once a week the app looks at what you ate and how your weight changed, then suggests a small tweak to your targets.</p>
      <div class="opts" id="o-ad">
        ${opt("suggest", d.adaptive, "Yes, suggest changes", "A weekly check-in. Nothing changes unless you tap Apply.")}
        ${opt("off", d.adaptive, "No, keep them fixed", "Your targets stay as you set them. You can turn this on any time from the Me tab at the bottom.")}
      </div>
      <p class="note">It works best if you weigh yourself once a week and log most of your meals.</p>`;
    return "";
  }

  function render() {
    const step = flow[i], last = i === flow.length - 1;
    if (step === "targets" && (!d.touched || !d.targets)) computeTargets();
    else if (step === "targets" && !d.calc) d.calc = makeTargets(asPlanInput(d));
    const welcome = step === "welcome";
    app.innerHTML = `<div class="ob">
      ${welcome ? "" : `<div class="obtop"><button class="icb" id="obback" aria-label="Back">${ICON.left}</button><div class="obprog"><i style="width:${Math.round((i) / (flow.length - 1) * 100)}%"></i></div></div>`}
      ${welcome ? `<div class="obbody">${body(step)}<div class="welcomeacts"><div class="acctnote" id="obacct" hidden></div><div class="warn" id="oberr"></div>
        <button class="bigbtn" id="obnext">Get started</button>
        ${onSignIn ? '<button class="bigbtn outline" id="obsignin">Sign in or sign up</button>' : ""}<button class="linkbtn" id="obrestore">Restore from a backup</button><input type="file" id="obfile" accept="application/json" style="display:none"></div></div>`
      : `<div class="obbody">${body(step)}</div>
      <div class="obfoot"><div class="warn" id="oberr"></div>
        <button class="bigbtn" id="obnext">${last ? (edit ? "Save changes" : "Finish") : "Continue"}</button>
        ${edit && i === 0 ? `<button class="linkbtn" id="obcancel">Cancel</button>` : ""}
      </div>`}</div>`;
    wire(step);
    if (unsubAcct) { unsubAcct(); unsubAcct = null; }
    if (welcome && account) {
      const note = $("#obacct"), btn = $("#obsignin");
      const paint = st => {
        if (!document.body.contains(note)) return;
        note.hidden = !st.user && !st.error;
        if (btn) btn.hidden = !!st.user;
        const first = st.user && (st.user.name || "").trim().split(/\s+/)[0];
        if (st.user && st.last && !st.busy && !st.error && !autoAdvanced && !edit) {
          // a new account: nothing saved yet, so carry on with setup, name filled in from Google
          autoAdvanced = true;
          note.textContent = `Welcome${first ? ", " + first : ""}. Let's set up your profile.`;
          setTimeout(() => { if (document.body.contains(note)) { if (first && !d.name) d.name = first; i = flow.indexOf("name"); render(); } }, 700);
          return;
        }
        note.textContent = st.user
          ? (st.error ? `Signed in as ${st.user.email}, but syncing failed: ${st.error}`
            : st.busy || !st.last ? `Signed in as ${st.user.email}. Looking for your saved data…`
            : `Signed in as ${st.user.email}. Setting things up…`)
          : (st.error || "");
      };
      paint(account.get()); unsubAcct = account.subscribe(paint);
    }
    const first = app.querySelector("input:not([type=file])"); if (first && (step === "name" || step === "body")) first.focus({ preventScroll: true });
  }

  function wire(step) {
    const on = (sel, fn) => { const el = app.querySelector(sel); if (el) el.oninput = fn; };
    const pick = (sel, fn) => app.querySelectorAll(sel + " .opt, " + sel + " button").forEach(b => b.onclick = () => { fn(b.dataset.v); render(); });

    on("#f-name", e => d.name = e.target.value);
    on("#f-age", e => { d.age = e.target.value; d.touched = false; const a = num(d.age), n = $("#agenote");
      if (n) n.textContent = a !== null && a < 18 ? "Under 18, the app only offers maintaining or building. For weight loss, please talk to a doctor or dietitian." : ""; });
    pick("#o-sex", v => { d.sex = v; d.touched = false; });
    on("#f-h", e => { d.hIn = e.target.value; d.touched = false; }); on("#f-ft", e => { d.ft = e.target.value; d.touched = false; });
    on("#f-in", e => { d.inch = e.target.value; d.touched = false; }); on("#f-w", e => { d.wIn = e.target.value; d.touched = false; });
    if (app.querySelector("#o-units")) app.querySelectorAll("#o-units button").forEach(b => b.onclick = () => {
      const to = b.dataset.v; if (to === d.units) return;
      const m = bodyMetric(d);
      if (to === "imperial") {
        const x = cmToFtIn(m.heightCm || 0); d.ft = m.heightCm ? String(x.ft) : ""; d.inch = m.heightCm ? String(x.inch) : "";
        d.wIn = m.weightKg ? String(kgToLb(m.weightKg)) : ""; d.keep = { cm: m.heightCm, ft: d.ft, inch: d.inch, kg: m.weightKg, lb: d.wIn };
      } else {
        // if nothing was retyped, go back to the exact numbers instead of the rounded ones
        const k = d.keep, same = k && k.ft === d.ft && k.inch === d.inch;
        d.hIn = same ? String(k.cm) : (m.heightCm ? String(m.heightCm) : "");
        d.wIn = k && k.lb === d.wIn ? String(k.kg) : (m.weightKg ? String(m.weightKg) : "");
      }
      if (d.goalWeightIn) { const gw = num(d.goalWeightIn); d.goalWeightIn = to === "imperial" ? String(kgToLb(gw)) : String(lbToKg(gw)); }
      d.units = to; render();
    });
    pick("#o-act", v => { d.activity = v; d.touched = false; });
    pick("#o-goal", v => { d.goal = v; d.pace = GOALS[v].paces.length ? GOALS[v].def : 0; d.touched = false; d.goalWeightIn = ""; });
    pick("#o-pace", v => { d.pace = Number(v); d.touched = false; });
    on("#f-gw", e => d.goalWeightIn = e.target.value);
    pick("#o-ad", v => d.adaptive = v);

    if (step === "targets") {
      const upd = () => { const t = d.targets; d.touched = true;
        t.kcal = num($("#t-kcal").value) ?? 0; t.protein = num($("#t-p").value) ?? 0; t.carbs = num($("#t-c").value) ?? 0; t.fat = num($("#t-f").value) ?? 0;
        $("#tsum").textContent = `Macros add up to ${Math.round(t.protein * 4 + t.carbs * 4 + t.fat * 9)} kcal.`; };
      ["#t-kcal", "#t-p", "#t-c", "#t-f"].forEach(s => on(s, upd));
      $("#t-reset").onclick = () => { d.touched = false; render(); };
      const keep = $("#t-keep"); if (keep) keep.onclick = () => { d.targets = { ...existing.targets }; d.touched = true; i++; render(); };
    }

    const back = $("#obback"); if (back) back.onclick = () => { if (i === 0) return onCancel && onCancel(); i--; render(); };
    const cancel = $("#obcancel"); if (cancel) cancel.onclick = () => onCancel && onCancel();
    const si = $("#obsignin"); if (si) si.onclick = () => onSignIn();
    const rs = $("#obrestore"), file = $("#obfile");
    if (rs) { rs.onclick = () => file.click(); file.onchange = async e => { const f = e.target.files[0]; if (f) onRestore && onRestore(f); }; }
    $("#obnext").onclick = () => {
      const err = check(step, d);
      if (err) { $("#oberr").textContent = err; return; }
      if (i < flow.length - 1) { i++; render(); window.scrollTo(0, 0); return; }
      finish();
    };
  }

  function finish() {
    const p = asPlanInput(d);
    const profile = {
      name: d.name.trim(), sex: d.sex, birthYear: new Date().getFullYear() - p.age, heightCm: p.heightCm,
      activity: d.activity, goal: d.goal, pace: d.pace || 0, units: d.units, adaptive: d.adaptive,
      goalWeightKg: d.goalWeightIn ? (d.units === "imperial" ? lbToKg(num(d.goalWeightIn)) : num(d.goalWeightIn)) : null,
      createdAt: existing ? existing.profile.createdAt : new Date().toISOString(),
    };
    const err = validateProfile({ ...p, name: profile.name });
    if (err) { $("#oberr").textContent = err; return; }
    onFinish({ profile, weightKg: p.weightKg, targets: { kcal: Math.round(d.targets.kcal), protein: Math.round(d.targets.protein), carbs: Math.round(d.targets.carbs), fat: Math.round(d.targets.fat) } });
  }

  render();
}

