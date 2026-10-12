# Benchmark

Measures how well the app's food guessing works, using the same CLIP model and the same ranking code as the app.

```
npm i @huggingface/transformers@3.5.1
node bench/run.mjs
```

It downloads labelled Food-101 images, scores zero-shot accuracy (a fresh install), then shows how accuracy changes as the app sees more confirmed photos of each food. It also reports how often the app would ask "which is it?" and how well its confidence matches reality. Results are written to `RESULTS.md`.

You can also run it from GitHub: Actions → benchmark → Run workflow.

Notes
- Only dishes with a fair match in `foods.json` are tested (see `classes.json`). Add more rows to widen it.
- `metrics.mjs` is covered by unit tests with synthetic data, so the scoring itself is checked even without the model.
- Run it before and after changing prompts, thresholds or the foods list, and keep the results with the commit.
