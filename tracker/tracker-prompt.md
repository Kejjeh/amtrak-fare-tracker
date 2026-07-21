# Daily fare tracker — scheduled task prompt (reference)

This is the prompt run by the Claude scheduled task
`amtrak-nhv-bos-weekend-fare-tracker` (daily ~6 AM). It appends rows to
`data/amtrak_fare_log.csv` in this repo, then commits and pushes so GitHub
Pages redeploys the live dashboard.

---

Track the cheapest weekend round-trip Coach fare across the NEXT 6 WEEKENDS
between New Haven, CT (NHV, Union Station) and Boston, MA (BOS, South Station) on
Amtrak Northeast Regional (direct; exclude Acela for the coach figure and exclude
multi-segment "Mixed Service" itineraries).

For each of the next 6 weekends collect: Friday (NHV→BOS), Saturday (NHV→BOS),
Sunday (BOS→NHV). For each date record, from the direct Northeast Regional trains:
- the lowest Coach price, the "X left at this price" seats note, and the next
  Coach price up;
- the **train number and departure time** of that lowest-Coach train;
- the **sensible-window lowest Coach fare** — the cheapest Coach on a train that
  departs within reasonable hours — and its train number and departure time;
- the cheapest Acela Business price (comparison only).

SENSIBLE WINDOW (so the "bookable" fare reflects trips people actually take):
- Outbound NHV→BOS: trains departing **07:00–17:00**.
- Return BOS→NHV: trains departing **08:00–19:30**.
The rock-bottom fares almost always ride the 8:44 PM / 9:42 PM (after-midnight)
trains, which are excluded from the sensible figure but still logged as the
absolute floor.

Append one row per fare to data/amtrak_fare_log.csv with header (14 columns):
captured_date,travel_date,day_of_week,direction,days_ahead,lowest_coach_usd,seats_at_lowest,next_coach_usd,acela_business_usd,lowest_train,lowest_depart,sensible_coach_usd,sensible_train,sensible_depart
- lowest_train / sensible_train = train number (digits only, e.g. 168).
- lowest_depart / sensible_depart = departure time as h:mm + a/p, e.g. 2:22p, 8:40a.
- Create the file with this header if missing; otherwise APPEND — never overwrite
  prior rows. LF line endings, single trailing newline.

Report a concise summary: 6-weekend table (Fri/Sat/Sun lowest + round-trip
total), cheapest weekend + recommended outbound day, the best **bookable**
(sensible-time) round trip and which trains, any Saver-floor ($<=25) or low-seat
flags, and change vs the previous capture.

## PUSH STEP (wired into the scheduled task — auth via Git Credential Manager)
After appending rows, commit and push the updated CSV from the repo directory:
`git pull --rebase && git add data/amtrak_fare_log.csv && git commit -m "fares: {today}" && git push`
Pages redeploys automatically (~30s). Never force-push; if the push fails,
report it instead of retrying.
