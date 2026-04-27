# Lyra

A 3D starfield of your Spotify listening history.

**Live demo:** [lyra00.vercel.app](https://lyra00.vercel.app)

Lyra parses your full streaming history locally, enriches it with
Last.fm genres, and renders it as a force-directed 3D graph of artists
or tracks linked by shared genre. When you're signed in, the track
currently playing on Spotify pulses live inside the constellation.

## Features

- **Live now-playing pulse** — the song you're playing right now lights
  up its node in the 3D graph; halo, focus button, deep link to Spotify.
- **Two graph modes** — `Spotify top` (your live top-50 from the Web
  API) or `My library` (full extended history from your uploaded ZIP).
- **Filter, sort, cluster** — by year, time-of-day, day-of-week,
  session entry, loved-only, skip-rate buckets, discovery year, mood,
  and tag chips. Color by primary genre or by detected community.
- **Co-played overlay** — click any node to highlight tracks/artists
  frequently played together in the same session.
- **Showcase mode** — let visitors see your top artists and a baked
  snapshot of your constellation without forcing them to log in.
  (Currently-playing is signed-in-only, so anonymous visitors never
  see what you're listening to in real time.)
- **Share a constellation** — anyone with their own uploaded library
  can publish a `/share/{id}` link rendering their full graph.

## Quick start (local)

### 1. Spotify Developer app

1. Open [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard).
2. Create or open your app → **Edit settings**.
3. Under **Redirect URIs**, add `http://127.0.0.1:3000/api/auth/callback`.
   Use `127.0.0.1`, not `localhost` — Spotify rejects `localhost` since
   November 2025.
4. Note the **Client ID** and **Client secret** (View client secret).

### 2. Last.fm API key

Free, takes 30 seconds:
[last.fm/api/account/create](https://www.last.fm/api/account/create).

### 3. `.env.local`

```env
SPOTIFY_CLIENT_ID=your_spotify_client_id
SPOTIFY_CLIENT_SECRET=your_spotify_client_secret
SPOTIFY_REDIRECT_URI=http://127.0.0.1:3000/api/auth/callback
LASTFM_API_KEY=your_lastfm_key
```

> `SPOTIFY_CLIENT_SECRET` is required if you plan to use **showcase
> mode** — it makes Lyra run as a confidential OAuth client, so the
> showcase refresh token doesn't rotate on every use. For purely
> single-user local development you can omit it.

### 4. Run

```bash
npm install
npm run dev
```

Open http://127.0.0.1:3000 and click **Connect Spotify**.

## Routes

| Route | What it shows |
|---|---|
| `/` | Landing — Now playing, recently played, top artists, showcase preview, upload CTAs |
| `/explore` | 3D starfield of your top-50 artists (live Spotify Web API) |
| `/upload` | Drop your Spotify data ZIP — parsed entirely in your browser |
| `/library` | 3D starfield of your full streaming library, with filters |
| `/share/<id>` | A user-shared constellation snapshot |

## Showcase mode (optional, for public deployments)

Showcase mode lets unauthenticated visitors see *your* recently played,
top artists, and full track constellation when they hit a deployed
Lyra. Authenticated visitors see their own data instead.

Currently-playing track is **owner-only** — anonymous visitors never
see what you're listening to in real time. Top artists are baked into
Vercel Blob and refreshed weekly by a cron, so visitor traffic doesn't
hit the Spotify API directly.

The setup is documented step-by-step in **[DEPLOYMENT.md](./DEPLOYMENT.md)**.
Short version:

- `SPOTIFY_CLIENT_SECRET` enables confidential-client OAuth, so refresh
  tokens are long-lived (no rotation, no breakage on cold starts).
- `SHOWCASE_REFRESH_TOKEN` is the cookie value from your own Spotify
  login — gives the server access to your now-playing / top items.
- `BLOB_READ_WRITE_TOKEN` (Vercel Blob) stores the baked library
  snapshot and any user-published `/share/{id}` constellations.
- `CRON_SECRET` authorizes the daily Vercel cron that warms the
  showcase cache and re-bakes the owner's top-artists snapshot to
  Vercel Blob once a week.

Without `SHOWCASE_REFRESH_TOKEN`, anonymous visitors just see empty
cards — nothing else breaks.

## Sharing your constellation

Once you've uploaded your ZIP and `/library` is rendering, the **↗ Share
constellation** button (top-left) bakes a snapshot, posts it to the
share endpoint, and copies a link like
`https://your-domain.com/share/o2sGtmNLNQ` to your clipboard. Anyone
with the link can view the constellation — the Starfield, filters, and
discovery-year picker work the same as `/library` for the recipient.

Snapshots ship pre-aggregated top-200 tracks + artists with per-track
first-played timestamps and genre data. Filters that need raw plays
(time-of-day, day-of-week, session-entry, loved, skip-rate) silently
no-op on shared snapshots — the alternative was inflating snapshot size
~100× by shipping every play.

## Notes on Spotify Web API in 2026

Spotify removed several endpoints in 2025–2026, which shaped Lyra's
architecture:

- `audio-features`, `audio-analysis`, `recommendations`,
  `related-artists`, batch `/tracks?ids=`, batch `/artists?ids=`, and
  editorial playlists are all **gone** for new apps.
- `genres` and `popularity` fields are now **empty** on artist
  responses — Lyra falls back to Last.fm `artist.getTopTags` and
  `artist.getInfo` for both.
- Dev mode is capped at **5 users per app** and requires Premium.
  Extended-quota access is no longer available for personal projects.
- Playback has **no webhooks** — `/me/player/currently-playing` is
  polled every 5s, with progress-bar interpolation between polls so
  the UI stays smooth.
- **Rate-limit handling** is layered: per-token cooldowns honor
  `Retry-After`, top artists / recently-played are cached client-side
  in localStorage (6h / 30min TTL), and the owner's top artists are
  baked weekly to Vercel Blob so visitor traffic never hits Spotify.
- OAuth requires `127.0.0.1` (not `localhost`) for HTTP redirects, or
  HTTPS for production.

## Tech stack

Next.js 16 (App Router), React 19, Tailwind CSS v4, TypeScript, Three.js
+ react-force-graph-3d, d3-force-3d, fflate (in-browser ZIP parsing),
idb-keyval, Vercel Blob.

## Architecture notes

- **No database.** User listening data lives in your browser's
  IndexedDB; nothing is sent to a backend except for transient Last.fm
  enrichment lookups (cached server-side by artist name).
- **Force tuning** is applied via `onEngineTick` rather than a useEffect
  to avoid race conditions during graph remount.
- **Edges by shared genre**, with same-artist track-track edges skipped
  (otherwise tracks of one artist form an information-free hairball).
- **Module-scope caches** for Spotify access tokens and showcase JSON
  responses, persisted on `globalThis` so they survive Turbopack HMR
  reloads in dev.
- **Singleflight** refresh-token coalescing — concurrent requests share
  one Spotify `/api/token` call so we don't race the rotation.

## License

MIT — see `LICENSE`.

Not affiliated with Spotify AB.
