# Amtrak New Haven ⇄ Boston — Weekend Fare Tracker

A self-updating dashboard that tracks the cheapest weekend round-trip Coach fare
between **New Haven Union Station (NHV)** and **Boston South Station (BOS)** on
Amtrak's Northeast Regional, and turns a growing fare log into charts, a booking
recommendation, and a floor forecast.

## What's here

| Path | What it is |
|------|-----------|
| `index.html` | The dashboard. Auto-loads `data/amtrak_fare_log.csv` on page load; falls back to a manual "Load fare log" button when opened from `file://`. |
| `js/fare-data.js` | The trust layer: CSV parsing, validation, weekend pairing, staleness and the gated floor fit. Pure and DOM-free. |
| `js/dashboard.js` | Rendering only — it draws what the trust layer vouches for. |
| `test/` | `node --test` regression suite plus synthetic fixtures (stale, sparse, duplicate, malformed, timezone-boundary, departed-leg, missing-train). |
| `docs/screenshots/` | Rendered states captured from the fixtures at a pinned date, for review without running the page. |
| `data/amtrak_fare_log.csv` | The append-only fare log. One row per fare per capture. |
| `tracker/tracker-prompt.md` | The prompt run by the daily Claude scheduled task that appends new rows (and, optionally, commits + pushes them). |
| `DEPLOY.md` | Step-by-step GitHub Pages setup + how to wire the daily push. |
| `.nojekyll` | Tells Pages to serve files as-is (no Jekyll processing). |

## How it works

1. A **daily Claude scheduled task** (6 AM) opens amtrak.com, reads the lowest
   Coach fare (plus seats-left, next price up, and Acela) for Friday/Saturday
   outbound and Sunday return across the next 6 weekends, and **appends** rows to
   `data/amtrak_fare_log.csv`.
2. On GitHub Pages, `index.html` fetches that CSV and recomputes everything:
   median fare curves with min–max bands, a per-weekend price trajectory, a
   scarcity panel, a book-now recommendation, and a modeled floor forecast.
3. As the log grows, the bands tighten and the forecast sharpens.

## Data schema (`data/amtrak_fare_log.csv`)

```
captured_date,travel_date,day_of_week,direction,days_ahead,lowest_coach_usd,seats_at_lowest,next_coach_usd,acela_business_usd,lowest_train,lowest_depart,sensible_coach_usd,sensible_train,sensible_depart
```

The first nine columns are the original schema; the last five add the train and
departure time behind each fare, plus the cheapest fare at a usable hour. A
file carrying only the first nine columns still loads.

- `direction` = `NHV-BOS` (outbound) or `BOS-NHV` (return)
- `day_of_week` = `Fri` | `Sat` | `Sun`, and it must agree with `travel_date`
- **a blank cell means "not observed", never `0`**

## What the dashboard will and will not claim

The log is an append-only record of what Amtrak was showing on a given morning.
Most of the work in `js/fare-data.js` is about not overstating that:

- **Rows are validated, not assumed.** A row is used only when both dates are
  real calendar dates, `captured_date` is not in the future, `travel_date` is on
  or after it, `days_ahead` agrees with both (it is re-derived, never trusted),
  `day_of_week` matches `travel_date`, the fare parses as currency, and the
  day/direction pair is a weekend out-and-back leg. Everything else is rejected
  with a reason and a line number, shown in the **Data quality** panel.
- **A round trip needs both legs from the same capture.** An outbound seen on
  Monday and a return seen on Tuesday are never added together — that sum was
  never simultaneously on sale. Weekends that cannot be paired are listed with
  the reason instead of being dropped silently.
- **Departed trips are excluded**, and a capture older than two days is marked
  stale: the recommendation card switches from "good to book" to reporting a
  past observation.
- **A trip is only bookable if neither leg has already travelled.** The weekend
  is not "past" until the Sunday return has gone, but the Friday or Saturday
  outbound departs first — so on a Saturday morning a Fri+Sun total is already
  unbuyable however fresh the capture was. Those rows stay in the table as
  history, marked `·departed`, and the price column stops calling itself
  "Bookable RT". An outbound travelling *today* is marked `·departs today`,
  since the page cannot know the clock time.
- **A fare is never labelled with a train that did not sell it.** If the
  sensible-hours fare is shown but `sensible_train`/`sensible_depart` are blank,
  the columns read "train n/a" rather than borrowing the lowest-fare train —
  which would print a daytime fare next to a 9:47p departure.
- **The floor forecast is suppressed unless the data supports it** — at least 5
  distinct lead times, across at least 2 capture days, spanning at least 21
  days, with R² ≥ 0.50. Otherwise the table says why it is not modelled and
  shows only the observed low, labelled as an observation.
- **The forecast must also point the right way.** The model describes fares
  *falling* toward a floor as departure nears. A log where fares rise with lead
  time can fit that curve almost perfectly (R² 0.998) while describing the
  opposite trend, so a fit with k ≤ 0 is refused. A log with no price variation
  at all is refused too, rather than scored as a perfect fit. No published fit
  phrases itself as an instruction: there is no "book anytime".
- **"Good to book" needs evidence.** The comparison against the log's
  cheapest-ever fare is only made once the log holds at least 10 observations
  across at least 2 capture days; below that the card says how little it has
  instead of grading the price.
- **No advice without data.** Before a log is loaded — and after one fails to
  parse, or has every row rejected — the recommendation card says so. It never
  keeps a previous answer, or the page's own example, on screen next to an
  error.
- There is no "Modeled floor" column. The model's floor term is seeded from the
  observed minimum, so printing it beside "Observed low" showed one number twice
  and read as the model confirming the floor.
- **Duplicate captures collapse** to one observation (the later row supersedes),
  so sample counts and medians are not inflated.
- Weekend grouping is done in UTC epoch-days, so a viewer in Tokyo sees the same
  weekends as one in New Haven. "Today" is evaluated in `America/New_York`.

## Development

```
node --test 'test/**/*.test.js'     # regression suite, no dependencies
TZ=Asia/Tokyo node --test 'test/**/*.test.js'
python3 scripts/validate_csv.py data/amtrak_fare_log.csv
python3 scripts/stamp_version.py --check
```

## Notes & limits

Fares are dynamic and each row is a single-date snapshot; the value comes from
repeated daily captures. Saver is the lowest, non-refundable bucket. Nothing on
the page is a live quote — always re-check amtrak.com before booking. The
train-vs-drive table and the lowest-of-day table are fixed July 2026 reference
figures and do not recompute from the log. Car-cost comparison assumes ~275 mi
round trip, ~$3.95/gal New England gas, ~30 mpg, ~$8 tolls, and Boston parking
as the swing factor.
