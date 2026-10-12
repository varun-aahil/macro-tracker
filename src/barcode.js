// packaged food by barcode. the number is looked up on Open Food Facts (free, community database).
// only the barcode number is sent, nothing else about you.
import { getStream } from "./camera.js";

const ZXING = "https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/+esm";
export const validCode = c => /^\d{8,14}$/.test(String(c || "").trim());

// turn an Open Food Facts product into one of our foods (per 100 g), or null if it has no usable calories
export function parseOFF(json) {
  if (!json || json.status === 0 || !json.product) return null;
  const p = json.product, n = p.nutriments || {};
  let kcal = Number(n["energy-kcal_100g"]);
  if (!Number.isFinite(kcal) && Number.isFinite(Number(n["energy_100g"]))) kcal = Number(n["energy_100g"]) / 4.184;
  if (!Number.isFinite(kcal) || kcal < 0 || kcal > 900) return null;
  const g = k => { const v = Number(n[k + "_100g"]); return Number.isFinite(v) && v >= 0 ? Math.round(v * 10) / 10 : 0; };
  const name = [p.brands && String(p.brands).split(",")[0].trim(), p.product_name].filter(Boolean).join(" ").slice(0, 80);
  if (!name) return null;
  const sq = Number(p.serving_quantity);
  const food = { name, kcal: Math.round(kcal), protein: g("proteins"), carbs: g("carbohydrates"), fat: g("fat"), fiber: g("fiber") };
  if (food.protein + food.carbs + food.fat > 105) return null;
  if (Number.isFinite(sq) && sq > 0 && sq < 2000) { food.unit_name = "serving"; food.unit_grams = Math.round(sq); }
  return food;
}

export async function lookup(code) {
  const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=product_name,brands,nutriments,serving_quantity`;
  const r = await fetch(url);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error("The food database didn't answer. Check your connection.");
  return parseOFF(await r.json());
}

async function makeDetector() {
  if (globalThis.BarcodeDetector) {
    try { const d = new BarcodeDetector({ formats: ["ean_13", "ean_8", "upc_a", "upc_e"] }); return async el => { const r = await d.detect(el); return r[0] ? r[0].rawValue : null; }; } catch {}
  }
  const z = await import(ZXING);
  const reader = new z.MultiFormatReader();
  reader.setHints(new Map([[z.DecodeHintType.POSSIBLE_FORMATS, [z.BarcodeFormat.EAN_13, z.BarcodeFormat.EAN_8, z.BarcodeFormat.UPC_A, z.BarcodeFormat.UPC_E]]]));
  const c = document.createElement("canvas");
  return async el => {
    c.width = el.videoWidth; c.height = el.videoHeight; c.getContext("2d").drawImage(el, 0, 0);
    try { return reader.decode(new z.BinaryBitmap(new z.HybridBinarizer(new z.HTMLCanvasElementLuminanceSource(c)))).getText(); } catch { return null; }
  };
}

// opens a scan screen. resolves with the digits, or null if closed. the number can also be typed.
export function scanBarcode() {
  return new Promise(async resolve => {
    const el = document.createElement("div"); el.className = "camview";
    el.innerHTML = `<video playsinline autoplay muted></video><div class="scanbox"></div>
      <div class="camtop"><button class="camb" id="sc-x" aria-label="Close">✕</button><span class="camhint">Point at the barcode</span><span style="width:44px"></span></div>
      <div class="scanbot"><div class="row"><input id="sc-in" inputmode="numeric" placeholder="or type the number" maxlength="14"><button id="sc-go">Look up</button></div><div class="warn" id="sc-err"></div></div>`;
    document.body.appendChild(el);
    let stream = null, alive = true;
    const done = v => { alive = false; if (stream) stream.getTracks().forEach(t => t.stop()); el.remove(); resolve(v); };
    el.querySelector("#sc-x").onclick = () => done(null);
    el.querySelector("#sc-go").onclick = () => { const v = el.querySelector("#sc-in").value.trim(); validCode(v) ? done(v) : (el.querySelector("#sc-err").textContent = "Barcodes are 8 to 14 digits"); };
    try {
      stream = await getStream("environment");
      const v = el.querySelector("video"); v.srcObject = stream;
      const detect = await makeDetector();
      const tick = async () => {
        if (!alive) return;
        if (v.videoWidth) { try { const code = await detect(v); if (validCode(code)) return done(code); } catch {} }
        setTimeout(tick, 250);
      };
      tick();
    } catch (e) { el.querySelector("#sc-err").textContent = "Camera or scanner isn't available. You can still type the number."; }
  });
}
