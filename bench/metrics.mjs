// scoring for the benchmark. plain functions over embeddings, so they can be unit tested without the model.
import { rank, unsure, buildExamples } from "../src/learner.js";

// items: [{ emb, truth: Set(foodId) }]. examples: { foodId: [emb] }.
export function evaluateSet(items, foods, examples = {}) {
  let n = 0, top1 = 0, top3 = 0, asked = 0, askedTop3 = 0, confident = 0, confidentRight = 0, logLoss = 0;
  const bins = Array.from({ length: 10 }, () => ({ n: 0, conf: 0, right: 0 }));
  for (const it of items) {
    const r = rank(it.emb, foods, examples);
    if (!r.length) continue;
    n++;
    const right = it.truth.has(r[0].food_id), in3 = r.slice(0, 3).some(x => it.truth.has(x.food_id));
    if (right) top1++; if (in3) top3++;
    const pTruth = Math.max(1e-6, ...r.filter(x => it.truth.has(x.food_id)).map(x => x.prob));
    logLoss += -Math.log(pTruth);
    const b = bins[Math.min(9, Math.floor(r[0].prob * 10))]; b.n++; b.conf += r[0].prob; b.right += right ? 1 : 0;
    if (unsure(r)) { asked++; if (in3) askedTop3++; } else { confident++; if (right) confidentRight++; }
  }
  const f = (a, b) => b ? Math.round(1000 * a / b) / 1000 : null;
  const ece = n ? bins.reduce((a, b) => a + (b.n ? b.n * Math.abs(b.conf / b.n - b.right / b.n) : 0), 0) / n : null;
  return { n, top1: f(top1, n), top3: f(top3, n), askRate: f(asked, n), askedTop3: f(askedTop3, asked),
    confidentAcc: f(confidentRight, confident), logLoss: n ? Math.round(1000 * logLoss / n) / 1000 : null, ece: ece === null ? null : Math.round(1000 * ece) / 1000 };
}

// accuracy as the user confirms more photos of each food: k examples per food (0 = zero-shot, as on a fresh install)
export function fewShotCurve({ pool, test, foods, ks = [0, 1, 2, 4, 8, 16] }) {
  return ks.map(k => {
    const examples = {};
    for (const [foodId, embs] of Object.entries(pool)) if (k > 0) examples[foodId] = embs.slice(0, k);
    return { k, ...evaluateSet(test, foods, examples) };
  });
}

export function toMarkdown(curve, meta) {
  const row = c => `| ${c.k} | ${c.top1} | ${c.top3} | ${c.askRate} | ${c.askedTop3} | ${c.confidentAcc} | ${c.logLoss} | ${c.ece} |`;
  return `# Benchmark results

${meta.note}

- Model: ${meta.model}
- Foods the app can choose from: ${meta.foods}
- Classes tested: ${meta.classes} (${meta.test} test images, up to ${meta.pool} images per class available as examples)

Accuracy as the app sees more confirmed photos of each food (k = photos per food; 0 is a fresh install):

| k | top-1 | top-3 | asked | top-3 when asked | right when confident | log loss | calibration error |
|---|---|---|---|---|---|---|---|
${curve.map(row).join("\n")}
`;
}
