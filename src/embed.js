// clip image + text encoders running in the browser via transformers.js (onnx / wasm).
// the weights download once from huggingface (free, no key) and are cached on the device.
import { normalize } from "./learner.js";

const LIB = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.1";
const MODEL = "Xenova/clip-vit-base-patch32";
let lib, processor, tokenizer, vision, textModel, loading;

export function ready() { return !!globalThis.PLATE_FAKE_EMBED || !!vision; }

export function loadModel(onProgress = () => {}) {
  if (globalThis.PLATE_FAKE_EMBED) return Promise.resolve();
  loading ||= (async () => {
    lib = await import(LIB);
    lib.env.allowLocalModels = false;
    const opts = { progress_callback: onProgress };
    processor = await lib.AutoProcessor.from_pretrained(MODEL, opts);
    tokenizer = await lib.AutoTokenizer.from_pretrained(MODEL, opts);
    vision = await lib.CLIPVisionModelWithProjection.from_pretrained(MODEL, { ...opts, dtype: "q8" });
    textModel = await lib.CLIPTextModelWithProjection.from_pretrained(MODEL, { ...opts, dtype: "q8" });
  })().catch(e => { loading = null; throw e; });
  return loading;
}

export async function embedImage(blob) {
  if (globalThis.PLATE_FAKE_EMBED) return globalThis.PLATE_FAKE_EMBED.image(blob);
  await loadModel();
  const img = await lib.RawImage.fromBlob(blob);
  const { image_embeds } = await vision(await processor(img));
  return normalize(Array.from(image_embeds.data));
}

export async function embedText(text) {
  if (globalThis.PLATE_FAKE_EMBED) return globalThis.PLATE_FAKE_EMBED.text(text);
  await loadModel();
  const { text_embeds } = await textModel(tokenizer([text], { padding: true, truncation: true }));
  return normalize(Array.from(text_embeds.data));
}

export function promptFor(food) {
  if (food.prompt) return food.prompt;
  const name = food.name.replace(/\(.*?\)/g, "").replace(/\s+/g, " ").trim();
  return `a photo of ${name}, a plate of food`;
}
