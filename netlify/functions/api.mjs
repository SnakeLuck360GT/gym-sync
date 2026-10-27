import { loadFeed, normaliseUrl, forgetFeed, UserError } from "../../lib/feeds.js";
import { occurrencesBetween } from "../../lib/ics.js";
import { addDays, isMonday, toDayPieces } from "../../lib/london.js";
import { createGroup, getGroup, updateGroup, isGroupId, newId, nextColour, MAX_MEMBERS } from "../../lib/store.js";

export const config = { path: "/api/*" };

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

const fail = (message, status = 400) => json({ error: message }, status);

// Links stay on the server; friends only ever receive names and events.
const publicMember = ({ id, name, colour }) => ({ id, name, colour });
const publicGroup = (group) => ({ id: group.id, members: group.members.map(publicMember) });

function cleanName(input) {
  const name = String(input || "").replace(/\s+/g, " ").trim();
  if (!name) throw new UserError("Add your name.");
  if (name.length > 24) throw new UserError("Keep your name under 24 characters.");
  return name;
}

async function readBody(req) {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

/** Validate a name and link, checking the link really is a readable calendar. */
async function newMember(body) {
  const name = cleanName(body.name);
  const url = normaliseUrl(body.url);
  await loadFeed(url, { fresh: true });
  return { id: newId(8), name, url, addedAt: new Date().toISOString() };
}

async function week(group, monday) {
  const sunday = addDays(monday, 6);
  // Pad by a day either side; pieces are clipped to the week in London time.
  const from = new Date(`${addDays(monday, -1)}T00:00:00Z`);
  const to = new Date(`${addDays(monday, 8)}T00:00:00Z`);

  const members = await Promise.all(
    group.members.map(async (member) => {
      try {
        const events = occurrencesBetween(await loadFeed(member.url), from, to)
          .flatMap(({ start, end, ...details }) =>
            toDayPieces(start, end, monday, sunday).map((piece) => ({ ...piece, ...details })),
          )
          .sort((a, b) => a.day.localeCompare(b.day) || a.start - b.start);
        return { ...publicMember(member), events };
      } catch {
        return { ...publicMember(member), events: [], error: true };
      }
    }),
  );
  return { start: monday, members };
}

async function route(req, parts) {
  const method = req.method;

  if (parts.length === 1 && method === "POST") {
    const member = await newMember(await readBody(req));
    const group = await createGroup(member);
    return json({ group: publicGroup(group), me: member.id }, 201);
  }

  const id = parts[1];
  if (!isGroupId(id || "")) return fail("Not found", 404);

  if (parts.length === 2 && method === "GET") {
    const group = await getGroup(id);
    return group ? json(publicGroup(group)) : fail("Not found", 404);
  }

  if (parts.length === 3 && parts[2] === "week" && method === "GET") {
    const start = new URL(req.url).searchParams.get("start") || "";
    if (!isMonday(start)) return fail("start must be a Monday (YYYY-MM-DD)");
    const group = await getGroup(id);
    if (!group) return fail("Not found", 404);
    return json(await week(group, start));
  }

  if (parts.length === 3 && parts[2] === "members" && method === "POST") {
    if (!(await getGroup(id))) return fail("Not found", 404);
    const member = await newMember(await readBody(req));
    const group = await updateGroup(id, (group) => {
      if (group.members.length >= MAX_MEMBERS) throw new UserError(`A group can have up to ${MAX_MEMBERS} people.`);
      if (group.members.some((m) => m.url === member.url)) throw new UserError("That timetable is already in this group.");
      group.members.push({ ...member, colour: nextColour(group.members) });
      return group;
    });
    return group ? json({ group: publicGroup(group), me: member.id }, 201) : fail("Not found", 404);
  }

  if (parts.length === 4 && parts[2] === "members" && method === "DELETE") {
    let removed;
    const group = await updateGroup(id, (group) => {
      removed = group.members.find((m) => m.id === parts[3]);
      group.members = group.members.filter((m) => m.id !== parts[3]);
      return group;
    });
    if (!group) return fail("Not found", 404);
    if (removed) await forgetFeed(removed.url);
    return json(publicGroup(group));
  }

  return fail("Not found", 404);
}

export default async (req) => {
  const parts = new URL(req.url).pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);
  if (parts[0] !== "groups") return fail("Not found", 404);
  try {
    return await route(req, parts);
  } catch (err) {
    if (err instanceof UserError) return fail(err.message);
    console.error(err);
    return fail("Something went wrong. Try again.", 500);
  }
};
