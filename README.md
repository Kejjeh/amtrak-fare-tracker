# Amtrak New Haven ⇄ Boston — Weekend Fare Tracker

A self-updating dashboard that tracks the cheapest weekend round-trip Coach fare
between **New Haven Union Station (NHV)** and **Boston South Station (BOS)** on
Amtrak's Northeast Regional, and turns a growing fare log into charts, a booking
recommendation, and a floor forecast.

## What's here

| Path | What it is |
|------|-----------|
| `index.html` | The dashboard. Auto-loads `data/amtrak_fare_log.csv` on page load; falls back to a manual "Load fare log" button when opened from `file://`. |
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
captured_date,travel_date,day_of_week,direction,days_ahead,lowest_coach_usd,seats_at_lowest,next_coach_usd,acela_business_usd
```

- `direction` = `NHV-BOS` (outbound) or `BOS-NHV` (return)
- `day_of_week` = `Fri` | `Sat` | `Sun`
- blank cells are allowed (e.g. no "X left at this price" shown)

## Notes & limits

Fares are dynamic and each row is a single-date snapshot; the value comes from
repeated daily captures. Saver is the lowest, non-refundable bucket. Car-cost
comparison assumes ~275 mi round trip, ~$3.95/gal New England gas, ~30 mpg,
~$8 tolls, and Boston parking as the swing factor.
