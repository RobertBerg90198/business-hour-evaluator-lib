# business-hour-evaluator-lib

Determines whether a given UTC epoch-millis timestamp falls within defined business hours for a specific IANA timezone, accounting for a lunch break and configurable weekdays.

## Usage

```js
import { BusinessHourEvaluator } from 'business-hour-evaluator-lib';

const evaluator = new BusinessHourEvaluator({
  timeZone: 'Europe/London',
  morningStart: '09:00',
  morningEnd: '13:00',     // end of morning / start of lunch
  afternoonStart: '14:00', // end of lunch / start of afternoon
  afternoonEnd: '17:00',
  weekdays: [1, 2, 3, 4, 5], // Mon-Fri, 0=Sun..6=Sat
});

const isOpen = evaluator.isBusinessHour(Date.now());
```

## Why this exists

Most "is the office open" checks are ad-hoc: they hard-code an offset, ignore DST, or treat lunch as just another open block. This library exists to give one place where the rules live, where DST is handled by the environment's `Intl.DateTimeFormat` (so no bundled timezone database is needed), and where lunch is an exclusion rather than a session.

The trade-off: the environment must ship a usable tz database. That is the default for containerised Node, but exotic or stripped-down runtimes may not have it.

## The awkward edge

Session boundaries are inclusive on both ends. `09:00:00` is open; `13:00:00` (morning end) is still open; `14:00:00` (afternoon start) is open again. The gap `(13:00, 14:00)` is lunch and is closed. If your definition of lunch must include one of those boundary seconds, you need to adjust the session times rather than the library.

Weekdays are integers `0..6` where `0` is Sunday (matching JavaScript's `Date.prototype.getDay`).
