// Timetables are read in UK time regardless of where the server runs.

const formatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

/** @returns {{ day: string, minutes: number }} day as YYYY-MM-DD, minutes since midnight */
export function toLondon(date) {
  const p = {};
  for (const { type, value } of formatter.formatToParts(date)) p[type] = value;
  return { day: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}

export function addDays(day, n) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function isMonday(day) {
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && new Date(`${day}T00:00:00Z`).getUTCDay() === 1;
}

/**
 * Split an interval into per-day pieces in London time, keeping only days
 * between firstDay and lastDay inclusive.
 */
export function toDayPieces(start, end, firstDay, lastDay) {
  const a = toLondon(start);
  const b = toLondon(end);
  const from = a.day > firstDay ? a.day : firstDay;
  const to = b.day < lastDay ? b.day : lastDay;
  const pieces = [];
  for (let day = from; day <= to; day = addDays(day, 1)) {
    const s = day === a.day ? a.minutes : 0;
    const e = day === b.day ? b.minutes : 1440;
    if (e > s) pieces.push({ day, start: s, end: e });
  }
  return pieces;
}
