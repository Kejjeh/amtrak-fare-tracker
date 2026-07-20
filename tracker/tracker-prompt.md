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
Sunday (BOS→NHV). For each, record the lowest Coach price, the "X left at this
price" seats note, the next Coach price up, and the cheapest Acela Business price.

Append one row per fare to data/amtrak_fare_log.csv with header:
captured_date,travel_date,day_of_week,direction,days_ahead,lowest_coach_usd,seats_at_lowest,next_coach_usd,acela_business_usd
(create with header if missing; never overwrite existing rows).

Report a concise summary: 6-weekend table (Fri/Sat/Sun lowest + round-trip
total), cheapest weekend + recommended outbound day, any Saver-floor ($<=25) or
low-seat flags, and change vs the previous capture.

## PUSH STEP (wired into the scheduled task — auth via Git Credential Manager)
After appending rows, commit and push the updated CSV from the repo directory:
`git pull --rebase && git add data/amtrak_fare_log.csv && git commit -m "fares: {today}" && git push`
Pages redeploys automatically (~30s). Never force-push; if the push fails,
report it instead of retrying.
