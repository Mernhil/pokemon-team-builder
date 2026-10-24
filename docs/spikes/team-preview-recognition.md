# Spike: fill in the opponent's six from a team-preview screenshot

**Status: stopped before measuring. The screenshots this spike needs are not there.**

The brief says the 5–10 samples (Switch captures and phone screenshots, light and busy backgrounds)
would be in `/samples` before the spike starts. `/samples` does not exist in the environment this
was run in (checked with `ls /samples`: no such file or directory), and the repository holds no
Champions screenshots. Accuracy, speed and the choice between OCR, image matching and a classifier
can only be answered from real captures, so no numbers are reported and nothing below is measured.

## What is here

- `scripts/spikes/team-preview-recognition.ts`: a prototype harness (not app code, no dependencies,
  nothing uploaded). Point it at the samples folder: each screenshot has a `<name>.txt` with the six
  species it shows, and optionally a `<name>.ocr.txt` with the raw text an OCR engine produced for
  it (`tesseract sample.png - --psm 6`, or tesseract.js in a page). It matches every OCR line against
  the Champions species list (an allowlist with a small edit-distance tolerance, which is what option
  (a) would do in the app) and prints per-sample and overall accuracy. With no samples folder it says
  so and stops.

## What can be said without samples (unverified, to be confirmed on real captures)

These are expectations from how the app and the game's screens work, not findings:

1. **What the preview shows.** Questions 1 and 2 of the brief need the real screen. The one
   assumption that matters for the choice: if the opponent's six are written out as names, an
   allowlist OCR of those names is the most reliable thing to read, because the allowlist is small
   (the regulation's ~200 species) and every name is distinctive; menu sprites and 3D models vary
   with form, lighting and camera, and held items are likely not shown for the opponent.
2. **Options.** (a) OCR with an allowlist: no model to ship beyond the OCR engine (tesseract.js is
   several MB of WASM and language data, loaded only when the feature is used), runs on the device,
   a second or two on a phone for a cropped region. (b) Image matching against reference sprites:
   needs a reference image per species and form and is sensitive to scale and background.
   (c) A small on-device classifier: needs labelled training crops this repository does not have.
   Cropping the six name regions first (fixed positions for a given aspect ratio) makes (a) both
   faster and more accurate than reading the whole screen.
3. **Getting the image in on an iPhone.** The Web Share Target API does not work for iOS home-screen
   apps, so: a file picker from Photos (`<input type="file" accept="image/*">`), paste from the
   clipboard (the Async Clipboard API's `read()`), and the camera (`capture`) as a fallback. On
   desktop: paste and drag and drop. All of these give a `File`/`Blob`, which an on-device OCR reads
   without any upload.
4. **Accuracy and time worth it.** In Game day the opponent's six are tapped from a grid of the most
   used species (Game day's "their six" step): about six taps and a search for a rare one, roughly
   10–20 seconds. Recognition has to beat that, which means the user confirms or corrects with one
   tap per Pokémon: if OCR gets 5 of 6 right, the saving is a few seconds per game plus the time to
   take and import the screenshot; with fewer than 4 of 6 right it is slower than tapping.

## Recommendation

**Build later**, and only after the real samples settle question 1. If the preview prints the
opponent's names, option (a) is a small, local, one-to-two-day feature (cropping, tesseract.js
behind a dynamic import, the allowlist match above, a confirm-or-correct row in Game day, the three
image inputs); the main risk is OCR quality on busy backgrounds and phone captures, which only the
samples can show. If it shows only sprites or models, don't build it. Estimate once measured:
spike 0.5 day with the samples, build 1–2 days.

## To finish the spike

Put 5–10 screenshots in `/samples` with their `.txt` ground truth, run
`npx tsx scripts/spikes/team-preview-recognition.ts /samples`, add the OCR outputs, and replace the
unverified section above with the measured results.
