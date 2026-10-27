import { createHash } from "node:crypto";
import { getStore } from "@netlify/blobs";
import { parseFeed } from "./ics.js";

/** An error whose message is safe to show to the person who caused it. */
export class UserError extends Error {}

const FRESH_MS = 15 * 60 * 1000;
const MAX_BYTES = 10 * 1024 * 1024;
const memory = new Map();

// The last good copy of each feed is kept so a slow or broken university
// server doesn't blank everyone's timetable.
const copies = () => getStore("feeds");
const keyFor = (url) => createHash("sha256").update(url).digest("hex");

export function normaliseUrl(input) {
  let text = String(input || "").trim();
  if (!text) throw new UserError("Paste your timetable link.");
  text = text.replace(/^webcals?:\/\//i, "https://");
  if (!/^[a-z]+:\/\//i.test(text)) text = `https://${text}`;

  let url;
  try {
    url = new URL(text);
  } catch {
    throw new UserError("That doesn't look like a link.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new UserError("That doesn't look like a link.");
  }
  const host = url.hostname;
  if (process.env.ALLOW_LOCAL_FEEDS === "1") return url.toString();
  if (
    host === "localhost" ||
    !host.includes(".") ||
    /^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) ||
    host.startsWith("[")
  ) {
    throw new UserError("That link can't be used.");
  }
  return url.toString();
}

async function download(url) {
  let res;
  try {
    res = await fetch(url, {
      headers: { accept: "text/calendar, text/plain;q=0.9, */*;q=0.5" },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new UserError("Couldn't reach that link. Check you copied all of it.");
  }
  if (!res.ok) {
    throw new UserError(
      res.status === 404 || res.status === 410
        ? "That link no longer works. Copy a fresh one from your timetable."
        : "The timetable server didn't respond properly. Try again in a minute.",
    );
  }
  const text = await res.text();
  if (text.length > MAX_BYTES || !text.includes("BEGIN:VCALENDAR")) {
    throw new UserError("That link isn't a calendar feed. It should be the iCal link, usually ending in .ics.");
  }
  return text;
}

/** Fetch and parse a feed, using cached copies where possible. */
export async function loadFeed(url, { fresh = false } = {}) {
  const hit = memory.get(url);
  if (!fresh && hit && Date.now() - hit.at < FRESH_MS) return hit.events;

  try {
    const text = await download(url);
    const events = parseFeed(text);
    memory.set(url, { at: Date.now(), events });
    await copies().set(keyFor(url), text).catch(() => {});
    return events;
  } catch (err) {
    if (fresh) throw err instanceof UserError ? err : new UserError("Couldn't read that calendar.");
    if (hit) return hit.events;
    const copy = await copies().get(keyFor(url)).catch(() => null);
    if (copy) {
      const events = parseFeed(copy);
      // Retry the live feed in a minute rather than in fifteen.
      memory.set(url, { at: Date.now() - FRESH_MS + 60_000, events });
      return events;
    }
    throw err;
  }
}

export async function forgetFeed(url) {
  memory.delete(url);
  await copies().delete(keyFor(url)).catch(() => {});
}
