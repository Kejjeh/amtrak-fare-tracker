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
| `test/` | `node --test` regression suite plus synthetic fixtures (stale, sparse, duplicate, malformed, timezone-boundary). |
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
- **The floor forecast is suppressed unless the data supports it** — at least 5
  distinct lead times, across at least 2 capture days, spanning at least 21
  days, with R² ≥ 0.50. Otherwise the table says why it is not modelled and
  shows only the observed low, labelled as an observation.
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
