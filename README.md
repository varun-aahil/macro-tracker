# Plate

Photo macro tracker that runs entirely on your phone or PC. No server, no accounts, no API costs.

Take a photo, get a draft list of foods, correct it, and (best) type in the real numbers when you know
them. Every correction teaches the app your food and your portions.

## How it works
- **Model:** CLIP (`Xenova/clip-vit-base-patch32`), a pretrained image + text encoder, run in the browser
  with transformers.js. It is not an LLM. It scores your photo against each food name in your table, so it
  works with no training data. Downloaded once (~150 MB) from Hugging Face, then cached on the device.
- **Learning:** each saved photo meal stores its CLIP embedding. Next time, the photo is also compared to
  your earlier photos of each food and that evidence is added to the zero-shot score.
- **Portions:** the model does not measure grams. Starting portion = what you usually eat of that food
  (median of your history), else the food's unit size.
- **Real numbers:** if you type kcal, your portions rescale to match. Typed protein/carbs/fat replace the
  estimate for that meal.
- **Honest test:** every 5th photo meal is set aside and never learned from. The Me tab compares
  "right food in top 3" at the start vs now on those meals.
- **Storage:** IndexedDB on the device. Use Me > Save backup, browsers can clear site data.

## Install
- **Android (easiest):** repo Settings > Pages > Source: GitHub Actions. After the `pages` workflow runs, open
  `https://<you>.github.io/<repo>/` in Chrome > menu > Install app.
- **Android APK / Windows .exe:** push a tag (`git tag v1.0.0 && git push --tags`). The `android` and
  `windows` workflows attach `Plate.apk` and `Plate-portable.exe` to the release. Allow "install unknown
  apps" on the phone to sideload the APK.
- **Run locally:** `python -m http.server 8000`, open http://localhost:8000
- **Tests:** `node --test tests/learner.test.mjs`

## Limits
- First photo needs internet to fetch the model, later use is offline.
- CLIP zero-shot on home-cooked Indian food is weak at first. Expect to correct a lot for the first ~20 meals.
  Naming foods the way CLIP would picture them (the "how the model should picture it" box) helps.
- Mixed plates give one embedding for the whole plate, so per-food learning is noisy.
- Portion from a photo is not estimated, only learned from your history. Oil and ghee are invisible.
- Seed nutrition values are approximate. Replace with your labels / IFCT.
- The APK and .exe workflows, and the real CLIP download, have not been run yet.
