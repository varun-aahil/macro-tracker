# Design notes
- **Constraint:** free, no LLM/API, GitHub-only distribution, Android + exe. So: on-device web app,
  wrapped by Capacitor (APK) and Electron (exe), built by GitHub Actions.
- **Why CLIP zero-shot:** a cold start with no labelled data. Text prompts come from the food table.
- **Why image kNN on top, not fine-tuning:** tens of examples overfit a network, kNN improves immediately and
  needs no training step. Bonus is centred on the median similarity so foods with examples don't dominate
  foods without; its weight grows with example count.
- **Evaluation:** holdout every 5th photo meal; compare zero-shot vs adaptive top-1/top-3.
- **Offset fix:** typed real kcal rescales grams so food-level history stays consistent; meal-level
  error (predicted vs final kcal) is reported as MAE/MAPE/bias.
- **Weak spots to defend:** whole-plate embeddings, portion not measured, small holdout noise, CLIP bias
  toward western food.
- **Next:** crop/segment per food, scale reference, tune BONUS/FULL_AFTER on real data.
