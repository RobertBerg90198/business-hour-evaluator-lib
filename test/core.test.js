import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BusinessHourEvaluator } from '../src/index.js';

/**
 * Fake intl for deterministic tests. Maps an epoch to fixed local parts.
 * @param {number} epochMs
 * @param {string} timeZone
 */
function fakeIntl(parts) {
  return () => ({ ...parts });
}

function makeEvaluator(parts, config) {
  return new BusinessHourEvaluator({
    timeZone: 'UTC',
    morningStart: '09:00',
    morningEnd: '13:00',
    afternoonStart: '14:00',
    afternoonEnd: '17:00',
    ...config,
    intl: fakeIntl(parts),
  });
  // Note: `intl` is spread AFTER `config` so tests cannot accidentally
  // override the fake; we always control it.
}

function make(parts, configOverride) {
  const opts = {
    timeZone: 'UTC',
    morningStart: '09:00',
    morningEnd: '13:00',
    afternoonStart: '14:00',
    afternoonEnd: '17:00',
    ...configOverride,
    intl: fakeIntl(parts),
  };
  return new BusinessHourEvaluator(opts);
}

function P(hour, minute, second, weekday) {
  return { year: 2024, month: 1, day: 1, hour, minute, second, weekday };
}

// 1. Happy path: mid-morning on a weekday

test('returns true mid-morning on a weekday', () => {
  const e = make(P(10, 30, 0, 1)); // Monday 10:30
  assert.equal(e.isBusinessHour(0), true);
});

// 2. Weekend rejection

test('returns false on Saturday regardless of time', () => {
  const e = make(P(10, 30, 0, 6)); // Saturday
  assert.equal(e.isBusinessHour(0), false);
});

// 3. Sunday rejection

test('returns false on Sunday regardless of time', () => {
  const e = make(P(12, 0, 0, 0)); // Sunday noon
  assert.equal(e.isBusinessHour(0), false);
});

// 4. Lunch break excluded

test('returns false during lunch break (between sessions)', () => {
  const e = make(P(13, 30, 0, 1));
  assert.equal(e.isBusinessHour(0), false);
});

// 5. Before opening

test('returns false before morning start', () => {
  const e = make(P(8, 59, 59, 1));
  assert.equal(e.isBusinessHour(0), false);
});

// 6. After closing

test('returns false after afternoon end', () => {
  const e = make(P(17, 0, 1, 1));
  assert.equal(e.isBusinessHour(0), false);
});

// 7. Exact start inclusive

test('returns true exactly at morning start (inclusive)', () => {
  const e = make(P(9, 0, 0, 1));
  assert.equal(e.isBusinessHour(0), true);
});

// 8. Exact end inclusive

test('returns true exactly at afternoon end (inclusive)', () => {
  const e = make(P(17, 0, 0, 1));
  assert.equal(e.isBusinessHour(0), true);
});

// 9. Morning end inclusive (lunch boundary)

test('returns true exactly at morning end (boundary belongs to morning)', () => {
  const e = make(P(13, 0, 0, 1));
  assert.equal(e.isBusinessHour(0), true);
});

// 10. Afternoon start inclusive (lunch boundary)

test('returns true exactly at afternoon start (boundary belongs to afternoon)', () => {
  const e = make(P(14, 0, 0, 1));
  assert.equal(e.isBusinessHour(0), true);
});

// 11. Custom weekdays (e.g., Sun-Thu)

test('supports custom weekdays (Sun-Thu)', () => {
  const e = make(P(10, 0, 0, 0), { weekdays: [0, 1, 2, 3, 4] }); // Sunday
  assert.equal(e.isBusinessHour(0), true);
});

// 12. Invalid time string throws

test('throws on invalid time string', () => {
  assert.throws(
    () => make(P(10, 0, 0, 1), { morningStart: '25:00' }),
    /Time out of range/
  );
});

// 13. Overlapping lunch throws

test('throws when lunch overlaps morning (afternoonStart < morningEnd)', () => {
  assert.throws(
    () => make(P(10, 0, 0, 1), { morningEnd: '14:00', afternoonStart: '13:00' }),
    /afternoonStart must be >= morningEnd/
  );
});

// 14. Non-finite epoch throws

test('throws on non-finite epochMs', () => {
  const e = make(P(10, 0, 0, 1));
  assert.throws(() => e.isBusinessHour(NaN), /finite number/);
});
