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

function sentenceCase(text) {
  return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
}

/**
 * Scientia summaries are codes like "COMP15111/LECTURE2/ <20-27>", but the
 * description carries "Key: value" lines with the module name and event
 * type. Prefer those, and fall back to the summary for other feeds.
 */
function describe(component) {
  const fields = {};
  for (const line of String(component.getFirstPropertyValue("description") || "").split("\n")) {
    const match = line.match(/^\s*([A-Za-z ]+):\s*(.*?)\s*$/);
    if (match) fields[match[1].toLowerCase()] = match[2];
  }
  const summary = clean(component.getFirstPropertyValue("summary")).replace(/\s*<[^>]*>$/, "");
  const type = clean(fields["event type"]);
  return {
    title: clean(fields.description) || summary,
    kind: type.length > 2 ? sentenceCase(type) : "",
    code: clean(fields["unit code"]) || (summary.match(/^[A-Z]{3,5}\d{4,5}/) || [""])[0],
    location: clean(component.getFirstPropertyValue("location") || fields.location).replace(/_/g, " "),
  };
}

// Recorded content with no fixed time doesn't stop anyone meeting up.
const NOT_BUSY = new Set(["Asynchronous"]);

/** Timed events overlapping [from, to), as absolute instants. All-day events are ignored. */
export function occurrencesBetween(events, from, to) {
  const out = [];
  const push = (component, startTime, endTime) => {
    if (startTime.isDate || isCancelled(component)) return;
    const start = toInstant(startTime);
    const end = toInstant(endTime);
    if (end <= start || end <= from || start >= to) return;
    const details = describe(component);
    if (NOT_BUSY.has(details.kind)) return;
    out.push({ start, end, ...details });
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
