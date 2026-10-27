import ICAL from "ical.js";

// Feeds don't always ship a VTIMEZONE, and some exporters use Windows zone
// names. Register a known-good Europe/London under the names we expect.
const LONDON = `BEGIN:VCALENDAR
BEGIN:VTIMEZONE
TZID:Europe/London
BEGIN:DAYLIGHT
TZOFFSETFROM:+0000
TZOFFSETTO:+0100
TZNAME:BST
DTSTART:19700329T010000
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU
END:DAYLIGHT
BEGIN:STANDARD
TZOFFSETFROM:+0100
TZOFFSETTO:+0000
TZNAME:GMT
DTSTART:19701025T020000
RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU
END:STANDARD
END:VTIMEZONE
END:VCALENDAR`;

const londonComponent = new ICAL.Component(ICAL.parse(LONDON)).getFirstSubcomponent("vtimezone");
const londonZone = new ICAL.Timezone(londonComponent);
for (const name of ["Europe/London", "GMT Standard Time", "GMT", "Greenwich Mean Time"]) {
  ICAL.TimezoneService.register(londonZone, name);
}

const MAX_OCCURRENCES = 5000;

/** Parse ICS text into a list of ICAL.Event objects with exceptions attached. */
export function parseFeed(text) {
  let root;
  try {
    root = new ICAL.Component(ICAL.parse(text));
  } catch {
    throw new Error("Could not read calendar");
  }

  for (const tz of root.getAllSubcomponents("vtimezone")) {
    const id = tz.getFirstPropertyValue("tzid");
    if (id && !ICAL.TimezoneService.has(id)) ICAL.TimezoneService.register(tz);
  }

  const events = [];
  const byUid = new Map();
  const exceptions = [];
  for (const component of root.getAllSubcomponents("vevent")) {
    if (component.hasProperty("recurrence-id")) {
      exceptions.push(component);
      continue;
    }
    const event = new ICAL.Event(component);
    events.push(event);
    if (event.uid && !byUid.has(event.uid)) byUid.set(event.uid, event);
  }
  for (const component of exceptions) {
    const master = byUid.get(component.getFirstPropertyValue("uid"));
    if (master) master.relateException(component);
    else events.push(new ICAL.Event(component));
  }
  return events;
}

// Floating times and unknown TZIDs are taken to be UK time.
function toInstant(time) {
  const zone = time.zone;
  if (zone === ICAL.Timezone.utcTimezone || (zone && zone.component)) return time.toJSDate();
  const local = time.clone();
  local.zone = londonZone;
  return local.toJSDate();
}

function isCancelled(component) {
  return String(component.getFirstPropertyValue("status") || "").toUpperCase() === "CANCELLED";
}

function clean(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

/** Timed events overlapping [from, to), as absolute instants. All-day events are ignored. */
export function occurrencesBetween(events, from, to) {
  const out = [];
  const push = (component, startTime, endTime) => {
    if (startTime.isDate || isCancelled(component)) return;
    const start = toInstant(startTime);
    const end = toInstant(endTime);
    if (end <= start || end <= from || start >= to) return;
    out.push({
      start,
      end,
      title: clean(component.getFirstPropertyValue("summary")),
      location: clean(component.getFirstPropertyValue("location")),
    });
  };

  for (const event of events) {
    if (!event.startDate) continue;
    if (!event.isRecurring()) {
      push(event.component, event.startDate, event.endDate);
      continue;
    }
    const iterator = event.iterator();
    for (let i = 0, next; i < MAX_OCCURRENCES && (next = iterator.next()); i++) {
      const details = event.getOccurrenceDetails(next);
      if (toInstant(details.startDate) >= to) break;
      push(details.item.component, details.startDate, details.endDate);
    }
  }
  return out;
}
