# Claude Code kickoff — deploy the Amtrak fare dashboard to GitHub Pages

Paste the block below into Claude Code, after opening the `amtrak-fare-tracker`
folder as your working directory. (Copy the folder out of the Cowork outputs
directory to a normal dev location first, e.g. `~/dev/amtrak-fare-tracker`.)

---

I'm in the `amtrak-fare-tracker` project — a static GitHub Pages dashboard that
tracks weekend Amtrak fares between New Haven (NHV) and Boston (BOS). Structure:
`index.html` (dashboard; auto-fetches `data/amtrak_fare_log.csv` on load and has
charts + a floor-forecast), `data/amtrak_fare_log.csv` (append-only fare log,
seeded with real data), `tracker/tracker-prompt.md` (the daily job that appends
rows), `README.md`, `DEPLOY.md`, `.nojekyll`.

Please do the following, checking with me before anything destructive:

1. **Sanity-check the site locally.** Serve the folder (`python3 -m http.server`)
   and confirm `index.html` loads, auto-fetches the CSV, and all charts +
   forecast render without console errors. Fix any issues you find.
2. **Initialize git** and make a first commit (`git init`, sensible `.gitignore`,
   `main` branch, commit "Initial: Amtrak NHV-BOS fare dashboard").
3. **Create a GitHub repo and push.** Use the `gh` CLI if available
   (`gh repo create amtrak-fare-tracker --public --source=. --push`); otherwise
   walk me through creating it and set the remote. Ask me public vs private first.
4. **Enable GitHub Pages** (Settings → Pages → deploy from `main` / root) and
   give me the live URL. Verify the deployed page loads the CSV over https.
5. **Wire the daily data push (optional).** Review `tracker/tracker-prompt.md`;
   propose the cleanest way for the daily fare capture to commit & push updated
   `data/amtrak_fare_log.csv` (e.g., a small script + instructions, or a
   scheduled action). Note: the capture itself runs in Claude Cowork with browser
   control; this repo side only needs to receive the updated CSV and redeploy.
6. **Suggest 2–3 quality upgrades** to `index.html` you'd make as a dev
   (e.g., splitting inline JS into a module, a tiny CSV-schema test, caching
   headers), but don't implement until I pick.

Constraints: keep it a dependency-free static site (Chart.js via CDN is fine);
don't commit secrets; preserve the CSV schema
`captured_date,travel_date,day_of_week,direction,days_ahead,lowest_coach_usd,seats_at_lowest,next_coach_usd,acela_business_usd`
because both the tracker and the dashboard depend on it.
