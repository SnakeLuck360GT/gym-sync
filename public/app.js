const app = document.getElementById("app");

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DEFAULT_PREFS = { from: 9 * 60, to: 18 * 60, min: 30 };

/* ---------- Dates, always in UK time ---------- */

const londonFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

function londonNow() {
  const p = {};
  for (const { type, value } of londonFormat.formatToParts(new Date())) p[type] = value;
  return { day: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}

function addDays(day, n) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const weekday = (day) => (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7;
const mondayOf = (day) => addDays(day, -weekday(day));
const dayOfMonth = (day) => Number(day.slice(8));
const monthOf = (day) => MONTHS[Number(day.slice(5, 7)) - 1];

function time(minutes) {
  const h = Math.floor(minutes / 60) % 24;
  return `${h}:${String(minutes % 60).padStart(2, "0")}`;
}

function duration(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

function weekRange(monday) {
  const friday = addDays(monday, 4);
  return monthOf(monday) === monthOf(friday)
    ? `${dayOfMonth(monday)}–${dayOfMonth(friday)} ${monthOf(friday)}`
    : `${dayOfMonth(monday)} ${monthOf(monday)} – ${dayOfMonth(friday)} ${monthOf(friday)}`;
}

/* ---------- Free time ---------- */

function sharedFree(busy, from, to, min) {
  const spans = busy
    .map((e) => [Math.max(e.start, from), Math.min(e.end, to)])
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0]);
  const free = [];
  let cursor = from;
  for (const [s, e] of spans) {
    if (s > cursor) free.push([cursor, s]);
    cursor = Math.max(cursor, e);
  }
  if (to > cursor) free.push([cursor, to]);
  return free.filter(([s, e]) => e - s >= min);
}

/* ---------- Storage and network ---------- */

const saved = {
  get(key, fallback) {
    try {
      const value = localStorage.getItem(`frees:${key}`);
      return value == null ? fallback : JSON.parse(value);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      if (value == null) localStorage.removeItem(`frees:${key}`);
      else localStorage.setItem(`frees:${key}`, JSON.stringify(value));
    } catch {}
  },
};

async function api(path, { method = "GET", body } = {}) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error("You seem to be offline. Try again.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data.error || "Something went wrong. Try again.");
    error.status = res.status;
    throw error;
  }
  return data;
}

/* ---------- DOM helpers ---------- */

function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value == null || value === false) continue;
    if (key.startsWith("on")) el.addEventListener(key.slice(2), value);
    else if (key === "class") el.className = value;
    else if (key === "style") el.style.cssText = value;
    else el.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children.flat()) {
    if (child != null && child !== false) el.append(child);
  }
  return el;
}

const icons = {
  prev: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12.5 4.5 7 10l5.5 5.5"/></svg>',
  next: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7.5 4.5 13 10l-5.5 5.5"/></svg>',
  close: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="m5 5 10 10M15 5 5 15"/></svg>',
};

function iconButton(name, label, onclick) {
  const button = h("button", { class: "icon-button", type: "button", "aria-label": label, onclick });
  button.innerHTML = icons[name];
  return button;
}

let toastTimer;
function toast(message) {
  document.querySelector(".toast")?.remove();
  clearTimeout(toastTimer);
  const el = h("div", { class: "toast", role: "status" }, message);
  document.body.append(el);
  toastTimer = setTimeout(() => el.remove(), 2200);
}

function openSheet(title, ...content) {
  const dialog = h(
    "dialog",
    { class: "sheet", "aria-label": title },
    h("div", { class: "sheet-head" }, h("h2", {}, title), iconButton("close", "Close", () => dialog.close())),
    ...content,
  );
  dialog.addEventListener("click", (e) => {
    if (e.target === dialog) dialog.close();
  });
  dialog.addEventListener("close", () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
  return dialog;
}

let fieldCount = 0;

/* ---------- Shared form ---------- */

function memberForm({ submitLabel, onSubmit }) {
  const name = h("input", {
    name: "name",
    autocomplete: "given-name",
    autocapitalize: "words",
    maxlength: 24,
    enterkeyhint: "next",
  });
  const url = h("input", {
    name: "url",
    type: "text",
    inputmode: "url",
    autocomplete: "off",
    autocapitalize: "off",
    autocorrect: "off",
    spellcheck: "false",
    placeholder: "https://…/timetable.ics",
    enterkeyhint: "go",
  });

  const urlWrap = h("div", { class: "input-wrap" }, url);
  if (navigator.clipboard?.readText) {
    url.classList.add("has-action");
    urlWrap.append(
      h(
        "button",
        {
          class: "input-action",
          type: "button",
          onclick: async () => {
            try {
              url.value = (await navigator.clipboard.readText()).trim();
            } catch {
              url.focus();
            }
          },
        },
        "Paste",
      ),
    );
  }

  const help = h(
    "details",
    { class: "help" },
    h("summary", {}, "Where do I find this?"),
    h(
      "p",
      {},
      "In My Manchester, open your timetable and look for the option to subscribe or sync it to a calendar. Copy the iCal link it gives you. It usually ends in ",
      h("code", {}, ".ics"),
      ".",
    ),
    h("p", {}, "If your timetable is already in Google or Apple Calendar, it's the same link."),
  );

  const error = h("p", { class: "error", role: "alert" });
  const submit = h("button", { class: "button primary", type: "submit" }, submitLabel);

  name.id = `field-${++fieldCount}`;
  url.id = `field-${++fieldCount}`;

  return h(
    "form",
    {
      class: "form",
      novalidate: true,
      onsubmit: async (e) => {
        e.preventDefault();
        error.textContent = "";
        if (!name.value.trim()) {
          error.textContent = "Add your name.";
          return name.focus();
        }
        if (!url.value.trim()) {
          error.textContent = "Paste your timetable link.";
          return url.focus();
        }
        submit.disabled = true;
        submit.textContent = "Checking your timetable…";
        try {
          await onSubmit({ name: name.value, url: url.value });
        } catch (err) {
          error.textContent = err.message;
          submit.disabled = false;
          submit.textContent = submitLabel;
        }
      },
    },
    h("div", { class: "field" }, h("label", { for: name.id }, "Your name"), name),
    h("div", { class: "field" }, h("label", { for: url.id }, "Timetable link"), urlWrap, help),
    error,
    submit,
  );
}

/* ---------- Home ---------- */

function renderHome() {
  document.title = "Frees";
  app.replaceChildren(
    h(
      "main",
      { class: "page home" },
      h("header", { class: "bar" }, h("a", { class: "wordmark", href: "/" }, "Frees")),
      h("h1", {}, "See when you're all free."),
      h(
        "p",
        { class: "lede" },
        "Add your University of Manchester timetable, send the link to your friends, and Frees finds the gaps you have in common.",
      ),
      memberForm({
        submitLabel: "Create group",
        onSubmit: async (body) => {
          const { group, me } = await api("/groups", { method: "POST", body });
          saved.set(`me:${group.id}`, me);
          location.assign(`/g/${group.id}`);
        },
      }),
      h("p", { class: "note" }, "Your link stays private. Friends see your classes, never the link itself."),
    ),
  );
}

/* ---------- Group ---------- */

function startGroup(id) {
  const prefs = { ...DEFAULT_PREFS, ...saved.get("prefs", {}) };
  const now = londonNow();
  // Once today's window has passed, start on tomorrow; at the weekend, on Monday.
  let firstDay = now.minutes >= prefs.to ? addDays(now.day, 1) : now.day;
  if (weekday(firstDay) >= 5) firstDay = addDays(mondayOf(firstDay), 7);

  const state = {
    id,
    group: null,
    missing: false,
    me: saved.get(`me:${id}`, null),
    hidden: new Set(saved.get(`hidden:${id}`, [])),
    prefs,
    week: mondayOf(firstDay),
    day: firstDay,
    weeks: new Map(),
    editing: false,
  };

  const isMember = () => state.group?.members.some((m) => m.id === state.me);

  function loadWeek(start) {
    const existing = state.weeks.get(start);
    if (existing && !existing.error) return;
    const entry = { loading: true };
    state.weeks.set(start, entry);
    api(`/groups/${id}/week?start=${start}`)
      .then((data) => Object.assign(entry, { loading: false, data }))
      .catch((err) => Object.assign(entry, { loading: false, error: err.message }))
      .finally(() => {
        if (start === state.week) {
          render();
          if (!entry.error) loadWeek(addDays(start, 7));
        }
      });
  }

  function reloadAll() {
    state.weeks.clear();
    loadWeek(state.week);
  }

  async function loadGroup() {
    try {
      state.group = await api(`/groups/${id}`);
      if (state.me && !isMember()) {
        state.me = null;
        saved.set(`me:${id}`, null);
      }
    } catch (err) {
      if (err.status === 404) state.missing = true;
      else toast(err.message);
    }
    render();
  }

  function goToDay(day) {
    state.day = day;
    const monday = mondayOf(day);
    if (monday !== state.week) {
      state.week = monday;
      loadWeek(monday);
    }
    render();
  }

  function stepDay(direction) {
    const days = visibleDays();
    const index = days.indexOf(state.day);
    const next = days[index + direction];
    if (next) return goToDay(next);
    goToDay(direction > 0 ? addDays(state.week, 7) : addDays(state.week, -3));
  }

  function stepWeek(direction) {
    goToDay(addDays(state.week, 7 * direction + Math.min(weekday(state.day), 4)));
  }

  function visibleDays() {
    const data = state.weeks.get(state.week)?.data;
    const days = [0, 1, 2, 3, 4].map((i) => addDays(state.week, i));
    for (const i of [5, 6]) {
      const day = addDays(state.week, i);
      const used = data?.members.some((m) => m.events.some((e) => e.day === day));
      if (used || day === state.day) days.push(day);
    }
    return days;
  }

  function included(members) {
    return members.filter((m) => !state.hidden.has(m.id));
  }

  function freeFor(data, day) {
    const people = included(data.members).filter((m) => !m.error);
    if (!people.length) return [];
    const busy = people.flatMap((m) => m.events.filter((e) => e.day === day));
    return sharedFree(busy, state.prefs.from, state.prefs.to, state.prefs.min);
  }

  /* --- actions --- */

  async function share() {
    const url = `${location.origin}/g/${id}`;
    if (navigator.share && matchMedia("(pointer: coarse)").matches) {
      try {
        await navigator.share({ title: "Frees", text: "Add your timetable so we can see when we're all free.", url });
      } catch {}
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      toast("Link copied");
    } catch {
      prompt("Copy this link", url);
    }
  }

  function openAdd() {
    const sheet = openSheet(
      "Add your timetable",
      memberForm({
        submitLabel: "Add timetable",
        onSubmit: async (body) => {
          const { group, me } = await api(`/groups/${id}/members`, { method: "POST", body });
          state.group = group;
          state.me = me;
          saved.set(`me:${id}`, me);
          sheet.close();
          toast("You're in");
          reloadAll();
          render();
        },
      }),
    );
  }

  function toggle(member) {
    if (state.hidden.has(member.id)) state.hidden.delete(member.id);
    else state.hidden.add(member.id);
    saved.set(`hidden:${id}`, [...state.hidden]);
    render();
  }

  async function remove(member) {
    const label = member.id === state.me ? "Remove your timetable from this group?" : `Remove ${member.name} from this group?`;
    if (!confirm(label)) return;
    try {
      state.group = await api(`/groups/${id}/members/${member.id}`, { method: "DELETE" });
      if (member.id === state.me) {
        state.me = null;
        saved.set(`me:${id}`, null);
      }
      if (state.group.members.length === 0) state.editing = false;
      reloadAll();
      render();
    } catch (err) {
      toast(err.message);
    }
  }

  function openPrefs() {
    const hours = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => (from + i) * 60);
    const select = (label, key, options, format, wide) =>
      h(
        "label",
        { class: wide ? "select wide" : "select" },
        label,
        h(
          "select",
          {
            onchange: (e) => {
              state.prefs[key] = Number(e.target.value);
              saved.set("prefs", state.prefs);
              render();
            },
          },
          options.map((value) => h("option", { value, selected: value === state.prefs[key] }, format(value))),
        ),
      );

    openSheet(
      "Free time settings",
      h(
        "div",
        { class: "selects" },
        select("From", "from", hours(6, 13), time),
        select("Until", "to", hours(14, 23), time),
        select("Shortest gap", "min", [15, 30, 45, 60, 90, 120], (m) => `${duration(m)} or longer`, true),
      ),
    );
  }

  function openEvent(member, event) {
    openSheet(
      event.title || "Busy",
      h(
        "div",
        { class: "rows" },
        h(
          "div",
          { class: "row" },
          h("span", { class: "row-label" }, "Who"),
          h("span", { class: "dot", style: `--c: var(--m${member.colour})` }),
          member.name,
        ),
        h(
          "div",
          { class: "row tabular" },
          h("span", { class: "row-label" }, "When"),
          `${DAY_NAMES[weekday(event.day)]} ${dayOfMonth(event.day)} ${monthOf(event.day)}, ${time(event.start)}–${time(event.end)}`,
        ),
        event.location && h("div", { class: "row" }, h("span", { class: "row-label" }, "Where"), event.location),
        (event.kind || event.code) &&
          h("div", { class: "row" }, h("span", { class: "row-label" }, "What"), [event.kind, event.code].filter(Boolean).join(" · ")),
      ),
    );
  }

  /* --- views --- */

  function header() {
    return h(
      "header",
      { class: "bar" },
      h("a", { class: "wordmark", href: "/" }, "Frees"),
      h("button", { class: "button", type: "button", onclick: share }, "Share link"),
    );
  }

  function callout() {
    const members = state.group.members;
    if (!isMember()) {
      const names = members.map((m) => m.name);
      const who = names.length > 2 ? `${names.slice(0, 2).join(", ")} and ${names.length - 2} more` : names.join(" and ");
      return h(
        "div",
        { class: "callout" },
        h("p", {}, members.length ? `Add your timetable to see when you're free with ${who}.` : "Add your timetable to get started."),
        h("button", { class: "button primary", type: "button", onclick: openAdd }, "Add my timetable"),
      );
    }
    if (members.length === 1) {
      return h(
        "div",
        { class: "callout" },
        h("p", {}, "Send this link to your friends. Once they add their timetables, your shared free time shows up here."),
        h("button", { class: "button primary", type: "button", onclick: share }, "Share link"),
      );
    }
    return null;
  }

  function people(data) {
    const errors = new Set(data?.members.filter((m) => m.error).map((m) => m.id));
    const chips = state.group.members.map((member) => {
      const off = state.hidden.has(member.id);
      const classes = ["chip", off && !state.editing && "off", errors.has(member.id) && "warn", state.editing && "removing"];
      return h(
        "button",
        {
          class: classes.filter(Boolean).join(" "),
          type: "button",
          style: `--c: var(--m${member.colour})`,
          "aria-pressed": state.editing ? null : String(!off),
          "aria-label": state.editing ? `Remove ${member.name}` : null,
          onclick: () => (state.editing ? remove(member) : toggle(member)),
        },
        h("span", { class: "dot" }),
        h("span", { class: "chip-name" }, member.name),
        state.editing && h("span", { "aria-hidden": "true" }, "×"),
      );
    });

    const controls = state.editing
      ? [h("button", { class: "chip quiet", type: "button", onclick: () => ((state.editing = false), render()) }, "Done")]
      : [
          isMember() && h("button", { class: "chip", type: "button", onclick: openAdd }, "+ Add"),
          state.group.members.length > 0 &&
            h("button", { class: "chip quiet", type: "button", onclick: () => ((state.editing = true), render()) }, "Edit"),
        ];

    return h("div", { class: "people" }, chips, controls);
  }

  function weekNav() {
    const thisWeek = mondayOf(londonNow().day);
    const offset = Math.round((Date.parse(state.week) - Date.parse(thisWeek)) / (7 * 864e5));
    const label = { 0: "This week", 1: "Next week", [-1]: "Last week" }[offset] ?? `Week of ${dayOfMonth(state.week)} ${monthOf(state.week)}`;
    return h(
      "nav",
      { class: "week", "aria-label": "Week" },
      iconButton("prev", "Previous week", () => stepWeek(-1)),
      h("div", { class: "week-label" }, h("strong", {}, label), h("span", { class: "tabular" }, weekRange(state.week))),
      iconButton("next", "Next week", () => stepWeek(1)),
    );
  }

  function dayTabs(data) {
    const today = londonNow().day;
    return h(
      "div",
      { class: "days", role: "group", "aria-label": "Day" },
      visibleDays().map((day) => {
        const free = data ? freeFor(data, day).reduce((sum, [s, e]) => sum + e - s, 0) : null;
        return h(
          "button",
          {
            class: day === today ? "day today" : "day",
            type: "button",
            "aria-pressed": String(day === state.day),
            onclick: () => goToDay(day),
          },
          h("span", { class: "day-name" }, DAY_NAMES[weekday(day)]),
          h("span", { class: "day-num tabular" }, dayOfMonth(day)),
          h("span", { class: "day-free tabular" }, free == null ? "" : free ? duration(free) : "–"),
        );
      }),
    );
  }

  function freeList(entry) {
    const { from, to, min } = state.prefs;
    const people = included(state.group.members);
    const heading = people.length === 1 ? `${people[0].name} is free` : "Free together";
    const settings = h(
      "button",
      { class: "link tabular", type: "button", onclick: openPrefs },
      `${time(from)}–${time(to)} · ${duration(min)}+`,
    );

    const head = h("div", { class: "section-head" }, h("h2", {}, heading), settings);
    if (!people.length) return h("section", {}, head, h("p", { class: "empty" }, "Tap a name above to include them."));
    if (!entry || entry.loading) return h("section", {}, head, h("p", { class: "loading" }, "Loading timetables…"));
    if (entry.error) {
      return h(
        "section",
        {},
        head,
        h("p", { class: "empty" }, entry.error, " ", h("button", { class: "link", type: "button", onclick: reloadAll }, "Retry")),
      );
    }

    const now = londonNow();
    const slots = freeFor(entry.data, state.day);
    const failed = included(entry.data.members).filter((m) => m.error);

    return h(
      "section",
      {},
      head,
      slots.length
        ? h(
            "ul",
            { class: "slots" },
            slots.map(([s, e]) => {
              const isToday = state.day === now.day;
              const past = (isToday && e <= now.minutes) || state.day < now.day;
              const current = isToday && s <= now.minutes && now.minutes < e;
              return h(
                "li",
                { class: ["slot", past && "past", current && "now"].filter(Boolean).join(" ") },
                h("span", { class: "slot-time tabular" }, `${time(s)} – ${time(e)}`),
                h("span", { class: "slot-meta tabular" }, current ? `Now · ${duration(e - now.minutes)} left` : duration(e - s)),
              );
            }),
          )
        : h("p", { class: "empty" }, `No shared gaps of ${duration(min)} or more between ${time(from)} and ${time(to)}.`),
      failed.length > 0 &&
        h(
          "p",
          { class: "hint" },
          `Couldn't load ${failed.map((m) => m.name).join(" and ")}'s timetable, so ${failed.length > 1 ? "they're" : "it's"} left out for now.`,
        ),
    );
  }

  function timeline(data) {
    const people = included(data.members);
    if (!people.length) return null;

    const events = people.map((m) => m.events.filter((e) => e.day === state.day));
    let first = Math.floor(state.prefs.from / 60);
    let last = Math.ceil(state.prefs.to / 60);
    for (const e of events.flat()) {
      first = Math.min(first, Math.floor(e.start / 60));
      last = Math.max(last, Math.ceil(e.end / 60));
    }

    const hourPx = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--hour")) || 52;
    const y = (minutes) => ((minutes - first * 60) / 60) * hourPx;
    const now = londonNow();

    const hours = [];
    for (let hr = first; hr <= last; hr++) {
      hours.push(h("div", { class: "tl-hour", style: `top:${y(hr * 60)}px` }, h("span", { class: "tabular" }, `${hr}:00`)));
    }

    const bands = freeFor(data, state.day).map(([s, e]) =>
      h("div", { class: "tl-free", style: `top:${y(s)}px;height:${y(e) - y(s)}px` }),
    );

    const columns = people.map((member, i) =>
      h(
        "div",
        { class: "tl-col" },
        events[i].map((event) =>
          h(
            "button",
            {
              class: "event",
              type: "button",
              style: `--c: var(--m${member.colour});top:${y(event.start)}px;height:${Math.max(y(event.end) - y(event.start) - 2, 14)}px`,
              "aria-label": `${member.name}: ${event.title || "Busy"}, ${time(event.start)} to ${time(event.end)}`,
              onclick: () => openEvent(member, event),
            },
            y(event.end) - y(event.start) >= 24 && h("span", {}, event.title),
          ),
        ),
      ),
    );

    const showNow = state.day === now.day && now.minutes >= first * 60 && now.minutes <= last * 60;

    return h(
      "section",
      { class: "timeline", style: `--cols:${people.length}`, "aria-label": "Timetables" },
      h(
        "div",
        { class: "tl-head" },
        h("span"),
        people.map((m) =>
          h("div", { class: "tl-name", style: `--c: var(--m${m.colour})` }, h("span", { class: "dot" }), h("span", {}, m.name)),
        ),
      ),
      h(
        "div",
        { class: "tl-body", style: `height:${y(last * 60)}px` },
        hours,
        bands,
        h("div", { class: "tl-cols" }, columns),
        showNow && h("div", { class: "tl-now", style: `top:${y(now.minutes)}px` }),
      ),
    );
  }

  function render() {
    if (state.missing) {
      document.title = "Frees";
      app.replaceChildren(
        h(
          "main",
          { class: "page" },
          header(),
          h(
            "div",
            { class: "missing" },
            h("h1", {}, "This group doesn't exist"),
            h("p", {}, "Check the link, or start a new group."),
            h("a", { class: "button", href: "/" }, "Start a group"),
          ),
        ),
      );
      return;
    }

    if (!state.group) {
      app.replaceChildren(h("main", { class: "page" }, header(), h("p", { class: "loading" }, "Loading…")));
      return;
    }

    const names = state.group.members.map((m) => m.name);
    document.title = names.length ? `Frees · ${names.join(", ")}` : "Frees";

    const entry = state.weeks.get(state.week);
    const data = entry?.data;

    const content = h("div", { class: "swipe" }, freeList(entry), data && timeline(data));
    swipe(content);

    app.replaceChildren(
      h(
        "main",
        { class: "page" },
        header(),
        callout(),
        state.group.members.length > 0 && people(data),
        weekNav(),
        dayTabs(data),
        content,
      ),
    );
  }

  function swipe(el) {
    let startX, startY;
    el.addEventListener(
      "touchstart",
      (e) => {
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
      },
      { passive: true },
    );
    el.addEventListener("touchend", (e) => {
      if (startX == null) return;
      const dx = e.changedTouches[0].clientX - startX;
      const dy = e.changedTouches[0].clientY - startY;
      startX = null;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) stepDay(dx < 0 ? 1 : -1);
    });
  }

  render();
  loadGroup();
  loadWeek(state.week);

  // Keep "now" honest without disturbing an open sheet.
  setInterval(() => {
    if (!document.querySelector("dialog[open]") && state.day === londonNow().day) render();
  }, 60_000);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && !document.querySelector("dialog[open]")) render();
  });
}

/* ---------- Routing ---------- */

const match = location.pathname.match(/^\/g\/([a-z0-9]{10})\/?$/);
if (match) startGroup(match[1]);
else renderHome();
