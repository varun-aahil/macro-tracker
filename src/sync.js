// the merge rules for syncing, as plain functions (no network, no database), so they can be tested.
// every food, meal and synced setting has a key and a mod time. the newest change wins.
const EPOCH = "1970-01-01T00:00:00.000Z";
const r4 = n => Math.round(n * 1e4) / 1e4;

export function foodRow(f) {
  const { id, textEmb, textFor, ...data } = f;
  return { kind: "food", key: f.uid, data, mod: f.mod, deleted: false };
}

export function mealRow(m, foodUidById) {
  const { id, photo, ...data } = m;
  data.items = (m.items || []).map(i => ({ ...i, food_uid: foodUidById[i.food_id] || null }));
  if (data.emb) data.emb = data.emb.map(r4);
  return { kind: "meal", key: m.uid, data, mod: m.mod, deleted: false };
}

export const settingRow = (key, value, mod) => ({ kind: "setting", key, data: { value }, mod, deleted: false });
const tombRow = t => ({ kind: t.kind, key: t.key, data: null, mod: t.at, deleted: true });

const unchangedSeed = r => r.kind === "food" && r.data && r.data.source === "seed" && r.mod <= EPOCH;

// local: array of rows (same shape as above) for everything on this device that has a uid
// remote: rows pulled from the server since the last sync (everything, on the first sync)
// tombs: [{kind, key, at}] things deleted on this device
// returns { push: rows to upload, apply: remote rows to write here, remove: [{kind,key}] to delete here }
export function plan({ local, remote, tombs = [], lastSync = null }) {
  const id = r => r.kind + "|" + r.key;
  const L = new Map(local.map(r => [id(r), r]));
  const R = new Map(remote.map(r => [id(r), r]));
  const T = new Map();
  for (const t of tombs) { const k = id(t); if (!T.has(k) || T.get(k).at < t.at) T.set(k, t); }
  const push = [], apply = [], remove = [];

  for (const [k, r] of R) {
    const l = L.get(k), t = T.get(k);
    if (t && t.at >= r.mod) { if (!r.deleted) push.push(tombRow(t)); continue; }
    if (r.deleted) {
      if (!l) continue;
      if (l.mod <= r.mod) remove.push({ kind: r.kind, key: r.key });
      else push.push(l);
      continue;
    }
    if (!l) apply.push(r);
    else if (r.mod > l.mod) apply.push(r);
    else if (l.mod > r.mod) push.push(l);
  }
  for (const [k, l] of L) {
    if (R.has(k) || unchangedSeed(l)) continue;
    if (lastSync === null || l.mod > lastSync) push.push(l);
  }
  for (const [k, t] of T) {
    if (R.has(k)) continue;
    if (lastSync === null || t.at > lastSync) push.push(tombRow(t));
  }
  return { push, apply, remove };
}

// turn a remote meal back into a local record, mapping food uids to this device's food ids. unknown foods are dropped.
export function mealFromRow(row, foodIdByUid, existing) {
  const d = row.data;
  const items = (d.items || []).filter(i => foodIdByUid[i.food_uid] !== undefined)
    .map(({ food_uid, ...i }) => ({ ...i, food_id: foodIdByUid[food_uid] }));
  const rec = { ...d, items, uid: row.key, mod: row.mod };
  if (existing) { rec.id = existing.id; rec.photo = existing.photo || null; if (existing.emb) rec.emb = existing.emb; }
  else rec.photo = null;
  return rec;
}
