import { getStore } from "@netlify/blobs";

const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
export const MAX_MEMBERS = 12;
export const COLOURS = 8;

const groups = () => getStore({ name: "groups", consistency: "strong" });

export function newId(length = 10) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}

export const isGroupId = (id) => /^[a-z0-9]{10}$/.test(id);

export function nextColour(members) {
  const used = new Set(members.map((m) => m.colour));
  for (let i = 0; i < COLOURS; i++) if (!used.has(i)) return i;
  return members.length % COLOURS;
}

export async function createGroup(member) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const group = { id: newId(), createdAt: new Date().toISOString(), members: [{ ...member, colour: 0 }] };
    const { modified } = await groups().setJSON(group.id, group, { onlyIfNew: true });
    if (modified) return group;
  }
  throw new Error("Could not allocate a group id");
}

export async function getGroup(id) {
  return groups().get(id, { type: "json" });
}

/**
 * Apply `change` to a group with optimistic locking so two friends joining at
 * the same moment don't overwrite each other. `change` may throw to abort.
 */
export async function updateGroup(id, change) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const current = await groups().getWithMetadata(id, { type: "json" });
    if (!current) return null;
    const next = change(structuredClone(current.data));
    const { modified } = await groups().setJSON(id, next, { onlyIfMatch: current.etag });
    if (modified) return next;
  }
  throw new Error("Group is busy, try again");
}
