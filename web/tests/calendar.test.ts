import assert from "node:assert/strict";
import test from "node:test";
import { MAX_CALENDAR_BYTES, parseCalendar } from "../app/calendar.ts";

const NOW = new Date("2026-08-17T12:00:00Z");

function calendar(...body: string[]) {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Howbout Companion Tests//EN",
    ...body,
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}

test("recurring events preserve their real DTSTART weekday and time", () => {
  const events = parseCalendar(calendar(
    "BEGIN:VEVENT",
    "UID:weekly-plan",
    "DTSTART:20260818T183000Z",
    "DTEND:20260818T193000Z",
    "RRULE:FREQ=WEEKLY;COUNT=3",
    "SUMMARY:Weekly plan",
    "END:VEVENT",
  ), NOW);

  assert.deepEqual(events.map((event) => event.start), [
    "2026-08-18T18:30:00.000Z",
    "2026-08-25T18:30:00.000Z",
    "2026-09-01T18:30:00.000Z",
  ]);
});

test("recurrence exceptions stay UID-scoped and cancelled events stay hidden", () => {
  const events = parseCalendar(calendar(
    "BEGIN:VEVENT",
    "UID:alpha",
    "DTSTART:20260818T183000Z",
    "DTEND:20260818T193000Z",
    "RRULE:FREQ=WEEKLY;COUNT=3",
    "SUMMARY:Alpha",
    "COLOR:#abc",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:beta",
    "DTSTART:20260818T183000Z",
    "DTEND:20260818T193000Z",
    "RRULE:FREQ=WEEKLY;COUNT=3",
    "SUMMARY:Beta",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:alpha",
    "RECURRENCE-ID:20260825T183000Z",
    "DTSTART:20260825T203000Z",
    "DTEND:20260825T213000Z",
    "SUMMARY:Alpha moved",
    "COLOR:url(https://tracker.invalid/pixel)",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:beta",
    "RECURRENCE-ID:20260825T183000Z",
    "DTSTART:20260825T183000Z",
    "DTEND:20260825T193000Z",
    "STATUS:CANCELLED",
    "SUMMARY:Beta cancelled",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:cancelled-master",
    "DTSTART:20260820T120000Z",
    "DTEND:20260820T130000Z",
    "STATUS:CANCELLED",
    "SUMMARY:Do not show",
    "END:VEVENT",
  ), NOW);

  assert.deepEqual(events.map(({ title, start }) => [title, start]), [
    ["Alpha", "2026-08-18T18:30:00.000Z"],
    ["Beta", "2026-08-18T18:30:00.000Z"],
    ["Alpha moved", "2026-08-25T20:30:00.000Z"],
    ["Alpha", "2026-09-01T18:30:00.000Z"],
    ["Beta", "2026-09-01T18:30:00.000Z"],
  ]);
  assert.equal(events[0].color, "#abc");
  assert.match(events.find((event) => event.title === "Alpha moved")?.color ?? "", /^#[0-9a-f]+$/i);
});

test("embedded VTIMEZONE data is applied before dates are converted", () => {
  const events = parseCalendar(calendar(
    "BEGIN:VTIMEZONE",
    "TZID:Custom/Plus2",
    "BEGIN:STANDARD",
    "DTSTART:19700101T000000",
    "TZOFFSETFROM:+0200",
    "TZOFFSETTO:+0200",
    "TZNAME:UTC+2",
    "END:STANDARD",
    "END:VTIMEZONE",
    "BEGIN:VEVENT",
    "UID:timezone-plan",
    "DTSTART;TZID=Custom/Plus2:20260818T183000",
    "DTEND;TZID=Custom/Plus2:20260818T193000",
    "SUMMARY:Timezone plan",
    "END:VEVENT",
  ), NOW);

  assert.equal(events[0].start, "2026-08-18T16:30:00.000Z");
  assert.equal(events[0].end, "2026-08-18T17:30:00.000Z");
});

test("oversized and excessively recurring calendars fail with controlled errors", () => {
  assert.throws(
    () => parseCalendar("x".repeat(MAX_CALENDAR_BYTES + 1), NOW),
    /too large to import/i,
  );

  assert.throws(
    () => parseCalendar(calendar(
      "BEGIN:VEVENT",
      "UID:minute-plan",
      "DTSTART:20260817T120000Z",
      "DTEND:20260817T120100Z",
      "RRULE:FREQ=MINUTELY;COUNT=10001",
      "SUMMARY:Minute plan",
      "END:VEVENT",
    ), NOW),
    /too many/i,
  );
});
