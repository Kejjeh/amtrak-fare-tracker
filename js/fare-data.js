/* fare-data.js — the trust layer between the fare log and the dashboard.
 *
 * Pure and DOM-free on purpose: every rule that decides whether a number is
 * real, current, and bookable lives here, so it can be tested under Node
 * (`node --test test/`) without a browser.
 *
 * Three rules drive the whole file:
 *   1. A blank cell is MISSING, never zero.
 *   2. A quote is only bookable if it was captured recently AND the travel
 *      date is still ahead. Otherwise it is history, and must be labelled so.
 *   3. A round trip is only a round trip if both legs come from the SAME
 *      capture and point in opposite directions.
 *
 * Dates are handled as UTC epoch-days throughout. The dashboard never builds
 * a Date from a local-midnight string, because `new Date('2026-07-25T00:00:00')`
 * is local and `.toISOString()` is UTC — that round trip silently shifts every
 * weekend back a day for viewers east of Greenwich.
 */
(function (factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.FareData = api;
})(function () {
  'use strict';

  // ---------------------------------------------------------------- schema

  var HEADER_14 = ['captured_date', 'travel_date', 'day_of_week', 'direction', 'days_ahead',
    'lowest_coach_usd', 'seats_at_lowest', 'next_coach_usd', 'acela_business_usd',
    'lowest_train', 'lowest_depart', 'sensible_coach_usd', 'sensible_train', 'sensible_depart'];
  var HEADER_9 = HEADER_14.slice(0, 9);

  var DIRECTIONS = { 'NHV-BOS': 'out', 'BOS-NHV': 'ret' };
  // The product is a weekend out-and-back: leave Fri or Sat, come home Sunday.
  var LEGS = { 'Fri|NHV-BOS': 'out', 'Sat|NHV-BOS': 'out', 'Sun|BOS-NHV': 'ret' };

  var STALE_AFTER_DAYS = 2;     // a capture older than this is not "bookable now"
  var MIN_LEAD_POINTS = 5;      // distinct lead times required before fitting a floor
  var MIN_FIT_CAPTURES = 2;     // a curve from a single morning is one snapshot, not a trend
  var MIN_FIT_SPAN_DAYS = 21;   // lead-time span the points must cover
  var MIN_FIT_R2 = 0.5;         // below this the fit explains less than half the variance

  // ------------------------------------------------------------ date utils

  var ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
  var DOW_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var DAY_MS = 86400000;

  /** Strict YYYY-MM-DD -> UTC epoch-day integer, or null. Rejects 2026-02-30. */
  function isoToDay(s) {
    var m = ISO_RE.exec(String(s == null ? '' : s).trim());
    if (!m) return null;
    var y = +m[1], mo = +m[2], d = +m[3];
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    var t = Date.UTC(y, mo - 1, d);
    var dt = new Date(t);
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
    return Math.round(t / DAY_MS);
  }
  function dayToISO(day) { return new Date(day * DAY_MS).toISOString().slice(0, 10); }
  function dowOfDay(day) { return DOW_NAMES[new Date(day * DAY_MS).getUTCDay()]; }
  function addDays(iso, n) { var d = isoToDay(iso); return d == null ? null : dayToISO(d + n); }
  function daysBetween(fromISO, toISO) {
    var a = isoToDay(fromISO), b = isoToDay(toISO);
    return (a == null || b == null) ? null : b - a;
  }

  /**
   * Today's date in the corridor's own timezone (America/New_York), not the
   * viewer's. "Is Saturday still ahead?" is a question about the train, not
   * about where the browser happens to be. Falls back to UTC.
   */
  function todayISO(tz) {
    var zone = tz || 'America/New_York';
    try {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit'
      }).format(new Date());
    } catch (e) {
      return new Date().toISOString().slice(0, 10);
    }
  }

  // ----------------------------------------------------------- value utils

  // Accepts 57, 57.5, 57.50, $57, 1,234.50. Rejects '', 'n/a', '$', '57abc',
  // '1e3', '-5'. parseFloat() accepted most of those and produced NaN or a
  // half-read number that then flowed into every chart axis and KPI.
  var MONEY_RE = /^\$?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?$/;
  var COUNT_RE = /^\d+$/;
  var TRAIN_RE = /^\d{1,4}$/;
  var TIME_RE = /^(1[0-2]|[1-9]):[0-5][0-9][ap]$/;

  /** '' -> missing (null, ok). Garbage -> {ok:false}. Never returns NaN. */
  function parseMoney(raw) {
    var v = String(raw == null ? '' : raw).trim();
    if (v === '') return { ok: true, value: null };
    if (!MONEY_RE.test(v)) return { ok: false, value: null };
    var n = parseFloat(v.replace(/[$,]/g, ''));
    if (!Number.isFinite(n)) return { ok: false, value: null };
    return { ok: true, value: n };
  }
  function parseCount(raw) {
    var v = String(raw == null ? '' : raw).trim();
    if (v === '') return { ok: true, value: null };
    if (!COUNT_RE.test(v)) return { ok: false, value: null };
    return { ok: true, value: parseInt(v, 10) };
  }
  function parseText(raw, re) {
    var v = String(raw == null ? '' : raw).trim();
    if (v === '') return { ok: true, value: null };
    if (re && !re.test(v)) return { ok: false, value: null };
    return { ok: true, value: v };
  }

  /** Sum that refuses to invent a total from missing parts. */
  function sumOrNull(parts) {
    var t = 0;
    for (var i = 0; i < parts.length; i++) {
      if (parts[i] == null || !Number.isFinite(parts[i])) return null;
      t += parts[i];
    }
    return t;
  }
  function round2(n) { return Math.round(n * 100) / 100; }

  // ------------------------------------------------------------ CSV reader

  /**
   * RFC-4180 reader: quoted fields, escaped "" inside them, CRLF/CR/LF, BOM.
   * Returns records tagged with the 1-based source line they started on, so
   * every rejection can point at a line the user can actually open.
   */
  function readRecords(text) {
    var s = String(text == null ? '' : text);
    if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);
    var records = [], field = '', row = [], quoted = false, started = false;
    var line = 1, recLine = 1, i = 0;

    function endField() { row.push(field); field = ''; started = true; }
    function endRecord() {
      endField();
      var blank = row.length === 1 && row[0].trim() === '';
      if (!blank) records.push({ line: recLine, fields: row });
      row = []; started = false; recLine = line;
    }

    for (; i < s.length; i++) {
      var ch = s[i];
      if (quoted) {
        if (ch === '"') {
          if (s[i + 1] === '"') { field += '"'; i++; }
          else quoted = false;
        } else {
          if (ch === '\n') line++;
          field += ch;
        }
        continue;
      }
      if (ch === '"' && field.trim() === '') { quoted = true; field = ''; continue; }
      if (ch === ',') { endField(); continue; }
      if (ch === '\r') { if (s[i + 1] === '\n') i++; line++; endRecord(); continue; }
      if (ch === '\n') { line++; endRecord(); continue; }
      field += ch;
    }
    if (quoted) return { error: 'unterminated quoted field starting near line ' + recLine };
    if (field !== '' || row.length || started) endRecord();
    return { records: records };
  }

  // ------------------------------------------------------------ row parsing

  /**
   * parseCSV(text, opts) -> {ok, error, rows, rejected, duplicates, stats}
   *
   * `rows` only ever contains rows that are well-formed, chronologically
   * possible, and part of the weekend out-and-back pattern. Everything else
   * lands in `rejected` WITH A REASON so the dashboard can say how many rows
   * it refused and why, instead of silently charting fewer points.
   */
  function parseCSV(text, opts) {
    opts = opts || {};
    var today = opts.today || todayISO(opts.timezone);
    var todayDay = isoToDay(today);

    var read = readRecords(text);
    if (read.error) return fail(read.error);
    var records = read.records;
    if (!records.length) return fail('The file is empty — no header row found.');

    var header = records[0].fields.map(function (h) { return h.trim(); });
    var width;
    if (sameList(header, HEADER_14)) width = 14;
    else if (sameList(header, HEADER_9)) width = 9;
    else {
      return fail('Unexpected CSV header. Expected:\n  ' + HEADER_14.join(',') +
        '\n(or the legacy 9-column form)\nFound:\n  ' + header.join(','));
    }

    var rows = [], rejected = [], seen = Object.create(null), duplicates = [];
    var offPattern = 0;

    for (var i = 1; i < records.length; i++) {
      var rec = records[i], f = rec.fields, reasons = [];
      var push = function (r) { reasons.push(r); };

      if (f.length !== width) {
        rejected.push({ line: rec.line, kind: 'malformed', reasons: ['expected ' + width + ' fields, found ' + f.length], raw: f });
        continue;
      }
      var get = function (name) {
        var ix = HEADER_14.indexOf(name);
        return ix < 0 || ix >= width ? '' : String(f[ix] == null ? '' : f[ix]).trim();
      };

      var capturedISO = get('captured_date'), travelISO = get('travel_date');
      var capDay = isoToDay(capturedISO), travDay = isoToDay(travelISO);
      if (capDay == null) push('captured_date is not a real YYYY-MM-DD date: ' + q(capturedISO));
      if (travDay == null) push('travel_date is not a real YYYY-MM-DD date: ' + q(travelISO));

      // ---- chronology: a quote cannot exist before it was taken, and a
      // capture cannot come from the future.
      if (capDay != null && todayDay != null && capDay > todayDay) {
        push('captured_date ' + capturedISO + ' is in the future (today is ' + today + ')');
      }
      if (capDay != null && travDay != null && travDay < capDay) {
        push('travel_date ' + travelISO + ' is before captured_date ' + capturedISO);
      }

      // days_ahead is derived from the two dates, never trusted. A stored
      // value that disagrees means one of the three fields is wrong.
      var derivedLead = (capDay != null && travDay != null) ? travDay - capDay : null;
      var leadRaw = get('days_ahead');
      var lead = parseCount(leadRaw);
      if (!lead.ok || lead.value == null) push('days_ahead is not a non-negative integer: ' + q(leadRaw));
      else if (derivedLead != null && lead.value !== derivedLead) {
        push('days_ahead ' + lead.value + ' disagrees with travel_date - captured_date (' + derivedLead + ')');
      }

      var dow = get('day_of_week');
      var derivedDow = travDay != null ? dowOfDay(travDay) : null;
      if (derivedDow && dow !== derivedDow) {
        push('day_of_week ' + q(dow) + ' does not match travel_date ' + travelISO + ' (' + derivedDow + ')');
      }
      var dir = get('direction');
      if (!DIRECTIONS[dir]) push('direction is not NHV-BOS or BOS-NHV: ' + q(dir));

      var low = parseMoney(get('lowest_coach_usd'));
      if (!low.ok) push('lowest_coach_usd is not a currency value: ' + q(get('lowest_coach_usd')));
      else if (low.value == null) push('lowest_coach_usd is blank — a fare row needs a fare');
      else if (low.value <= 0) push('lowest_coach_usd must be greater than 0: ' + q(get('lowest_coach_usd')));

      var seats = parseCount(get('seats_at_lowest'));
      if (!seats.ok) push('seats_at_lowest is not blank or a whole number: ' + q(get('seats_at_lowest')));
      var next = parseMoney(get('next_coach_usd'));
      if (!next.ok || (next.value != null && next.value <= 0)) push('next_coach_usd is not blank or a positive currency value: ' + q(get('next_coach_usd')));
      var acela = parseMoney(get('acela_business_usd'));
      if (!acela.ok || (acela.value != null && acela.value <= 0)) push('acela_business_usd is not blank or a positive currency value: ' + q(get('acela_business_usd')));

      var sens = parseMoney(get('sensible_coach_usd'));
      if (!sens.ok || (sens.value != null && sens.value <= 0)) push('sensible_coach_usd is not blank or a positive currency value: ' + q(get('sensible_coach_usd')));
      else if (sens.value != null && low.ok && low.value != null && sens.value < low.value) {
        push('sensible_coach_usd ' + sens.value + ' is below lowest_coach_usd ' + low.value);
      }
      var ltrain = parseText(get('lowest_train'), TRAIN_RE);
      if (!ltrain.ok) push('lowest_train is not blank or a train number: ' + q(get('lowest_train')));
      var strain = parseText(get('sensible_train'), TRAIN_RE);
      if (!strain.ok) push('sensible_train is not blank or a train number: ' + q(get('sensible_train')));
      var ldep = parseText(get('lowest_depart'), TIME_RE);
      if (!ldep.ok) push('lowest_depart is not blank or a time like 2:22p: ' + q(get('lowest_depart')));
      var sdep = parseText(get('sensible_depart'), TIME_RE);
      if (!sdep.ok) push('sensible_depart is not blank or a time like 2:22p: ' + q(get('sensible_depart')));

      if (reasons.length) {
        rejected.push({ line: rec.line, kind: 'malformed', reasons: reasons, raw: f });
        continue;
      }

      var legKind = LEGS[dow + '|' + dir];
      if (!legKind) {
        offPattern++;
        rejected.push({
          line: rec.line, kind: 'off-pattern',
          reasons: [dow + ' ' + dir + ' is not a weekend out-and-back leg (Fri/Sat NHV-BOS out, Sun BOS-NHV back)'],
          raw: f
        });
        continue;
      }

      var row = {
        line: rec.line,
        captured: capturedISO, travel: travelISO,
        capturedDay: capDay, travelDay: travDay,
        dow: derivedDow, dir: dir, leg: legKind,
        days: derivedLead,
        low: low.value, seats: seats.value, next: next.value, acela: acela.value,
        ltrain: ltrain.value, ldep: ldep.value,
        sens: sens.value, strain: strain.value, sdep: sdep.value
      };

      // An append-only log can re-capture the same leg on the same morning.
      // A later row supersedes an earlier one; both are reported so the count
      // the dashboard shows is the count of distinct observations.
      var key = capturedISO + '|' + travelISO + '|' + dir;
      if (seen[key] != null) {
        var prev = rows[seen[key]];
        duplicates.push({ line: rec.line, supersedes: prev.line, key: key, changed: prev.low !== row.low || prev.sens !== row.sens });
        rows[seen[key]] = row;
      } else {
        seen[key] = rows.length;
        rows.push(row);
      }
    }

    var captures = uniqueSorted(rows.map(function (r) { return r.captured; }));
    var latest = captures.length ? captures[captures.length - 1] : null;
    return {
      ok: true, error: null, header: header, width: width,
      rows: rows, rejected: rejected, duplicates: duplicates,
      stats: {
        dataRecords: records.length - 1,
        accepted: rows.length,
        rejected: rejected.length,
        offPattern: offPattern,
        malformed: rejected.length - offPattern,
        duplicates: duplicates.length,
        captures: captures,
        firstCapture: captures.length ? captures[0] : null,
        latestCapture: latest,
        latestCaptureAgeDays: latest != null && todayDay != null ? todayDay - isoToDay(latest) : null,
        today: today
      }
    };

    function fail(msg) {
      return {
        ok: false, error: msg, header: null, width: null,
        rows: [], rejected: [], duplicates: [],
        stats: { dataRecords: 0, accepted: 0, rejected: 0, offPattern: 0, malformed: 0, duplicates: 0, captures: [], firstCapture: null, latestCapture: null, latestCaptureAgeDays: null, today: today }
      };
    }
  }

  function sameList(a, b) {
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }
  function uniqueSorted(list) {
    var out = [], seen = Object.create(null);
    list.forEach(function (v) { if (v != null && !seen[v]) { seen[v] = 1; out.push(v); } });
    return out.sort();
  }
  function q(v) { return JSON.stringify(String(v == null ? '' : v)); }

  // ---------------------------------------------------------- fare accessor

  /** 'sensible' falls back to the absolute lowest only when no sensible fare exists. */
  function makeFareAccessor(mode) {
    var sensible = mode !== 'absolute';
    return function (r) {
      var v = (sensible && r.sens != null) ? r.sens : r.low;
      return Number.isFinite(v) ? v : null;
    };
  }
  function legDetail(r, fareOf) {
    var sensible = fareOf(r) === r.sens && r.sens != null;
    return {
      fare: fareOf(r),
      train: sensible && r.strain ? r.strain : r.ltrain,
      depart: sensible && r.sdep ? r.sdep : r.ldep,
      seats: r.seats, days: r.days, dow: r.dow, travel: r.travel,
      captured: r.captured, line: r.line
    };
  }

  // ------------------------------------------------------------- weekends

  /** Saturday of the weekend this leg belongs to, as YYYY-MM-DD. TZ-independent. */
  function weekendKey(row) {
    var day = row.travelDay != null ? row.travelDay : isoToDay(row.travel);
    if (day == null) return null;
    var dow = row.dow || dowOfDay(day);
    var off = { Fri: 1, Sat: 0, Sun: -1 }[dow];
    if (off == null) return null;
    return dayToISO(day + off);
  }

  /**
   * Group accepted rows into weekends, then into per-capture quotes.
   *
   * A quote is only produced for a capture that saw BOTH an outbound leg and
   * the Sunday return. Legs from different mornings are never added together:
   * the sum of a Monday outbound and a Tuesday return is a price that was
   * never simultaneously on sale.
   */
  function buildWeekends(rows, opts) {
    opts = opts || {};
    var fareOf = opts.fareOf || makeFareAccessor(opts.mode);
    var today = opts.today || todayISO(opts.timezone);
    var todayDay = isoToDay(today);
    var staleAfter = opts.staleAfterDays == null ? STALE_AFTER_DAYS : opts.staleAfterDays;

    var byWeekend = Object.create(null);
    rows.forEach(function (r) {
      var k = weekendKey(r);
      if (k == null) return;
      var w = byWeekend[k] || (byWeekend[k] = { key: k, captures: Object.create(null), samples: 0, legsSeen: {} });
      w.samples++;
      w.legsSeen[r.dow] = true;
      var cap = w.captures[r.captured] || (w.captures[r.captured] = { captured: r.captured, out: null, ret: null, sampleCount: 0 });
      cap.sampleCount++;
      var det = legDetail(r, fareOf);
      if (det.fare == null) return;
      var slot = r.leg === 'out' ? 'out' : 'ret';
      // Cheapest leg wins within a capture; ties keep the earlier row.
      if (!cap[slot] || det.fare < cap[slot].fare) cap[slot] = det;
    });

    return Object.keys(byWeekend).sort().map(function (k) {
      var w = byWeekend[k];
      var satISO = k, sunISO = addDays(k, 1);
      var capList = Object.keys(w.captures).sort().map(function (c) { return w.captures[c]; });

      var quotes = capList.map(function (c) {
        if (!c.out || !c.ret) return null;
        var rt = sumOrNull([c.out.fare, c.ret.fare]);
        if (rt == null) return null;
        var age = todayDay != null ? todayDay - isoToDay(c.captured) : null;
        return {
          captured: c.captured, out: c.out, ret: c.ret, rt: round2(rt),
          ageDays: age, stale: age == null ? true : age > staleAfter
        };
      }).filter(Boolean);

      var latest = quotes.length ? quotes[quotes.length - 1] : null;
      var missing = ['Fri', 'Sat', 'Sun'].filter(function (d) { return !w.legsSeen[d]; });
      // The trip is over once the Sunday return has departed.
      var past = todayDay != null && isoToDay(sunISO) < todayDay;

      return {
        key: k, satISO: satISO, sunISO: sunISO,
        holiday: holidayName(k),
        quotes: quotes, latest: latest,
        captureCount: capList.length, sampleCount: w.samples,
        legsSeen: w.legsSeen, missingLegs: missing,
        // Why there is no round trip for this weekend, in the user's words.
        incompleteReason: latest ? null : (
          !capList.length ? 'no observations' :
            missing.indexOf('Sun') >= 0 ? 'no Sunday return logged' :
              (!w.legsSeen.Fri && !w.legsSeen.Sat) ? 'no Friday or Saturday outbound logged' :
                'no single capture saw both an outbound and the Sunday return'
        ),
        travelPast: past,
        bookable: !!latest && !past && !latest.stale
      };
    });
  }

  /** Upcoming weekends that have a coherent round trip, cheapest first. */
  function bookableWeekends(weekends) {
    return weekends.filter(function (w) { return w.latest && !w.travelPast; });
  }

  // ------------------------------------------------------------- holidays

  function nthWeekdayUTC(y, m, wd, n) {
    var day = isoToDay(y + '-' + pad(m + 1) + '-01'), c = 0;
    for (var i = 0; i < 40; i++) {
      if (new Date((day + i) * DAY_MS).getUTCDay() === wd && ++c === n) return day + i;
    }
    return day;
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function holidayList(y) {
    return [
      { name: 'Labor Day', day: nthWeekdayUTC(y, 8, 1, 1) },
      { name: 'Columbus Day', day: nthWeekdayUTC(y, 9, 1, 2) },
      { name: 'Veterans Day', day: isoToDay(y + '-11-11') },
      { name: 'Thanksgiving', day: nthWeekdayUTC(y, 10, 4, 4) },
      { name: 'Christmas', day: isoToDay(y + '-12-25') },
      { name: "New Year's", day: isoToDay(y + '-01-01') },
      { name: 'MLK Day', day: nthWeekdayUTC(y, 0, 1, 3) }
    ];
  }
  function holidayName(satISO) {
    var sat = isoToDay(satISO);
    if (sat == null) return null;
    var y = +satISO.slice(0, 4);
    var all = holidayList(y - 1).concat(holidayList(y), holidayList(y + 1));
    for (var i = 0; i < all.length; i++) {
      if (all[i].day != null && Math.abs(all[i].day - sat) <= 3) return all[i].name;
    }
    return null;
  }

  // ---------------------------------------------------------------- bands

  var BUCKETS = [[0, 9, 5], [10, 19, 15], [20, 34, 27], [35, 49, 42], [50, 69, 60], [70, 120, 90]];

  /**
   * Median + min/max per lead-time bucket, carrying the sample count and the
   * captures behind each point so the chart can say how thin a band is.
   */
  function bandFor(rows, fare) {
    fare = fare || function (r) { return r.low; };
    var out = [];
    BUCKETS.forEach(function (b) {
      var lo = b[0], hi = b[1], mid = b[2];
      var picked = rows.filter(function (r) { return r.days != null && r.days >= lo && r.days <= hi; });
      var vals = picked.map(fare).filter(function (v) { return Number.isFinite(v); }).sort(function (a, c) { return a - c; });
      if (!vals.length) return;
      out.push({
        x: mid, lo: lo, hi: hi,
        med: vals[Math.floor((vals.length - 1) / 2)],
        min: vals[0], max: vals[vals.length - 1],
        n: vals.length,
        captures: uniqueSorted(picked.map(function (r) { return r.captured; })).length
      });
    });
    return out;
  }

  // -------------------------------------------------------- floor forecast

  /**
   * Same model the dashboard always used — fare = floor + A·e^(−k·lead), fitted
   * by least squares on log residuals — but it now reports whether the data
   * can carry it, and refuses rather than printing a confident wrong number.
   *
   * `observedLow` is just the cheapest fare ever seen. It is NOT a forecast and
   * the caller must not label it one.
   */
  function fitFloor(points, opts) {
    opts = opts || {};
    var pts = (points || []).filter(function (p) {
      return p && Number.isFinite(p.days) && Number.isFinite(p.fare);
    });
    var captureCount = opts.captureCount == null
      ? uniqueSorted(pts.map(function (p) { return p.captured; })).length
      : opts.captureCount;

    // Collapse to the cheapest fare seen at each distinct lead time.
    var byLead = Object.create(null);
    pts.forEach(function (p) {
      if (byLead[p.days] == null || p.fare < byLead[p.days]) byLead[p.days] = p.fare;
    });
    var leads = Object.keys(byLead).map(Number).sort(function (a, b) { return a - b; });
    var n = leads.length;
    var observedLow = n ? Math.min.apply(null, leads.map(function (d) { return byLead[d]; })) : null;
    var span = n ? leads[n - 1] - leads[0] : 0;

    var base = {
      ok: false, reason: null, observedLow: observedLow,
      n: n, spanDays: span, captureCount: captureCount,
      floor: null, A: null, k: null, r2: null, bookBy: null
    };

    if (n < MIN_LEAD_POINTS) {
      base.reason = 'needs ' + MIN_LEAD_POINTS + ' distinct lead times, has ' + n;
      return base;
    }
    if (captureCount < MIN_FIT_CAPTURES) {
      base.reason = 'needs ' + MIN_FIT_CAPTURES + ' capture days, has ' + captureCount + ' — one morning is a snapshot, not a trend';
      return base;
    }
    if (span < MIN_FIT_SPAN_DAYS) {
      base.reason = 'lead times only span ' + span + ' days (needs ' + MIN_FIT_SPAN_DAYS + ')';
      return base;
    }

    var floor = observedLow;
    var xs = leads, ys = leads.map(function (d) { return Math.log(Math.max(byLead[d] - floor, 1)); });
    var sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (var i = 0; i < n; i++) { sx += xs[i]; sy += ys[i]; sxx += xs[i] * xs[i]; sxy += xs[i] * ys[i]; }
    var den = n * sxx - sx * sx;
    if (den === 0) { base.reason = 'all points share one lead time'; return base; }
    var b = (n * sxy - sx * sy) / den;
    var a = (sy - b * sx) / n;
    var A = Math.exp(a), k = -b;
    if (!Number.isFinite(A) || !Number.isFinite(k)) { base.reason = 'fit did not converge'; return base; }

    // R² measured on the fares themselves, not on the log residuals, so it
    // answers the question a reader actually has: how well does this curve
    // describe the observed prices?
    var actual = leads.map(function (d) { return byLead[d]; });
    var mean = actual.reduce(function (s, v) { return s + v; }, 0) / n;
    var ssTot = 0, ssRes = 0;
    for (var j = 0; j < n; j++) {
      var pred = floor + A * Math.exp(-k * xs[j]);
      ssRes += Math.pow(actual[j] - pred, 2);
      ssTot += Math.pow(actual[j] - mean, 2);
    }
    var r2 = ssTot === 0 ? 1 : 1 - ssRes / ssTot;
    base.floor = floor; base.A = A; base.k = k; base.r2 = r2;

    if (!(r2 >= MIN_FIT_R2)) {
      base.reason = 'fit explains only ' + Math.round(Math.max(r2, 0) * 100) + '% of the variation (needs ' + Math.round(MIN_FIT_R2 * 100) + '%)';
      return base;
    }

    if (k > 0.0008) {
      var dsx = Math.log(Math.max(A / 3, 1)) / k;
      base.bookBy = dsx > 7 ? '~' + Math.round(dsx / 7) + ' weeks ahead' : '~1 week ahead (drops fast)';
    } else {
      base.bookBy = 'stays flat — book anytime';
    }
    base.ok = true;
    return base;
  }

  // -------------------------------------------------------------- exports

  return {
    HEADER: HEADER_14, HEADER_LEGACY: HEADER_9, DIRECTIONS: DIRECTIONS, LEGS: LEGS,
    STALE_AFTER_DAYS: STALE_AFTER_DAYS, MIN_LEAD_POINTS: MIN_LEAD_POINTS,
    MIN_FIT_CAPTURES: MIN_FIT_CAPTURES, MIN_FIT_SPAN_DAYS: MIN_FIT_SPAN_DAYS, MIN_FIT_R2: MIN_FIT_R2,
    BUCKETS: BUCKETS,
    isoToDay: isoToDay, dayToISO: dayToISO, dowOfDay: dowOfDay, addDays: addDays,
    daysBetween: daysBetween, todayISO: todayISO,
    parseMoney: parseMoney, parseCount: parseCount, sumOrNull: sumOrNull,
    readRecords: readRecords, parseCSV: parseCSV,
    makeFareAccessor: makeFareAccessor,
    weekendKey: weekendKey, buildWeekends: buildWeekends, bookableWeekends: bookableWeekends,
    holidayName: holidayName, bandFor: bandFor, fitFloor: fitFloor
  };
});
