import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFeed, occurrencesBetween } from "../lib/ics.js";
import { toDayPieces, addDays } from "../lib/london.js";

const wrap = (body) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:test\r\n${body}\r\nEND:VCALENDAR\r\n`;

function week(text, monday) {
  const from = new Date(`${addDays(monday, -1)}T00:00:00Z`);
  const to = new Date(`${addDays(monday, 8)}T00:00:00Z`);
  return occurrencesBetween(parseFeed(text), from, to).flatMap((o) =>
    toDayPieces(o.start, o.end, monday, addDays(monday, 6)).map((p) => ({ ...p, title: o.title })),
  );
}

test("UTC times are shown in BST during summer", () => {
  const ics = wrap(`BEGIN:VEVENT
UID:a
DTSTART:20261013T090000Z
DTEND:20261013T100000Z
SUMMARY:Lecture
END:VEVENT`);
  assert.deepEqual(week(ics, "2026-10-12"), [{ day: "2026-10-13", start: 600, end: 660, title: "Lecture" }]);
});

test("UTC times are shown in GMT in winter", () => {
  const ics = wrap(`BEGIN:VEVENT
UID:a
DTSTART:20261103T090000Z
DTEND:20261103T100000Z
SUMMARY:Lab
END:VEVENT`);
  assert.deepEqual(week(ics, "2026-11-02"), [{ day: "2026-11-03", start: 540, end: 600, title: "Lab" }]);
});

test("TZID without VTIMEZONE and floating times are treated as UK time", () => {
  const ics = wrap(`BEGIN:VEVENT
UID:a
DTSTART;TZID=Europe/London:20261013T090000
DTEND;TZID=Europe/London:20261013T100000
SUMMARY:A
END:VEVENT
BEGIN:VEVENT
UID:b
DTSTART;TZID=Somewhere/Unknown:20261014T110000
DTEND;TZID=Somewhere/Unknown:20261014T120000
SUMMARY:B
END:VEVENT
BEGIN:VEVENT
UID:c
DTSTART:20261015T140000
DTEND:20261015T150000
SUMMARY:C
END:VEVENT`);
  assert.deepEqual(week(ics, "2026-10-12"), [
    { day: "2026-10-13", start: 540, end: 600, title: "A" },
    { day: "2026-10-14", start: 660, end: 720, title: "B" },
    { day: "2026-10-15", start: 840, end: 900, title: "C" },
  ]);
});

test("weekly recurrence with an exception and a cancellation, across the clock change", () => {
  const ics = wrap(`BEGIN:VEVENT
UID:r
DTSTART;TZID=Europe/London:20261006T130000
DTEND;TZID=Europe/London:20261006T140000
RRULE:FREQ=WEEKLY;COUNT=6
EXDATE;TZID=Europe/London:20261020T130000
SUMMARY:Tutorial
END:VEVENT
BEGIN:VEVENT
UID:r
RECURRENCE-ID;TZID=Europe/London:20261027T130000
DTSTART;TZID=Europe/London:20261029T160000
DTEND;TZID=Europe/London:20261029T170000
SUMMARY:Tutorial (moved)
END:VEVENT`);
  assert.deepEqual(week(ics, "2026-10-19"), []);
  assert.deepEqual(week(ics, "2026-10-26"), [{ day: "2026-10-29", start: 960, end: 1020, title: "Tutorial (moved)" }]);
  assert.deepEqual(week(ics, "2026-11-02"), [{ day: "2026-11-03", start: 780, end: 840, title: "Tutorial" }]);
});

test("all-day and cancelled events are ignored", () => {
  const ics = wrap(`BEGIN:VEVENT
UID:a
DTSTART;VALUE=DATE:20261013
DTEND;VALUE=DATE:20261014
SUMMARY:Reading week
END:VEVENT
BEGIN:VEVENT
UID:b
STATUS:CANCELLED
DTSTART:20261013T090000Z
DTEND:20261013T100000Z
SUMMARY:Gone
END:VEVENT`);
  assert.deepEqual(week(ics, "2026-10-12"), []);
});

test("events crossing midnight are split", () => {
  const pieces = toDayPieces(new Date("2026-11-03T22:00:00Z"), new Date("2026-11-04T01:00:00Z"), "2026-11-02", "2026-11-08");
  assert.deepEqual(pieces, [
    { day: "2026-11-03", start: 1320, end: 1440 },
    { day: "2026-11-04", start: 0, end: 60 },
  ]);
});

test("rejects text that is not a calendar", () => {
  assert.throws(() => parseFeed("<html>nope</html>"));
});
