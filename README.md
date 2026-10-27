# Frees

Find shared free time between friends' University of Manchester timetables.

One person creates a group with their iCal timetable link and shares the group link. Friends open it and add their own. Everyone sees the gaps they have in common, day by day.

- Timetable links stay on the server. The browser only receives names and events.
- Times are always shown in UK time, including across the clock change.
- If the university feed is down, the last good copy is used.

## Deploy (Netlify)

1. In Netlify, choose **Add new site → Import an existing project** and pick this repo.
2. Leave the build settings as they are (`netlify.toml` covers them) and deploy.

Groups are stored in Netlify Blobs, which needs no setup.

## Run locally

```sh
npm install
npm run dev     # http://localhost:8888
npm test
```

To test with feeds served from your own machine, start with `ALLOW_LOCAL_FEEDS=1 npm run dev`. Never set this in production.

## Layout

```
public/                  static front end (no build step)
netlify/functions/api.mjs  API: /api/groups/...
lib/ics.js               iCal parsing and recurrence expansion
lib/london.js            UK-time helpers
lib/feeds.js             fetching, validation and caching of feeds
lib/store.js             groups in Netlify Blobs
```
