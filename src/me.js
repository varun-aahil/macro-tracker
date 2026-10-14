// the Me tab: profile, the week so far, weight, the optional weekly check-in, then the older settings.
import * as store from "./store.js";
import * as cloud from "./cloud.js";
import { $, esc, today, niceDate, shiftDay, parseISO, toast, r1 } from "./ui.js";
import { fiberTarget, GOALS, PACE_NAME, ageFrom, tdee, weeklySummary, streak, weightTrend, suggestAdjustment,
  kgToLb, lbToKg, addDays, daysBetween, macrosFromKcal } from "./plan.js";
import { stats, num } from "./logic.js";
import { evaluate } from "./learner.js";

export const planInput = (profile, weightKg) => ({
  sex: profile.sex, age: ageFrom(profile.birthYear), heightCm: profile.heightCm, weightKg,
  activity: profile.activity, goal: profile.goal, pace: profile.pace,
});

export const latestWeight = (weights, fallback) => (weights.length ? weights[weights.length - 1].kg : fallback);

const fmtKg = (kg, units) => (units === "imperial" ? `${kgToLb(kg)} lb` : `${r1(kg)} kg`);
const sign = n => (n > 0 ? "+" : n < 0 ? "−" : "");
const unitWord = units => (units === "imperial" ? "lb" : "kg");
const inUnits = (kg, units) => (units === "imperial" ? kgToLb(kg) : r1(kg));

// where the weekly check-in stands right now
export function getCheckin({ profile, targets, meals, weights, adapt, todayISO }) {
  if (!profile || profile.adaptive !== "suggest") return { state: "off" };
  const a = adapt || {};
  if (a.snoozeUntil && a.snoozeUntil > todayISO) return { state: "wait", next: a.snoozeUntil };
  if (a.lastCheck && daysBetween(a.lastCheck, todayISO) < 7) return { state: "wait", next: addDays(a.lastCheck, 7) };
  const r = suggestAdjustment({ profile: planInput(profile, latestWeight(weights, 70)), targets, meals, weights, today: todayISO });
  return { state: r.status, ...r };
}

// ---- tiny charts, drawn as svg ----
function barChart(days, target) {
  const W = 300, H = 120, pad = 18, bw = 26, gap = (W - bw * days.length) / (days.length + 1);
  const max = Math.max(target * 1.25, ...days.map(d => d.kcal), 1);
  const y = v => H - pad - (v / max) * (H - pad - 8);
  const names = ["S", "M", "T", "W", "T", "F", "S"];
  const bars = days.map((d, i) => {
    const x = gap + i * (bw + gap), top = y(d.kcal);
    const over = d.logged && d.kcal > target * 1.1;
    const fill = !d.logged ? "var(--line)" : over ? "var(--wheat)" : "var(--chili)";
    return `<g class="barhit" data-i="${i}"><rect class="hit" x="${x - gap / 2}" y="0" width="${bw + gap}" height="${H}" style="fill:transparent"/><rect class="sel" x="${x - 3}" y="2" width="${bw + 6}" height="${H - 4}" rx="9" style="fill:var(--line);opacity:0"/><rect x="${x}" y="${d.logged ? top : H - pad - 3}" width="${bw}" height="${d.logged ? H - pad - top : 3}" rx="6" style="fill:${fill}"/>
      <text x="${x + bw / 2}" y="${H - 4}" text-anchor="middle" style="fill:var(--muted);font-size:11px">${names[parseISO(d.date).getDay()]}</text></g>`;
  }).join("");
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Calories for the last 7 days">
    ${bars}<line x1="0" x2="${W}" y1="${y(target)}" y2="${y(target)}" style="stroke:var(--ink);stroke-dasharray:4 4;opacity:.45;pointer-events:none"/></svg>`;
}

function lineChart(points, units) {
  const W = 300, H = 110, pl = 8, pr = 8, pt = 12, pb = 18;
  const ys = points.map(p => p.kg), lo = Math.min(...ys), hi = Math.max(...ys), span = Math.max(hi - lo, 0.6);
  const t0 = parseISO(points[0].date).getTime(), t1 = parseISO(points[points.length - 1].date).getTime(), dt = Math.max(t1 - t0, 1);
  const X = p => pl + ((parseISO(p.date).getTime() - t0) / dt) * (W - pl - pr);
  const Y = p => pt + (1 - (p.kg - lo + (span - (hi - lo)) / 2) / span) * (H - pt - pb);
  const path = points.map((p, i) => `${i ? "L" : "M"}${X(p).toFixed(1)} ${Y(p).toFixed(1)}`).join(" ");
  const dots = points.map(p => `<circle cx="${X(p).toFixed(1)}" cy="${Y(p).toFixed(1)}" r="3.5" style="fill:var(--chili)"/>`).join("");
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Weight over time">
    <path d="${path}" style="fill:none;stroke:var(--chili);stroke-width:2.2;stroke-linejoin:round;stroke-linecap:round"/>${dots}
    <text x="${pl}" y="${H - 3}" style="fill:var(--muted);font-size:11px">${esc(niceDate(points[0].date))}</text>
    <text x="${W - pr}" y="${H - 3}" text-anchor="end" style="fill:var(--muted);font-size:11px">${esc(niceDate(points[points.length - 1].date))}</text></svg>`;
}

const macroBar = (label, val, target, color) => {
  const pct = Math.min(100, target ? (val / target) * 100 : 0);
  return `<div class="mrow"><span class="muted">${label}</span><div class="bar"><i style="width:${pct}%;background:${color}"></i></div><b>${val}<span class="muted"> / ${target}g</span></b></div>`;
};

let unsubAcct = null;
export function renderMe(app, ctx) {
  const { profile, weights, targets, meals, foods, adapt, avatar } = ctx;
  const units = profile.units || "metric", t0 = today();
  const wNow = latestWeight(weights, null);
  const firstW = weights.length ? weights[0].kg : wNow;
  const plan = planInput(profile, wNow);
  const week = weeklySummary(meals, t0, targets.kcal);
  const trend = weightTrend(weights, t0, 28);
  const goal = GOALS[profile.goal];
  const checkin = getCheckin({ profile, targets, meals, weights, adapt, todayISO: t0 });
  const s = stats(meals), ev = evaluate(meals, foods);
  const pct = x => Math.round(x * 100) + "%";
  const since = new Date(profile.createdAt).toLocaleDateString([], { day: "numeric", month: "short" });
  const goalLine = [goal.label, profile.pace ? `${PACE_NAME[profile.pace] || ""} ${inUnits(profile.pace, units)} ${unitWord(units)}/week`.trim() : null, `since ${since}`].filter(Boolean).join(" · ");
  const change = wNow !== null && firstW !== null ? r1(wNow - firstW) : null;
  const toGo = profile.goalWeightKg && wNow !== null ? r1(profile.goalWeightKg - wNow) : null;

  // ---- check-in card ----
  let checkinHtml;
  if (checkin.state === "off") {
    checkinHtml = `<p class="muted">Off. Your targets stay exactly as you set them.</p>
      <button class="ghost" id="ad-on" style="width:100%">Turn on weekly check-ins</button>`;
  } else {
    const head = `<p class="muted">On. Once a week I compare what you eat with how your weight moves. You approve every change.</p>`;
    let body = "";
    if (checkin.state === "wait") body = `<p>Next check-in on <b>${esc(niceDate(checkin.next))}</b>.</p>`;
    else if (checkin.state === "not_enough_data") {
      const p = checkin.progress;
      const row = (label, have, need) => `<div class="mrow"><span class="muted">${label}</span><div class="bar"><i style="width:${Math.min(100, have / need * 100)}%;background:var(--leaf)"></i></div><b>${Math.min(have, need)}<span class="muted"> / ${need}</span></b></div>`;
      body = `<p>Not enough to go on yet. I look at the last two weeks.</p>
        ${row("Days logged", p.usableDays, p.needDays)}${row("Weigh-ins", p.weighIns, p.needWeighIns)}${row("Days between first and last weigh-in", p.spanDays, p.needSpan)}
        <p class="note">A day counts when you logged at least half your calorie target.</p>`;
    } else if (checkin.state === "on_track") {
      const f = checkin.facts;
      body = `<p><b>You're on track.</b> You averaged ${f.avgIntake} kcal a day and your weight moved ${sign(f.perWeek)}${Math.abs(f.perWeek)} kg a week. No change needed.</p>`;
    } else if (checkin.state === "suggest") {
      const f = checkin.facts;
      const goalTxt = profile.goal === "maintain" ? "staying level" : `${sign(f.goalRate)}${Math.abs(f.goalRate)} kg a week`;
      body = `<div class="card sug"><div class="muted">Suggested daily target</div>
          <div class="big" style="font-size:34px">${checkin.kcal}<span class="muted" style="font-size:15px"> kcal</span></div>
          <div class="muted">${sign(checkin.change)}${Math.abs(checkin.change)} from now (${targets.kcal}) · P ${checkin.protein} · C ${checkin.carbs} · F ${checkin.fat}</div></div>
        <p>Over ${f.usableDays} logged days you averaged ${f.avgIntake} kcal, and your weight moved ${sign(f.perWeek)}${Math.abs(f.perWeek)} kg a week. Your goal is ${goalTxt}. Your body seems to burn about ${f.estBurn} kcal a day, so we suggest nudging your target.</p>
        <div class="row"><button id="ad-yes" style="flex:1">Apply</button><button class="ghost" id="ad-no">Not now</button></div>
        <p class="note">Small steps only. I never move more than 200 kcal at once.</p>`;
    }
    const last = (adapt && adapt.history && adapt.history.length) ? adapt.history[adapt.history.length - 1] : null;
    checkinHtml = head + body + (last ? `<p class="note">Last change: ${esc(niceDate(last.date))}, ${last.from} → ${last.to} kcal.</p>` : "")
      + `<button class="linkbtn" id="ad-off" style="margin-top:6px">Turn off</button>`;
  }

  // ---- weight list ----
  const recent = [...weights].reverse().slice(0, 5);

  app.innerHTML = `
    <div class="mehead"><button class="avatar" id="avbtn" aria-label="Change profile photo">${avatar ? `<img src="${avatar}" alt="">` : esc((profile.name[0] || "?").toUpperCase())}<span class="avcam">+</span></button>
      <input type="file" id="avfile" accept="image/*" style="display:none">
      <div style="flex:1;min-width:0"><h1 style="white-space:normal">${esc(profile.name)}</h1><div class="muted">${esc(goalLine)}</div></div>
      <button class="small ghost" id="editp">Edit</button></div>

    <div class="tiles">
      <div class="tile"><span class="muted">Weight</span><b>${wNow !== null ? esc(fmtKg(wNow, units)) : "–"}</b>
        <span class="muted">${change !== null && weights.length > 1 ? `${sign(change)}${Math.abs(inUnits(Math.abs(change), units))} ${unitWord(units)} since start` : "Log it below"}</span></div>
      <div class="tile"><span class="muted">Daily target</span><b>${targets.kcal} kcal</b><span class="muted">P ${targets.protein} · C ${targets.carbs} · F ${targets.fat}</span></div>
      <div class="tile"><span class="muted">Estimated burn</span><b>${wNow !== null ? Math.round(tdee(plan)) : "–"} kcal</b><span class="muted">a day, from a formula</span></div>
      <div class="tile"><span class="muted">Streak</span><b>${streak(meals, t0)} ${streak(meals, t0) === 1 ? "day" : "days"}</b><span class="muted">logged in a row</span></div>
    </div>

    <h2>Last 7 days</h2><div class="card">
      ${week.loggedDays ? `${barChart(week.days, targets.kcal)}
        <div class="row spread" style="margin-top:6px"><div><b>${week.avg.kcal}</b> <span class="muted">kcal average</span></div>
          ${week.prevAvg ? `<span class="muted">${sign(week.avg.kcal - week.prevAvg.kcal) || "±"}${Math.abs(week.avg.kcal - week.prevAvg.kcal)} vs the week before</span>` : ""}</div>
        <div id="daydetail" class="daydetail"></div>
        <div class="muted" style="margin-top:12px">Daily average</div>
        <div class="macros2">${macroBar("Protein", week.avg.protein, targets.protein, "var(--leaf)")}${macroBar("Carbs", week.avg.carbs, targets.carbs, "var(--wheat)")}${macroBar("Fat", week.avg.fat, targets.fat, "var(--sky)")}${macroBar("Fibre", week.avg.fiber, targets.fiber ?? fiberTarget(targets.kcal), "var(--leaf)")}</div>
        <p class="note">${week.loggedDays} of 7 days logged, ${week.onTarget} within 10% of your calories. Averages only count days you logged.</p>`
        : '<p class="muted">Log a meal and your week shows up here.</p>'}</div>

    <h2>Weight</h2><div class="card">
      ${weights.length > 1 ? lineChart(weights.slice(-60), units) : '<p class="muted">Log your weight a few times to see a trend.</p>'}
      ${trend.perWeek !== null && trend.spanDays >= 7 ? `<p>Trend: <b>${sign(trend.perWeek)}${Math.abs(inUnits(Math.abs(trend.perWeek), units))} ${unitWord(units)}</b> a week over the last ${Math.max(1, Math.round(trend.spanDays / 7))} week${trend.spanDays >= 11 ? "s" : ""}.</p>` : ""}
      ${toGo !== null ? `<p class="muted">${Math.abs(inUnits(Math.abs(toGo), units))} ${unitWord(units)} ${toGo === 0 ? "to go. You're there." : (profile.goal === "lose" ? (toGo < 0 ? "to go" : "past your goal") : (toGo > 0 ? "to go" : "past your goal"))}</p>` : ""}
      <div class="row" style="margin-top:8px"><input id="w-in" type="number" inputmode="decimal" placeholder="Today's weight (${unitWord(units)})"><button id="w-add">Log</button></div>
      ${recent.length ? `<div class="wlist">${recent.map(w => `<div class="row spread"><span class="muted">${esc(niceDate(w.date))}</span><span><b>${esc(fmtKg(w.kg, units))}</b> <button class="danger" data-wd="${esc(w.date)}" aria-label="Delete entry">✕</button></span></div>`).join("")}</div>` : ""}</div>

    <h2>Smart check-ins</h2><div class="card">${checkinHtml}</div>

    <h2>Daily targets</h2><div class="card">
      <div class="row"><div><label>kcal</label><input id="tk" type="number" value="${targets.kcal}"></div><div><label>Protein</label><input id="tp" type="number" value="${targets.protein}"></div></div>
      <div class="row"><div><label>Carbs</label><input id="tc" type="number" value="${targets.carbs}"></div><div><label>Fat</label><input id="tf" type="number" value="${targets.fat}"></div></div>
      <button id="ts" style="width:100%;margin-top:12px">Save targets</button>
      <p class="note">To recalculate from your body and goal, tap Edit at the top.</p></div>

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

    ${cloud.available() ? `<h2>Account</h2><div class="card" id="acct"></div>` : ""}

    <h2>Your data</h2><div class="card">
      <p class="muted">${cloud.available() ? "Signed in or not, everything works offline. A backup file is still a good extra copy." : "Everything stays on this device. Browsers can clear site data, so save a backup now and then."}</p>
      <div class="row"><button id="ex" class="ghost" style="flex:1">Save backup</button><button id="im" class="ghost" style="flex:1">Restore</button></div>
      <input type="file" id="imf" accept="application/json" style="display:none">
      <button class="danger" id="wipe" style="margin-top:10px">Delete everything on this device</button></div>`;

  // ---- account ----
  if (unsubAcct) unsubAcct();
  const acct = $("#acct");
  if (acct) {
    const ago = iso => { const m = Math.round((Date.now() - new Date(iso)) / 60000); return m < 1 ? "just now" : m < 60 ? m + " min ago" : Math.round(m / 60) + " h ago"; };
    const paint = st => {
      if (!document.body.contains(acct)) return;
      acct.innerHTML = st.user ? `<div class="row spread"><b>${esc(st.user.email || "Signed in")}</b><span class="muted">${st.busy ? "Syncing…" : st.last ? "Synced " + ago(st.last) : ""}</span></div>
          <p class="muted">Your meals, foods, weights, profile and targets are saved to your account, so a new phone picks up where you left off. Photos stay on this device.</p>
          ${st.error ? `<p class="warn">${esc(st.error)}</p>` : ""}
          <div class="row"><button class="ghost" id="ac-sync" style="flex:1">Sync now</button><button class="ghost" id="ac-out" style="flex:1">Sign out</button></div>
          <button class="danger" id="ac-del" style="margin-top:8px">Delete my cloud data</button>`
        : `<p class="muted">Sign in or sign up with your email to keep your data safe online and use it on another phone. We email you a 6-digit code. Photos are never uploaded.</p>
          <input id="ac-mail" type="email" inputmode="email" autocomplete="email" placeholder="you@example.com">
          <button id="ac-send" style="width:100%;margin-top:8px">Send me a code</button>
          <input id="ac-num" inputmode="numeric" autocomplete="one-time-code" placeholder="Code from the email" hidden style="margin-top:8px">
          <button id="ac-go" style="width:100%;margin-top:8px" hidden>Confirm code</button>
          <p class="muted" id="ac-msg">${st.error ? esc(st.error) : ""}</p>`;
      const b = id => acct.querySelector(id);
      if (b("#ac-send")) {
        const msg = b("#ac-msg"), mail = b("#ac-mail"), num = b("#ac-num"), go = b("#ac-go");
        b("#ac-send").onclick = async () => {
          const e = mail.value.trim(); if (!/^\S+@\S+\.\S+$/.test(e)) { msg.textContent = "Enter a valid email address."; return; }
          msg.textContent = "Sending…";
          try { await cloud.sendCode(e); msg.textContent = "Code sent. Check your inbox (and spam)."; num.hidden = false; go.hidden = false; num.focus(); }
          catch (err) { msg.textContent = "Couldn't send the code: " + (err.message || err); }
        };
        go.onclick = async () => { msg.textContent = "Checking…"; try { await cloud.verifyCode(mail.value.trim(), num.value.replace(/\s+/g, "")); } catch (err) { msg.textContent = "That didn't work: " + (err.message || err); } };
      }
      if (b("#ac-sync")) b("#ac-sync").onclick = async () => { await cloud.sync(); };
      if (b("#ac-out")) b("#ac-out").onclick = async () => { await cloud.signOut(); };
      if (b("#ac-del")) b("#ac-del").onclick = async () => {
        if (!confirm("Delete everything saved to your account? Data on this device stays. This can't be undone.")) return;
        try { await cloud.deleteCloudData(); toast("Cloud data deleted"); } catch (err) { toast(err.message || "Couldn't delete"); }
      };
    };
    paint(cloud.getState());
    unsubAcct = cloud.subscribe(paint);
  }

  // ---- wiring ----
  $("#editp").onclick = () => ctx.editProfile();

  $("#w-add").onclick = async () => {
    const v = num($("#w-in").value);
    const kg = units === "imperial" ? lbToKg(v) : v;
    if (v === null || !(kg >= 25 && kg <= 300)) { toast("Enter a weight between 25 and 300 kg"); return; }
    const next = weights.filter(w => w.date !== t0).concat({ date: t0, kg: r1(kg) }).sort((a, b) => a.date.localeCompare(b.date));
    await store.setSetting("weights", next); toast("Logged"); ctx.refresh();
  };
  // tap a bar to see that day
  const showDay = i => {
    const d = week.days[i]; if (!d) return;
    app.querySelectorAll(".barhit .sel").forEach((r, j) => r.style.opacity = j === i ? 0.9 : 0);
    const box = $("#daydetail"); if (!box) return;
    box.innerHTML = `<div class="row spread"><b>${esc(niceDate(d.date))}</b>${d.logged ? `<b>${Math.round(d.kcal)} kcal</b>` : '<span class="muted">Nothing logged</span>'}</div>
      ${d.logged ? `<div class="muted">${Math.round(d.kcal)} of ${targets.kcal} kcal · P ${Math.round(d.protein)} · C ${Math.round(d.carbs)} · F ${Math.round(d.fat)} · Fibre ${Math.round(d.fiber || 0)}</div>` : ""}`;
  };
  app.querySelectorAll(".barhit").forEach(g => g.onclick = () => showDay(+g.dataset.i));
  if (week.days) showDay(week.days.length - 1);

  // profile photo
  const avf = $("#avfile");
  if (avf) {
    $("#avbtn").onclick = () => {
      if (!avatar) { avf.click(); return; }
      const sheet = document.createElement("div"); sheet.className = "sheet";
      sheet.innerHTML = `<div><b class="calt">Profile photo</b>
        <div class="row" style="margin-top:12px"><button id="av-new" style="flex:1">Choose a new photo</button><button id="av-rm" class="ghost danger" style="flex:1">Remove</button></div>
        <button class="linkbtn" id="av-x" style="margin-top:6px">Cancel</button></div>`;
      document.body.appendChild(sheet);
      sheet.onclick = e => { if (e.target === sheet) sheet.remove(); };
      $("#av-x", sheet).onclick = () => sheet.remove();
      $("#av-new", sheet).onclick = () => { sheet.remove(); avf.click(); };
      $("#av-rm", sheet).onclick = async () => { sheet.remove(); await store.setSetting("avatar", null); ctx.refresh(); };
    };
    avf.onchange = async () => {
      const f = avf.files[0]; if (!f) return;
      try {
        const bmp = await createImageBitmap(f, { imageOrientation: "from-image" });
        const side = Math.min(bmp.width, bmp.height), c = document.createElement("canvas"); c.width = c.height = 256;
        c.getContext("2d").drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, 256, 256);
        await store.setSetting("avatar", c.toDataURL("image/jpeg", 0.85)); ctx.refresh();
      } catch { toast("Couldn't use that photo"); }
    };
  }
  app.querySelectorAll("[data-wd]").forEach(b => b.onclick = async () => {
    if (!confirm("Delete this weight entry?")) return;
    await store.setSetting("weights", weights.filter(w => w.date !== b.dataset.wd)); ctx.refresh();
  });

  const setAdaptive = async mode => { await store.setSetting("profile", { ...profile, adaptive: mode }); ctx.refresh(); };
  const on = $("#ad-on"); if (on) on.onclick = () => setAdaptive("suggest");
  const off = $("#ad-off"); if (off) off.onclick = () => setAdaptive("off");
  const yes = $("#ad-yes");
  if (yes) yes.onclick = async () => {
    const next = { kcal: checkin.kcal, protein: checkin.protein, carbs: checkin.carbs, fat: checkin.fat };
    const hist = ((adapt && adapt.history) || []).concat({ date: t0, from: targets.kcal, to: checkin.kcal });
    await store.setSetting("targets", next);
    await store.setSetting("adapt", { lastCheck: t0, snoozeUntil: null, history: hist.slice(-20) });
    toast("Targets updated"); ctx.refresh();
  };
  const no = $("#ad-no");
  if (no) no.onclick = async () => {
    await store.setSetting("adapt", { ...(adapt || {}), snoozeUntil: addDays(t0, 7) });
    toast("Okay, we'll check again next week"); ctx.refresh();
  };

  $("#ts").onclick = async () => {
    const t = { kcal: num($("#tk").value), protein: num($("#tp").value), carbs: num($("#tc").value), fat: num($("#tf").value) };
    if (Object.values(t).some(v => v === null || v <= 0)) { toast("Enter all four targets"); return; }
    await store.setSetting("targets", t); toast("Saved"); ctx.refresh();
  };
  $("#ex").onclick = async () => {
    const blob = new Blob([await store.exportAll()], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = `macro-tracker-backup-${t0}.json`; a.click();
  };
  $("#im").onclick = () => $("#imf").click();
  $("#imf").onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    if (!confirm("This replaces everything on this device with the backup. Continue?")) return;
    try { await store.importAll(await f.text()); toast("Restored"); ctx.refresh(); } catch (err) { toast(err.message); }
  };
  $("#wipe").onclick = async () => {
    if (!confirm("Delete all meals, foods, weights and your profile from this device? This can't be undone.")) return;
    if (!confirm("Last check: really delete everything?")) return;
    for (const name of ["meals", "foods", "settings"]) await store.clear(name);
    location.reload();
  };
}
