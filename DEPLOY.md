# Deploying to GitHub Pages

## 1. Create the repo
- Create a new GitHub repo (public if you want a shareable link; private repos
  can also use Pages on paid plans).
- Copy the contents of this folder into the repo root.
- Commit and push.

## 2. Turn on Pages
- Repo → **Settings → Pages**.
- Source: **Deploy from a branch**, branch `main`, folder `/ (root)`.
- Save. Your site publishes at `https://<user>.github.io/<repo>/` in ~1 minute.
- `.nojekyll` is included so `data/` and dot-paths serve correctly.

## 3. Keep the data fresh (the daily push)
The dashboard reads `data/amtrak_fare_log.csv`. Two ways to keep it current:

**Option A — Claude scheduled task pushes (recommended).**
Authorize the **GitHub connector** in your claude.ai connector settings, then
extend the daily tracker prompt (see `tracker/tracker-prompt.md`) with a final
step: after appending rows locally, commit and push `data/amtrak_fare_log.csv`
to this repo (`git add data/amtrak_fare_log.csv && git commit -m "fares: <date>"
&& git push`). Pages redeploys automatically on push.

**Option B — manual.**
Let the local tracker keep writing the CSV, then periodically copy it into the
repo's `data/` folder and push. Simple, but not hands-off.

## 4. Cache-busting (so deploys show up instantly)
GitHub Pages serves assets with `Cache-Control: max-age=600` and you can't
change headers, so a returning visitor could otherwise load fresh `index.html`
but keep an old cached `js/dashboard.js`. To avoid that, the script tag carries
a content hash (`js/dashboard.js?v=<hash>`); when the JS changes, the URL
changes and the browser refetches.

`scripts/stamp_version.py` keeps that hash current. It runs automatically via a
tracked pre-commit hook whenever `js/dashboard.js` is part of a commit — this
machine already has it enabled. **On a fresh clone, enable it once:**

```
git config core.hooksPath .githooks
```

You can also run it by hand (`python scripts/stamp_version.py`) or verify in CI
(`python scripts/stamp_version.py --check`). CSV-only commits (the daily
tracker) don't touch the hash, so nothing extra happens there.

## 5. (Optional) GitHub Action to timestamp deploys
No build step is needed — Pages serves the static files directly. If you later
add a build (e.g. bundling), add a `.github/workflows/pages.yml`. For now the
plain branch deploy is enough.

## Privacy
Publishing to a public repo makes your fare log public. If that's not desired,
use a private repo + Pages, or keep everything local with the file-picker
version of the dashboard (`amtrak_nhv_bos_fare_dashboard.html`).
