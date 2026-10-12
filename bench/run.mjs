// real benchmark: runs the app's own CLIP model and ranking code on labelled Food-101 images.
//   npm i @huggingface/transformers@3.5.1 && node bench/run.mjs [--per-class 40] [--pool 16] [--max-pages 300]
// downloads images from the Hugging Face datasets server, so it needs internet. results go to bench/RESULTS.md and bench/results.json.
import fs from "node:fs";
import { promptFor } from "../src/embed.js";
import { normalize } from "../src/learner.js";
import { fewShotCurve, evaluateSet, toMarkdown } from "./metrics.mjs";

const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i > 0 ? Number(process.argv[i + 1]) : d; };
const PER = arg("per-class", 40), POOL = arg("pool", 16), PAGES = arg("max-pages", 300);
const MODEL = "Xenova/clip-vit-base-patch32", DATASET = "ethz/food101";

const lib = await import("@huggingface/transformers");
const processor = await lib.AutoProcessor.from_pretrained(MODEL);
const tokenizer = await lib.AutoTokenizer.from_pretrained(MODEL);
const vision = await lib.CLIPVisionModelWithProjection.from_pretrained(MODEL, { dtype: "q8" });
const textModel = await lib.CLIPTextModelWithProjection.from_pretrained(MODEL, { dtype: "q8" });
const embedText = async t => normalize(Array.from((await textModel(tokenizer([t], { padding: true, truncation: true }))).text_embeds.data));
const embedImage = async url => normalize(Array.from((await vision(await processor(await lib.RawImage.fromURL(url)))).image_embeds.data));

const foods = JSON.parse(fs.readFileSync(new URL("../foods.json", import.meta.url))).map((f, i) => ({ ...f, id: i + 1 }));
for (const f of foods) f.textEmb = await embedText(promptFor(f));
const idOf = Object.fromEntries(foods.map(f => [f.name, f.id]));
const { map } = JSON.parse(fs.readFileSync(new URL("./classes.json", import.meta.url)));
for (const [c, names] of Object.entries(map)) for (const n of names) if (!idOf[n]) throw new Error(`classes.json: "${n}" (for ${c}) is not in foods.json`);

// walk the validation split, keeping images for the classes we care about
const API = "https://datasets-server.huggingface.co/rows";
const cacheFile = new URL("./cache.json", import.meta.url);
const cache = fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile)) : {};
const got = {};   // class -> [{emb}]
let labels = null;
for (let page = 0; page < PAGES; page++) {
  if (Object.keys(map).every(c => (got[c] || []).length >= PER)) break;
  const r = await (await fetch(`${API}?dataset=${DATASET}&config=default&split=validation&offset=${page * 100}&length=100`)).json();
  labels ||= r.features.find(f => f.name === "label").type.names;
  for (const { row_idx, row } of r.rows) {
    const c = labels[row.label];
    if (!map[c] || (got[c] || []).length >= PER) continue;
    const key = `${DATASET}:${row_idx}`;
    cache[key] ||= await embedImage(row.image.src);
    (got[c] ||= []).push({ emb: cache[key] });
  }
  fs.writeFileSync(cacheFile, JSON.stringify(cache));
}

const pool = {}, test = [];
for (const [c, rows] of Object.entries(got)) {
  const truth = new Set(map[c].map(n => idOf[n]));
  const main = idOf[map[c][0]];
  const p = rows.slice(0, POOL);
  (pool[main] ||= []).push(...p.map(x => x.emb));
  for (const x of rows.slice(POOL)) test.push({ emb: x.emb, truth, cls: c });
}
const curve = fewShotCurve({ pool, test, foods });
const meta = { model: MODEL + " (q8)", foods: foods.length, classes: Object.keys(got).length, test: test.length, pool: POOL,
  note: `Zero-shot is how the app behaves on a fresh install. Images are Food-101 (validation split); only dishes with a fair match in the app's food list are tested, so this is a sanity benchmark, not a claim about every meal. Thresholds for "asked" are the app's defaults.` };
fs.writeFileSync(new URL("./results.json", import.meta.url), JSON.stringify({ meta, curve, perClass: Object.fromEntries(Object.keys(got).map(c => [c, evaluateSet(test.filter(t => t.cls === c), foods, {})])) }, null, 1));
fs.writeFileSync(new URL("./RESULTS.md", import.meta.url), toMarkdown(curve, meta));
console.log(toMarkdown(curve, meta));
