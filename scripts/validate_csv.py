#!/usr/bin/env python3
"""Validate data/amtrak_fare_log.csv against the fixed 9-column schema.

Stdlib only. Exit 0 if clean, exit 1 with per-line errors otherwise.
Usage: python3 scripts/validate_csv.py [path/to/csv]
"""
import csv
import datetime
import pathlib
import sys

HEADER = ["captured_date", "travel_date", "day_of_week", "direction", "days_ahead",
          "lowest_coach_usd", "seats_at_lowest", "next_coach_usd", "acela_business_usd"]
DAYS = {"Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"}
DIRECTIONS = {"NHV-BOS", "BOS-NHV"}


def parse_date(value):
    try:
        return datetime.date.fromisoformat(value)
    except ValueError:
        return None


def main():
    path = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "data/amtrak_fare_log.csv")
    errors = []
    with path.open(newline="", encoding="utf-8") as f:
        rows = list(csv.reader(f))
    if not rows:
        sys.exit(f"{path}: file is empty")
    if rows[0] != HEADER:
        sys.exit(f"{path}: header mismatch\n  expected: {','.join(HEADER)}\n  found:    {','.join(rows[0])}")

    for lineno, row in enumerate(rows[1:], start=2):
        def err(msg):
            errors.append(f"line {lineno}: {msg}  [{','.join(row)}]")

        if len(row) != 9:
            err(f"expected 9 fields, got {len(row)}")
            continue
        cap_s, trav_s, dow, direction, days_s, low_s, seats_s, next_s, acela_s = [v.strip() for v in row]

        cap, trav = parse_date(cap_s), parse_date(trav_s)
        if cap is None:
            err(f"captured_date not YYYY-MM-DD: {cap_s!r}")
        if trav is None:
            err(f"travel_date not YYYY-MM-DD: {trav_s!r}")
        if dow not in DAYS:
            err(f"day_of_week not a Mon..Sun abbreviation: {dow!r}")
        elif trav is not None and trav.strftime("%a") != dow:
            err(f"day_of_week {dow!r} does not match travel_date {trav_s} ({trav.strftime('%a')})")
        if direction not in DIRECTIONS:
            err(f"direction not NHV-BOS/BOS-NHV: {direction!r}")

        if not days_s.isdigit():
            err(f"days_ahead not a non-negative integer: {days_s!r}")
        elif cap is not None and trav is not None and int(days_s) != (trav - cap).days:
            err(f"days_ahead {days_s} != travel_date - captured_date ({(trav - cap).days})")

        try:
            if float(low_s) <= 0:
                err(f"lowest_coach_usd must be > 0: {low_s!r}")
        except ValueError:
            err(f"lowest_coach_usd not a number: {low_s!r}")

        if seats_s and not seats_s.isdigit():
            err(f"seats_at_lowest not blank or a non-negative integer: {seats_s!r}")
        for label, val in (("next_coach_usd", next_s), ("acela_business_usd", acela_s)):
            if val:
                try:
                    if float(val) <= 0:
                        err(f"{label} must be blank or > 0: {val!r}")
                except ValueError:
                    err(f"{label} not blank or a number: {val!r}")

    if errors:
        print(f"{path}: {len(errors)} problem(s)")
        print("\n".join(errors))
        sys.exit(1)
    print(f"OK: {path} — header + {len(rows) - 1} data rows valid")


if __name__ == "__main__":
    main()
