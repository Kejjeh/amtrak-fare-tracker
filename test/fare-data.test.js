/*
 * Regression suite for the fare-log trust layer. Runs on the Node built-in
 * test runner, no dependencies:
 *
 *     node --test test/
 *
 * Every test here started life as a reproduction of a defect in the shipped
 * dashboard; the comment on each block says what used to happen.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const FD = require('../js/fare-data.js');

const FIX = path.join(__dirname, 'fixtures');
const fixture = (name) => fs.readFileSync(path.join(FIX, name), 'utf8');
// Pinned so the suite does not change meaning as the calendar moves.
const TODAY = '2026-09-18';
const parse = (text, opts) => FD.parseCSV(text, Object.assign({ today: TODAY }, opts));
const parseFix = (name, opts) => parse(fixture(name), opts);
const reasonsAt = (res, line) =>
  (res.rejected.find((r) => r.line === line) || { reasons: [] }).reasons.join(' | ');

// --------------------------------------------------------------- dates ----

test('isoToDay is strict and rejects impossible dates', () => {
  assert.equal(FD.isoToDay('2026-07-25'), Math.round(Date.UTC(2026, 6, 25) / 86400000));
  for (const bad of ['', '   ', 'not-a-date', '2026-13-45', '2026-02-30', '2026-7-25',
    '25/07/2026', '2026-07-25T00:00:00', '20260725', null, undefined]) {
    assert.equal(FD.isoToDay(bad), null, `expected ${JSON.stringify(bad)} to be rejected`);
  }
});

test('leap day is accepted in a leap year and rejected otherwise', () => {
  assert.notEqual(FD.isoToDay('2028-02-29'), null);
  assert.equal(FD.isoToDay('2026-02-29'), null);
});

// Was: weekendKey() built a Date at LOCAL midnight then serialised it with
// toISOString() (UTC), so every weekend shifted back a day east of Greenwich.
test('weekendKey is identical in every timezone', () => {
  const zones = ['UTC', 'America/New_York', 'America/Los_Angeles', 'Europe/Berlin',
    'Asia/Tokyo', 'Asia/Kolkata', 'Pacific/Kiritimati', 'Pacific/Pago_Pago'];
  const script = `
    const FD = require(${JSON.stringify(path.join(__dirname, '..', 'js', 'fare-data.js'))});
    const res = FD.parseCSV(require('fs').readFileSync(${JSON.stringify(path.join(FIX, 'tz-boundary.csv'))}, 'utf8'), {today: '${TODAY}'});
    console.log(JSON.stringify(res.rows.map(FD.weekendKey)));`;
  const baseline = ['2026-10-31', '2026-10-31', '2026-10-31', '2026-12-26', '2026-12-26',
    '2027-01-02', '2027-01-02'];
  for (const tz of zones) {
    const got = JSON.parse(execFileSync(process.execPath, ['-e', script], {
      env: Object.assign({}, process.env, { TZ: tz })
    }).toString());
    assert.deepEqual(got, baseline, `weekend keys drifted under TZ=${tz}`);
  }
});

test('weekend keys survive month-end, year-end and DST boundaries', () => {
  const res = parseFix('tz-boundary.csv');
  assert.equal(res.rejected.length, 0);
  const weekends = FD.buildWeekends(res.rows, { today: TODAY });
  const keys = weekends.map((w) => w.key);
  assert.deepEqual(keys, ['2026-10-31', '2026-12-26', '2027-01-02']);
  // The Sunday of the Oct 31 weekend falls in November; the pairing must cross
  // the month boundary rather than splitting the weekend in two.
  const oct = weekends[0];
  assert.equal(oct.sunISO, '2026-11-01');
  assert.equal(oct.latest.rt, 40);
  // Fri 2027-01-01 pairs with Sun 2027-01-03 across the year boundary.
  assert.equal(weekends[2].latest.rt, 35);
  assert.equal(weekends[2].holiday, "New Year's");
});

// --------------------------------------------------------------- money ----

// Was: parseFloat('$57') -> NaN, the row passed the `low != null` filter, and
// NaN spread into FLOOR, the chart y-axis (Math.max(90, NaN) === NaN) and KPIs.
test('currency parsing never yields NaN', () => {
  assert.deepEqual(FD.parseMoney('57'), { ok: true, value: 57 });
  assert.deepEqual(FD.parseMoney(' 57.50 '), { ok: true, value: 57.5 });
  assert.deepEqual(FD.parseMoney('$57'), { ok: true, value: 57 });
  assert.deepEqual(FD.parseMoney('1,234.50'), { ok: true, value: 1234.5 });
  for (const bad of ['n/a', '$', '57abc', '1e3', '-5', '57.', '.5', '5.005', '--1', 'NaN', 'Infinity']) {
    assert.equal(FD.parseMoney(bad).ok, false, `expected ${bad} to be rejected`);
    assert.equal(FD.parseMoney(bad).value, null);
  }
});

// Was: a blank cell and a zero were indistinguishable once summed.
test('a blank cell is missing, not zero', () => {
  assert.deepEqual(FD.parseMoney(''), { ok: true, value: null });
  assert.deepEqual(FD.parseMoney('   '), { ok: true, value: null });
  assert.deepEqual(FD.parseCount(''), { ok: true, value: null });
  assert.equal(FD.sumOrNull([35, null]), null);
  assert.equal(FD.sumOrNull([35, undefined]), null);
  assert.equal(FD.sumOrNull([35, NaN]), null);
  assert.equal(FD.sumOrNull([35, 20]), 55);
  assert.equal(FD.sumOrNull([35, 0]), 35);   // a real zero still sums
});

test('every accepted row carries finite numbers or nulls, never NaN', () => {
  const res = parseFix('healthy.csv');
  for (const r of res.rows) {
    for (const k of ['low', 'sens', 'next', 'acela', 'seats', 'days']) {
      assert.ok(r[k] === null || Number.isFinite(r[k]), `${k} was ${r[k]} on line ${r.line}`);
    }
  }
});

// ----------------------------------------------------------- CSV reading --

// Was: split(',') shifted every column after a quoted field, so days_ahead was
// silently read as the fare.
test('quoted fields are parsed, not split blindly', () => {
  const res = parseFix('quoted.csv');
  assert.equal(res.ok, true);
  assert.equal(res.rows.length, 2);
  const sat = res.rows.find((r) => r.dow === 'Sat');
  assert.equal(sat.low, 15);
  assert.equal(sat.days, 12);
  assert.equal(sat.dir, 'NHV-BOS');
  // The row whose direction really did contain a comma is rejected by name,
  // not absorbed into the next column.
  assert.match(reasonsAt(res, 4), /direction is not NHV-BOS or BOS-NHV/);
});

test('embedded quotes, CRLF and a BOM are handled', () => {
  const header = FD.HEADER.join(',');
  const body = '2026-09-14,2026-09-26,Sat,NHV-BOS,12,15,,20,71,,,,,';
  const res = parse('\uFEFF' + header + '\r\n' + body + '\r\n');
  assert.equal(res.ok, true);
  assert.equal(res.rows.length, 1);
  const quoted = FD.readRecords('a,"b""c",d\n');
  assert.deepEqual(quoted.records[0].fields, ['a', 'b"c', 'd']);
  const unterminated = FD.readRecords('a,"b\n');
  assert.match(unterminated.error, /unterminated quoted field/);
});

// Was: parseCSV('') threw a TypeError that the fetch handler swallowed and
// reported as "Auto-load unavailable (opened via file://)".
test('empty, whitespace-only and header-only files fail clearly instead of throwing', () => {
  const empty = parseFix('empty.csv');
  assert.equal(empty.ok, false);
  assert.match(empty.error, /empty/i);

  const ws = parseFix('whitespace-only.csv');
  assert.equal(ws.ok, false);
  assert.match(ws.error, /empty/i);

  const headerOnly = parseFix('header-only.csv');
  assert.equal(headerOnly.ok, true, 'a header with no rows is a valid but empty log');
  assert.equal(headerOnly.rows.length, 0);
  assert.equal(headerOnly.stats.dataRecords, 0);
});

test('a wrong header is named, not guessed at', () => {
  const res = parseFix('bad-header.csv');
  assert.equal(res.ok, false);
  assert.match(res.error, /header/i);
  assert.match(res.error, /captured_date/);
  assert.equal(res.rows.length, 0);
});

test('the legacy 9-column header still loads', () => {
  const res = parseFix('legacy-9col.csv');
  assert.equal(res.ok, true);
  assert.equal(res.width, 9);
  assert.equal(res.rows.length, 2);
  assert.equal(res.rows[0].sens, null, 'time-aware columns are absent, not zero');
  assert.equal(res.rows[0].ldep, null);
});

test('binary junk is rejected as a header problem, not charted', () => {
  const res = parse('\u0000\u0001garbage\n\u0002\u0003');
  assert.equal(res.ok, false);
  assert.equal(res.rows.length, 0);
});

// ------------------------------------------------------- row validation ---

test('malformed rows are each rejected with a reason and a line number', () => {
  const res = parseFix('malformed.csv');
  assert.equal(res.ok, true, 'the header is fine, so the file loads');
  assert.equal(res.rows.length, 2, 'only the two well-formed rows survive');
  assert.equal(res.stats.dataRecords, 17);
  assert.equal(res.rejected.length, 15);

  assert.match(reasonsAt(res, 2), /lowest_coach_usd is not a currency value/);
  assert.match(reasonsAt(res, 3), /lowest_coach_usd is not a currency value/);
  assert.match(reasonsAt(res, 4), /lowest_coach_usd is blank/);
  assert.match(reasonsAt(res, 5), /travel_date is not a real/);
  assert.match(reasonsAt(res, 6), /travel_date is not a real/);
  assert.match(reasonsAt(res, 7), /travel_date is not a real/);
  assert.match(reasonsAt(res, 8), /days_ahead 999 disagrees/);
  assert.match(reasonsAt(res, 9), /day_of_week "Fri" does not match/);
  assert.match(reasonsAt(res, 10), /direction is not NHV-BOS or BOS-NHV/);
  assert.match(reasonsAt(res, 11), /lowest_coach_usd must be greater than 0/);
  assert.match(reasonsAt(res, 12), /seats_at_lowest is not blank or a whole number/);
  assert.match(reasonsAt(res, 13), /sensible_coach_usd 12 is below lowest_coach_usd 15/);
  assert.match(reasonsAt(res, 14), /lowest_depart is not blank or a time/);
  assert.match(reasonsAt(res, 15), /expected 14 fields, found 3/);
  assert.match(reasonsAt(res, 16), /expected 14 fields, found 16/);

  // Every rejection is attributable.
  for (const r of res.rejected) {
    assert.ok(Number.isInteger(r.line) && r.line >= 2);
    assert.ok(r.reasons.length > 0);
  }
});

// Was: a malformed travel_date reached weekendKey and threw a RangeError that
// took the whole render down.
test('a malformed date can no longer crash weekend keying', () => {
  const res = parseFix('malformed.csv');
  assert.doesNotThrow(() => res.rows.map(FD.weekendKey));
  assert.doesNotThrow(() => FD.buildWeekends(res.rows, { today: TODAY }));
  // Directly, too: the helper returns null rather than throwing.
  assert.equal(FD.weekendKey({ travel: '2026-13-45', dow: 'Sat' }), null);
  assert.equal(FD.weekendKey({ travel: '', dow: 'Sat' }), null);
});

// Was: travel_date before captured_date, and a future captured_date, were both
// accepted and charted at a negative lead time.
test('chronology is enforced in both directions', () => {
  const past = parseFix('past-travel.csv');
  assert.match(reasonsAt(past, 2), /travel_date 2026-09-05 is before captured_date 2026-09-18/);

  const future = parseFix('future-capture.csv');
  assert.match(reasonsAt(future, 2), /captured_date 2027-01-01 is in the future/);
  assert.equal(future.rows.length, 2);
});

test('days_ahead is derived from the dates, never trusted', () => {
  const header = FD.HEADER.join(',');
  const res = parse(header + '\n2026-09-14,2026-09-26,Sat,NHV-BOS,12,15,,20,71,,,,,\n');
  assert.equal(res.rows[0].days, 12);
  assert.equal(res.rows[0].days, FD.daysBetween('2026-09-14', '2026-09-26'));
});

test('same-day capture (zero lead time) is valid', () => {
  const res = parseFix('malformed.csv');
  const sameDay = res.rows.find((r) => r.days === 0);
  assert.ok(sameDay, 'a fare captured on the travel date is legitimate');
  assert.equal(sameDay.captured, sameDay.travel);
});

// Was: pairing keyed on day_of_week alone, so a Sunday NHV-BOS outbound was
// summed in as the return leg.
test('off-pattern legs are excluded from pairing and reported separately', () => {
  const res = parseFix('off-pattern.csv');
  assert.equal(res.rows.length, 2);
  assert.equal(res.stats.offPattern, 3);
  assert.equal(res.stats.malformed, 0);
  assert.match(reasonsAt(res, 2), /Sun NHV-BOS is not a weekend out-and-back leg/);
  assert.match(reasonsAt(res, 3), /Sat BOS-NHV is not a weekend out-and-back leg/);
  assert.match(reasonsAt(res, 4), /Wed NHV-BOS is not a weekend out-and-back leg/);
  assert.deepEqual(res.rows.map((r) => r.leg), ['out', 'ret']);
});

// Was: duplicate captures double-counted into medians and sample counts.
test('duplicate captures collapse to one observation, last row wins', () => {
  const res = parseFix('duplicates.csv');
  assert.equal(res.stats.dataRecords, 4);
  assert.equal(res.rows.length, 2);
  assert.equal(res.duplicates.length, 2);
  const out = res.rows.find((r) => r.dir === 'NHV-BOS');
  assert.equal(out.low, 35, 'the later row supersedes the earlier one');
  assert.equal(res.duplicates[0].changed, true);
  assert.equal(res.duplicates[1].changed, false);
  assert.equal(res.duplicates[0].supersedes, 2);
});

test('deduplication keeps band sample counts honest', () => {
  const res = parseFix('duplicates.csv');
  const band = FD.bandFor(res.rows, (r) => r.low);
  assert.equal(band.reduce((s, p) => s + p.n, 0), 2);
});

// ----------------------------------------------------------- round trips --

// Was: rebuildRT keyed on day_of_week, required a Saturday row to exist, and
// seasonData summed legs captured on different mornings.
test('a round trip needs both directions from the same capture', () => {
  const res = parseFix('missing-legs.csv');
  const w = FD.buildWeekends(res.rows, { today: TODAY });
  const by = Object.fromEntries(w.map((x) => [x.key, x]));

  assert.equal(by['2026-09-26'].latest, null);
  assert.match(by['2026-09-26'].incompleteReason, /no Sunday return logged/);

  assert.equal(by['2026-10-03'].latest, null);
  assert.match(by['2026-10-03'].incompleteReason, /no Friday or Saturday outbound logged/);

  // Friday + Sunday with no Saturday is a complete round trip.
  assert.equal(by['2026-10-10'].latest.rt, 53);
  assert.equal(by['2026-10-10'].latest.out.dow, 'Fri');
  assert.deepEqual(by['2026-10-10'].missingLegs, ['Sat']);

  // Legs that only ever appeared on different mornings never form a total.
  assert.equal(by['2026-10-17'].latest, null);
  assert.match(by['2026-10-17'].incompleteReason, /no single capture saw both/);
});

test('a round-trip total is never assembled from a missing leg', () => {
  const header = FD.HEADER.join(',');
  // Sunday return row with a blank fare is rejected outright, so the Saturday
  // outbound cannot be presented as a round trip on its own.
  const res = parse(header +
    '\n2026-09-18,2026-09-26,Sat,NHV-BOS,8,35,,,,,,,,' +
    '\n2026-09-18,2026-09-27,Sun,BOS-NHV,9,,,,,,,,,\n');
  assert.equal(res.rows.length, 1);
  const w = FD.buildWeekends(res.rows, { today: TODAY });
  assert.equal(w[0].latest, null);
  assert.equal(w.every((x) => x.latest === null || Number.isFinite(x.latest.rt)), true);
});

test('each weekend quote reports the single capture it came from', () => {
  const res = parseFix('healthy.csv');
  const w = FD.buildWeekends(res.rows, { today: TODAY });
  for (const wk of w) {
    if (!wk.latest) continue;
    assert.equal(wk.latest.out.captured, wk.latest.captured);
    assert.equal(wk.latest.ret.captured, wk.latest.captured);
    assert.equal(wk.latest.rt, wk.latest.out.fare + wk.latest.ret.fare);
  }
});

test('the cheaper of Friday and Saturday becomes the outbound leg', () => {
  const header = FD.HEADER.join(',');
  const res = parse(header +
    '\n2026-09-18,2026-09-25,Fri,NHV-BOS,7,25,,,,,,,,' +
    '\n2026-09-18,2026-09-26,Sat,NHV-BOS,8,60,,,,,,,,' +
    '\n2026-09-18,2026-09-27,Sun,BOS-NHV,9,20,,,,,,,,\n');
  const w = FD.buildWeekends(res.rows, { today: TODAY });
  assert.equal(w[0].latest.out.dow, 'Fri');
  assert.equal(w[0].latest.rt, 45);
});

// ------------------------------------------------- staleness / bookability -

// Was: KPIs, the recommendation card and the scarcity table all used the
// latest capture without checking whether the trip had already departed.
test('a departed weekend is never bookable', () => {
  const res = parseFix('past-travel.csv');
  const w = FD.buildWeekends(res.rows, { today: TODAY });
  const gone = w.find((x) => x.key === '2026-09-12');
  assert.equal(gone.travelPast, true);
  assert.equal(gone.bookable, false);
  assert.ok(gone.latest, 'the historical quote is retained, just not sold as bookable');

  const ahead = w.find((x) => x.key === '2026-09-26');
  assert.equal(ahead.travelPast, false);
  assert.equal(ahead.bookable, true);

  assert.deepEqual(FD.bookableWeekends(w).map((x) => x.key), ['2026-09-26']);
});

// Was: the stale banner appeared but every price below it still read as a
// live, bookable quote.
test('an old snapshot is marked stale even though the travel date is ahead', () => {
  const res = parseFix('stale.csv');
  assert.equal(res.stats.latestCapture, '2026-08-01');
  assert.equal(res.stats.latestCaptureAgeDays, 48);

  const w = FD.buildWeekends(res.rows, { today: TODAY });
  assert.equal(w[0].latest.ageDays, 48);
  assert.equal(w[0].latest.stale, true);
  assert.equal(w[0].travelPast, false, 'the trip is still ahead');
  assert.equal(w[0].bookable, false, 'but a 48-day-old price is not a bookable one');
});

test('a fresh capture is not stale', () => {
  const res = parseFix('healthy.csv');
  assert.equal(res.stats.latestCaptureAgeDays, 0);
  const w = FD.buildWeekends(res.rows, { today: TODAY });
  assert.equal(w[0].latest.stale, false);
  assert.equal(w[0].bookable, true);
});

test('the stale cutoff is the documented one', () => {
  const header = FD.HEADER.join(',');
  const mk = (cap) => parse(header +
    `\n${cap},2026-10-24,Sat,NHV-BOS,${FD.daysBetween(cap, '2026-10-24')},35,,,,,,,,` +
    `\n${cap},2026-10-25,Sun,BOS-NHV,${FD.daysBetween(cap, '2026-10-25')},20,,,,,,,,\n`);
  const at = (cap) => FD.buildWeekends(mk(cap).rows, { today: TODAY })[0].latest;
  assert.equal(at('2026-09-16').ageDays, 2);
  assert.equal(at('2026-09-16').stale, false, '2 days old is still current');
  assert.equal(at('2026-09-15').ageDays, 3);
  assert.equal(at('2026-09-15').stale, true, '3 days old is stale');
});

// ---------------------------------------------------------- floor fitting -

// Was: three lead times from a single morning produced a confident "Modeled
// floor" and a "book by" recommendation.
test('a sparse log cannot produce a floor forecast', () => {
  const res = parseFix('sparse.csv');
  const outbound = res.rows.filter((r) => r.leg === 'out');
  const fit = FD.fitFloor(outbound.map((r) => ({ days: r.days, fare: r.low, captured: r.captured })));
  assert.equal(fit.ok, false);
  assert.ok(fit.reason, 'a suppressed forecast always says why');
  assert.equal(fit.floor, null, 'no modeled floor is published');
  assert.equal(fit.observedLow, 20, 'the observed low is still reported, as an observation');
});

test('one capture day is never enough, however many lead times it has', () => {
  const pts = [];
  for (let i = 0; i < 12; i++) pts.push({ days: 7 + i * 7, fare: 20 + 60 * Math.exp(-0.035 * (7 + i * 7)), captured: '2026-09-18' });
  const fit = FD.fitFloor(pts);
  assert.equal(fit.ok, false);
  assert.match(fit.reason, /capture days/);
});

test('too narrow a lead-time span is rejected', () => {
  const pts = [1, 2, 3, 4, 5, 6].map((d) => ({ days: d, fare: 40 - d, captured: d % 2 ? '2026-09-17' : '2026-09-18' }));
  const fit = FD.fitFloor(pts);
  assert.equal(fit.ok, false);
  assert.match(fit.reason, /span/);
});

test('a curve that does not describe the prices is suppressed', () => {
  // Fares that fall overall (so the model's premise holds and the k gate
  // passes) but scatter far too widely for the curve to describe them.
  const noisy = [7, 20, 34, 48, 62, 76, 90].map((d, i) => ({
    days: d, fare: [95, 30, 88, 32, 80, 28, 25][i], captured: i % 2 ? '2026-09-17' : '2026-09-18'
  }));
  const fit = FD.fitFloor(noisy);
  assert.equal(fit.ok, false);
  assert.ok(fit.k > 0, 'this fixture must reach the R-squared gate, not the trend gate');
  assert.match(fit.reason, /explains only \d+% of the variation/);
  assert.ok(fit.r2 < FD.MIN_FIT_R2);
});

// Was: a log where fares RISE with lead time fitted the exponential almost
// perfectly (k = -0.108, R2 = 0.998) and was published as
// "stays flat - book anytime" - a buy-now instruction drawn from data saying
// the opposite of what the model claims to describe.
test('a curve where fares rise toward departure is refused, however well it fits', () => {
  const rising = [
    { days: 10, fare: 40, captured: '2026-08-01' }, { days: 20, fare: 42, captured: '2026-08-01' },
    { days: 30, fare: 48, captured: '2026-09-01' }, { days: 40, fare: 64, captured: '2026-09-01' },
    { days: 50, fare: 105, captured: '2026-09-01' }
  ];
  const fit = FD.fitFloor(rising);
  assert.ok(fit.k < 0, 'fixture really does trend the wrong way');
  assert.ok(fit.r2 > 0.9, 'and the curve really does fit it well');
  assert.equal(fit.ok, false, 'a well-fitting wrong-direction curve must still be refused');
  assert.match(fit.reason, /rise rather than fall/);
  assert.equal(fit.bookBy, null);
});

// Was: a log where every fare is identical scored R2 = 1 through the
// `ssTot === 0 ? 1` shortcut and published "book anytime". Zero variance means
// the model explained nothing, not that it explained everything.
test('a log with no price variation is not scored as a perfect fit', () => {
  const flat = [10, 20, 30, 40, 50].map((d, i) => ({
    days: d, fare: 50, captured: i < 2 ? '2026-08-01' : '2026-09-01'
  }));
  const fit = FD.fitFloor(flat);
  assert.equal(fit.ok, false);
  assert.match(fit.reason, /no variation to model/);
  assert.equal(fit.bookBy, null);
});

// Was: every published fit ended in an imperative ("book anytime") even when
// the model found no lead-time effect at all.
test('no published fit phrases itself as an instruction to buy', () => {
  const decaying = [7, 21, 35, 49, 63, 77].map((d, i) => ({
    days: d, fare: [90, 62, 45, 36, 32, 30][i], captured: i % 2 ? '2026-09-17' : '2026-09-18'
  }));
  const fit = FD.fitFloor(decaying);
  assert.equal(fit.ok, true, fit.reason || '');
  assert.doesNotMatch(fit.bookBy, /book anytime/i);
});

test('a well-supported decaying curve is published, with its fit quality', () => {
  const res = parseFix('healthy.csv');
  const outbound = res.rows.filter((r) => r.leg === 'out');
  const fit = FD.fitFloor(outbound.map((r) => ({ days: r.days, fare: r.low, captured: r.captured })));
  assert.equal(fit.ok, true, fit.reason || '');
  assert.ok(fit.n >= FD.MIN_LEAD_POINTS);
  assert.ok(fit.captureCount >= FD.MIN_FIT_CAPTURES);
  assert.ok(fit.spanDays >= FD.MIN_FIT_SPAN_DAYS);
  assert.ok(fit.r2 >= FD.MIN_FIT_R2 && fit.r2 <= 1);
  assert.ok(fit.k > 0, 'fares fall as lead time grows');
  assert.ok(typeof fit.bookBy === 'string' && fit.bookBy.length);
});

test('fitFloor tolerates empty and degenerate input', () => {
  for (const input of [[], null, undefined, [{ days: NaN, fare: 5 }], [{ days: 5, fare: NaN }]]) {
    const fit = FD.fitFloor(input);
    assert.equal(fit.ok, false);
    assert.equal(fit.floor, null);
  }
  const flat = FD.fitFloor([5, 5, 5, 5, 5, 5].map((d) => ({ days: d, fare: 20, captured: '2026-09-18' })));
  assert.equal(flat.ok, false);
});

// ---------------------------------------------------------------- bands ---

test('bands report how many observations and captures back each point', () => {
  const res = parseFix('healthy.csv');
  const band = FD.bandFor(res.rows.filter((r) => r.dow === 'Sat'), (r) => r.low);
  assert.ok(band.length >= 3);
  for (const p of band) {
    assert.ok(p.n >= 1);
    assert.ok(p.captures >= 1 && p.captures <= 3);
    assert.ok(p.min <= p.med && p.med <= p.max);
    assert.ok(Number.isFinite(p.min) && Number.isFinite(p.max));
  }
});

test('bands skip rows with no fare rather than counting them as zero', () => {
  const rows = [{ days: 5, low: 15 }, { days: 5, low: null }, { days: 5, low: 45 }];
  const band = FD.bandFor(rows, (r) => r.low);
  assert.equal(band[0].n, 2);
  assert.equal(band[0].min, 15);
  assert.equal(band[0].max, 45);
});

// ------------------------------------------------------ the real fare log --

test('the committed fare log parses clean', () => {
  const real = fs.readFileSync(path.join(__dirname, '..', 'data', 'amtrak_fare_log.csv'), 'utf8');
  const res = parse(real);
  assert.equal(res.ok, true, res.error || '');
  assert.equal(res.stats.malformed, 0, JSON.stringify(res.rejected.slice(0, 3), null, 2));
  assert.equal(res.stats.duplicates, 0);
  assert.ok(res.rows.length > 0);
  // It is a historical log: captured in July, so nothing in it is bookable now.
  const w = FD.buildWeekends(res.rows, { today: TODAY });
  assert.equal(FD.bookableWeekends(w).every((x) => x.bookable === false), true,
    'a two-month-old capture must not be presented as bookable');
});

test('the accessor honours the fare basis without inventing a value', () => {
  const sensible = FD.makeFareAccessor('sensible');
  const absolute = FD.makeFareAccessor('absolute');
  assert.equal(sensible({ low: 15, sens: 43 }), 43);
  assert.equal(sensible({ low: 15, sens: null }), 15, 'falls back when no sensible fare exists');
  assert.equal(absolute({ low: 15, sens: 43 }), 15);
  assert.equal(sensible({ low: null, sens: null }), null);
  assert.equal(sensible({ low: NaN, sens: null }), null);
});


// ----------------------------------------------- departed legs & bookability

// Was: `travelPast` only asked whether the SUNDAY return had gone, so on a
// Saturday morning a Friday-out + Sunday-back total from a fresh capture was
// still flagged bookable, charted as a green "Bookable RT" bar and offered by
// the recommendation card as "good to book". The Friday train had left.
test('a round trip whose outbound has already travelled is not bookable', () => {
  const res = parseFix('departed-outbound.csv', { today: '2026-09-19' });
  const weekends = FD.buildWeekends(res.rows, { today: '2026-09-19' });
  const gone = weekends.find((w) => w.key === '2026-09-19');

  assert.equal(gone.travelPast, false, 'the Sunday return has not gone yet');
  assert.equal(gone.latest.rt, 60, 'the pair is still priced, as history');
  assert.equal(gone.latest.stale, false, 'and the capture is fresh');
  assert.equal(gone.departed, true);
  assert.equal(gone.latest.departedLeg, 'Fri');
  assert.equal(gone.bookable, false, 'but you cannot buy a train that has left');
});

test('bookableWeekends excludes departed and stale quotes; pricedWeekends keeps them labelled', () => {
  const res = parseFix('departed-outbound.csv', { today: '2026-09-19' });
  const weekends = FD.buildWeekends(res.rows, { today: '2026-09-19' });

  const priced = FD.pricedWeekends(weekends).map((w) => w.key);
  const bookable = FD.bookableWeekends(weekends).map((w) => w.key);
  assert.deepEqual(priced, ['2026-09-19', '2026-10-03'], 'both are still priced');
  assert.deepEqual(bookable, ['2026-10-03'], 'only the intact one is bookable');
});

// Was: bookableWeekends() filtered on `!travelPast` alone, so it happily
// returned a weekend whose own `bookable` flag the same library had set false
// for staleness. Nothing that calls itself "bookable" may disagree with that.
test('nothing bookableWeekends returns ever contradicts its own bookable flag', () => {
  for (const name of ['healthy.csv', 'stale.csv', 'departed-outbound.csv', 'sparse.csv', 'missing-legs.csv']) {
    for (const today of ['2026-09-18', '2026-09-19', '2026-10-05']) {
      const res = parseFix(name, { today });
      const weekends = FD.buildWeekends(res.rows, { today });
      for (const w of FD.bookableWeekends(weekends)) {
        assert.equal(w.bookable, true, `${name} @ ${today}: ${w.key}`);
        assert.equal(w.travelPast, false, `${name} @ ${today}: ${w.key} already happened`);
        assert.equal(w.latest.stale, false, `${name} @ ${today}: ${w.key} is stale`);
        assert.equal(w.latest.departed, false, `${name} @ ${today}: ${w.key} has departed`);
      }
    }
  }
});

// A train departing later today may or may not still be catchable; the library
// cannot know the clock time, so it must surface the doubt rather than resolve
// it silently in either direction.
test('an outbound travelling today is flagged, not silently sold or dropped', () => {
  const res = parseFix('departed-outbound.csv', { today: '2026-09-18' });
  const w = FD.buildWeekends(res.rows, { today: '2026-09-18' }).find((x) => x.key === '2026-09-19');
  assert.equal(w.departed, false);
  assert.equal(w.departsToday, true);
  assert.equal(w.bookable, true, 'still offered');
});

// ------------------------------------------------- fare / train provenance

// Was: legDetail fell back to lowest_train/lowest_depart whenever the sensible
// train columns were blank, so a $68 sensible-hours fare was displayed as
// departing 9:47p on train #2151 - the train that actually sold the $21 seat.
test('a fare is never labelled with a train that did not sell it', () => {
  const res = parseFix('sensible-no-train.csv', { today: '2026-09-19' });
  const w = FD.buildWeekends(res.rows, { today: '2026-09-19', mode: 'sensible' })[0];

  assert.equal(w.latest.out.fare, 68, 'the sensible fare is the one shown');
  assert.equal(w.latest.out.train, null, 'and it carries no train number at all');
  assert.equal(w.latest.out.depart, null, 'nor the 9:47p time of the cheap train');
  assert.equal(w.latest.out.trainUnknown, true, 'the gap is reported, not papered over');
});

test('the lowest-fare train is still shown on the absolute basis', () => {
  const res = parseFix('sensible-no-train.csv', { today: '2026-09-19' });
  const w = FD.buildWeekends(res.rows, { today: '2026-09-19', mode: 'absolute' })[0];
  assert.equal(w.latest.out.fare, 21);
  assert.equal(w.latest.out.train, '2151');
  assert.equal(w.latest.out.depart, '9:47p');
  assert.equal(w.latest.out.trainUnknown, false);
});

test('a train number is reused only when both fares are the same number', () => {
  const res = parseFix('departed-outbound.csv', { today: '2026-09-19' });
  const w = FD.buildWeekends(res.rows, { today: '2026-09-19', mode: 'sensible' })
    .find((x) => x.key === '2026-10-03');
  assert.equal(w.latest.out.fare, 44);
  assert.equal(w.latest.out.train, '2155', 'sensible train logged, so it is shown');
  assert.equal(w.latest.out.trainUnknown, false);
});
