# Macro Tracker

A free photo macro tracker that runs on your phone or PC. Snap a meal, check the guess, see your calories and macros. The food recognition runs **on the device**: no LLM, no paid API, and your photos never leave it.

**Try it:** https://varun-aahil.github.io/macro-tracker/ · **Android and Windows builds:** see [Releases](../../releases)

## Screenshots
<p>
  <img src="docs/Screenshot_20261014_122134_Macro Tracker.jpg" width="220" alt="Today screen with calories and macros">
  <img src="docs/Screenshot_20261014_122139_Macro Tracker.jpg" width="220">
  <img src="docs/Screenshot_20261014_122143_Macro Tracker.jpg" width="220">
  <img src="docs/Screenshot_20261014_122147_Macro Tracker.jpg" width="220">
  <img src="docs/Screenshot_20261014_122151_Macro Tracker.jpg" width="220">
  <img src="docs/Screenshot_20261014_122155_Macro Tracker.jpg" width="220" alt="Me tab with targets and progress">
</p>

## Features
- **Photo to macros.** CLIP (ViT-B/32, 8-bit quantized) runs in the browser with transformers.js and ranks your photo against a table of 190 foods, including many Indian dishes, fruits and drinks.
- **Learns you.** Every confirmed meal stores its image embedding. Later photos are compared with your earlier ones, and portions default to what you usually eat.
- **Asks when unsure.** If the top guess is not clearly ahead (score and margin thresholds), the app shows its top 3 and "None of these" instead of guessing.
- **Barcode scanning** with Open Food Facts, plus one-tap "log again" for recent meals.
- **Personal targets.** Mifflin-St Jeor calorie target, protein by body weight, fibre goal, and an optional weekly check-in that adjusts targets from your real intake and weight trend.
- **Sign in with an email code** to sync meals, foods and settings across devices (Supabase, row-level security). Photos are never uploaded. The app also works fully without an account.
- **Offline first.** IndexedDB storage, service worker, installable as a web app, Android APK (Capacitor) or Windows app (Electron).

## How it works
- **Model.** CLIP is a pretrained image and text encoder, not an LLM. It scores a photo against each food name, so it works with no training data.
- **Learning.** Every confirmed meal stores its CLIP embedding. Later photos are also compared against your history, and that evidence is added to the zero-shot score.
- **Portions.** Starting portion = median of your history for that food, else the food's unit size. If you type kcal, portions rescale to match.
- **Honest test.** Every 5th photo meal is held out and never learned from. The Me tab tracks "right food in top 3" on those meals over time.
- **Storage.** IndexedDB on the device. Supabase (Postgres + auth) for optional cross-device sync.

## Install
- **Web app:** open https://varun-aahil.github.io/macro-tracker/ in Chrome > menu > Install app.
- **Android APK / Windows .exe:** see [Releases](../../releases).
- **Run locally:** `python -m http.server 8000`, open http://localhost:8000
- **Tests:** `node --test tests/learner.test.mjs`

## Limits
- First load needs internet to download the model (~150 MB, cached after).
- CLIP zero-shot on home-cooked Indian food is weak at first. Expect to correct the first ~20 meals.
- Mixed plates give one embedding for the whole plate, so per-food learning is noisy.
- Portion from a photo is not estimated, only learned from history. Oil and ghee are invisible.
- Seed nutrition values are approximate. Check them against your labels.

## Tech
JavaScript (ES modules), transformers.js, CLIP, IndexedDB, Supabase (Postgres, auth), Capacitor, Electron, GitHub Actions.
