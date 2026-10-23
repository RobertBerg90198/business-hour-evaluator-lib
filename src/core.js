/**
 * Business Hour Evaluator core logic.
 *
 * Design decisions:
 *
 * 1. DST handling is delegated to the environment's Intl API (via a custom
 *    IntlLike abstraction). Rather than bundling a timezone database, we use
 *    `Intl.DateTimeFormat` with `timeZone` set to the IANA name. This is
 *    available in Node and modern browsers. The trade-off: the environment
 *    must have a reasonably complete tz database. For containerised Node,
 *    this is the default.
 *
 * 2. A lunch break splits the morning and afternoon sessions. A timestamp
 *    inside the lunch break is NOT business hours — lunch is an exclusion,
 *    not a session.
 *
 * 3. Inclusive comparisons are used on session boundaries so that a moment
 *    exactly at 09:00:00 is business hours and exactly at 13:00:00 (end of
 *    morning) is also business hours. The lunch break runs (13:00, 14:00)
 *    exclusive of both ends — so 13:00:00 is still open (morning's close),
 *    14:00:00 is open again (afternoon's start).
 *
 * 4. The evaluator takes a clock function? No — the evaluator works on an
 *    explicit timestamp argument. Determinism is preserved because the
 *    caller supplies the timestamp. The README's example shows this.
 */

/**
 * Returns the local date/time parts for a UTC ms epoch in the given IANA
 * timezone. Abstracted so tests can inject a fake.
 *
 * @typedef {(epochMs: number, timeZone: string) => {year:number, month:number, day:number, hour:number, minute:number, second:number, weekday:number}} IntlLike
 */

/**
 * @param {number} epochMs
 * @param {string} timeZone
 * @returns {{year:number, month:number, day:number, hour:number, minute:number, second:number, weekday:number}}
 */
function defaultIntl(epochMs, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
    weekday: 'short',
  });
  const parts = dtf.formatToParts(new Date(epochMs));
  const map = {};
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = p.value;
  }
  const weekdayMap = { Sun:0, Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6 };
  let hour = parseInt(map.hour, 10);
  // hour12:false can produce '24' at midnight in some engines.
  if (hour === 24) hour = 0;
  return {
    year: parseInt(map.year, 10),
    month: parseInt(map.month, 10),
    day: parseInt(map.day, 10),
    hour,
    minute: parseInt(map.minute, 10),
    second: parseInt(map.second, 10),
    weekday: weekdayMap[map.weekday],
  };
}

/**
 * Convert local parts to seconds-of-day.
 * @param {number} hour
 * @param {number} minute
 * @param {number} second
 */
function toSeconds(hour, minute, second) {
  return hour * 3600 + minute * 60 + second;
}

/**
 * Parse an "HH:MM" time string to seconds-of-day.
 * @param {string} s
 * @returns {number}
 */
function parseTime(s) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) throw new Error(`Invalid time string: ${s}`);
  const h = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  if (h < 0 || h > 23 || mm < 0 || mm > 59) {
    throw new Error(`Time out of range: ${s}`);
  }
  return toSeconds(h, mm, 0);
}

/**
 * Validates and normalises session config.
 * @param {object} cfg
 * @returns {{morningStart:number, morningEnd:number, afternoonStart:number, afternoonEnd:number, weekdays:Set<number>}}
 */
function normaliseConfig(cfg) {
  const morningStart = parseTime(cfg.morningStart);
  const morningEnd = parseTime(cfg.morningEnd);
  const afternoonStart = parseTime(cfg.afternoonStart);
  const afternoonEnd = parseTime(cfg.afternoonEnd);

  if (morningEnd < morningStart) {
    throw new Error('morningEnd must be >= morningStart');
  }
  if (afternoonEnd < afternoonStart) {
    throw new Error('afternoonEnd must be >= afternoonStart');
  }
  if (afternoonStart < morningEnd) {
    throw new Error('afternoonStart must be >= morningEnd (lunch must not overlap morning)');
  }

  const weekdays = new Set(cfg.weekdays.map(Number));
  for (const d of weekdays) {
    if (d < 0 || d > 6) throw new Error(`Invalid weekday: ${d}`);
  }

  return { morningStart, morningEnd, afternoonStart, afternoonEnd, weekdays };
}

export class BusinessHourEvaluator {
  /**
   * @param {object} opts
   * @param {string} opts.timeZone IANA timezone, e.g. "Europe/London".
   * @param {string} opts.morningStart e.g. "09:00".
   * @param {string} opts.morningEnd e.g. "13:00" (start of lunch).
   * @param {string} opts.afternoonStart e.g. "14:00" (end of lunch).
   * @param {string} opts.afternoonEnd e.g. "17:00".
   * @param {number[]} opts.weekdays 0=Sun..6=Sat. Default Mon-Fri=[1,2,3,4,5].
   * @param {IntlLike} [intl] Injected for testing.
   */
  constructor(opts) {
    if (!opts || typeof opts !== 'object') {
      throw new Error('opts is required');
    }
    if (!opts.timeZone || typeof opts.timeZone !== 'string') {
      throw new Error('opts.timeZone is required');
    }
    const cfg = normaliseConfig({
      morningStart: opts.morningStart,
      morningEnd: opts.morningEnd,
      afternoonStart: opts.afternoonStart,
      afternoonEnd: opts.afternoonEnd,
      weekdays: opts.weekdays ?? [1, 2, 3, 4, 5],
    });
    this.timeZone = opts.timeZone;
    this.config = cfg;
    this._intl = opts.intl ?? defaultIntl;
  }

  /**
   * Returns true if the given epoch-millis timestamp falls within defined
   * business hours in the configured timezone.
   *
   * @param {number} epochMs
   * @returns {boolean}
   */
  isBusinessHour(epochMs) {
    if (typeof epochMs !== 'number' || !Number.isFinite(epochMs)) {
      throw new Error('epochMs must be a finite number');
    }
    const parts = this._intl(epochMs, this.timeZone);
    if (!this.config.weekdays.has(parts.weekday)) return false;
    const s = toSeconds(parts.hour, parts.minute, parts.second);
    const c = this.config;
    // Morning session: [morningStart, morningEnd]
    if (s >= c.morningStart && s <= c.morningEnd) return true;
    // Afternoon session: [afternoonStart, afternoonEnd]
    if (s >= c.afternoonStart && s <= c.afternoonEnd) return true;
    return false;
  }
}
