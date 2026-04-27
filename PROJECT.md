# Lyra — Project Reference

> Comprehensive agent-facing reference for this codebase. README.md is the
> public-facing copy; this file is the internal map. Read this before
> making non-trivial changes.

---

## What this project is

Lyra is a single-page Next.js app that turns a Spotify user's listening
history into a 3D force-directed graph. Each artist or track is a node;
edges connect items that share a Last.fm-derived genre. The user's
*currently-playing* track lights up its node in real time.

There are two distinct content paths:

1. **Owner-mode (signed in)** — the visitor authenticates with their own
   Spotify account, sees their own top artists, recently played, and
   currently playing. They can upload their full Spotify data export
   ZIP for the deeper `/library` view, which renders the entire
   listening history (years of plays, not just the top-50).
2. **Showcase-mode (anonymous)** — anyone visiting the deployed site
   sees the *owner's* top artists and recently played, plus the owner's
   uploaded library snapshot if they've published one. Designed so a
   public link is interesting without forcing OAuth.

The deployed instance is at https://lyra00.vercel.app, owned by the
Spotify account `kivtur00`.

---

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 16 (App Router) | Server Components, streaming, route handlers, native auth flow. **Note: Next 16 is post-breaking-changes; verify APIs via `node_modules/next/dist/docs/` rather than memory.** |
| Runtime | React 19 | Required by Next 16; stable hooks API |
| Build | Turbopack | Default in Next 16; survives HMR via `globalThis` module-state pattern |
| Styling | Tailwind CSS v4 | New `@tailwindcss/postcss` plugin, no `tailwind.config.js` — config lives in CSS |
| Language | TypeScript (strict) | All `.ts` / `.tsx` |
| 3D | Three.js (named imports) + react-force-graph-3d (dynamic import) + d3-force-3d | Force-directed layout in WebGL. Three is imported by name to allow tree-shaking. |
| Storage (server) | Vercel Blob (prod) / `public/*.json` (dev) | Public-readable JSON snapshots; same dual-mode shape across all stores |
| Storage (client) | IndexedDB (`idb-keyval`) for user-uploaded plays; localStorage for caches | Plays are too large for localStorage; caches are small + key-prefix-based |
| Audio meta | Last.fm `artist.getInfo` / `getTopTags` | Spotify removed `audio-features` / `genres` for new apps in 2025 |
| OAuth | Spotify Authorization Code flow with `client_secret` | Confidential client → refresh tokens DON'T rotate, critical for showcase mode |
| ZIP parsing | `fflate` | Pure-JS ZIP, runs entirely in-browser, no upload |
| Deploy | Vercel Fluid Compute | 300s function timeout, single instance reuse, daily cron |

---

## Directory layout

```
spotify-web/
├── app/                              Next.js App Router
│   ├── page.tsx                      Home: top artists + recently played + showcase preview
│   ├── layout.tsx                    Root layout with global aurora bg
│   ├── globals.css                   Tailwind v4 + custom CSS vars
│   ├── icon.svg                      Animated SMIL favicon
│   ├── explore/page.tsx              /explore — Spotify-top constellation
│   ├── library/page.tsx              /library — user's full history graph
│   ├── upload/page.tsx               /upload — drop ZIP, parse client-side
│   ├── share/[id]/page.tsx           Render a published share snapshot
│   └── api/
│       ├── auth/{login,callback,logout}/   Spotify OAuth dance
│       ├── profile/                  /me probe (cached client-side)
│       ├── now-playing/              Polled every 3s by signed-in clients
│       ├── recently-played/          Polled every 60s; SWR-backed for showcase
│       ├── top/                      ?type=artists|tracks; reads Blob first
│       ├── library-artists/          POST: enrich a list of artist names with Last.fm data
│       ├── share/{create,[id]}/      Publish + read user constellation snapshots
│       ├── owner/refresh-blobs/      Owner-only POST: force-bake top + recents
│       ├── showcase/                 Anonymous-visitor showcase endpoints
│       │   ├── library/              Read owner's full library snapshot
│       │   ├── library/publish/      Owner-only POST: bake + publish snapshot
│       │   ├── now-playing/          (Removed from front-end; route still exists)
│       │   ├── profile/              Owner profile (name, image, url)
│       │   ├── recently-played/      Owner recently-played (Blob-backed, SWR)
│       │   ├── top-artists/          Owner top artists by time range (Blob-backed)
│       │   └── debug/                Diagnostic helpers
│       └── cron/refresh-showcase/    Daily cron: bake Blobs, sweep old shares
├── components/                       Client components
│   ├── Starfield.tsx                 The 3D graph (~55 KB; the centrepiece)
│   ├── CriteriaBar.tsx               Mode toggle + time-range picker + library filters
│   ├── TagsPanel.tsx                 Library-mode tag/mood filter, color mode, co-play
│   ├── ArtistTagsPanel.tsx           API-mode (Spotify-top) genre-only filter
│   ├── NowPlaying.tsx                Home-page current-track card
│   ├── RecentlyPlayed.tsx            Home-page list, polls every 60s
│   ├── TopArtists.tsx                Home-page top-50 grid by time range
│   ├── ProfileBadge.tsx              Header badge + logout dropdown
│   ├── RateLimitChip.tsx             Bottom-center "Spotify is throttling…" indicator
│   ├── ShareConstellationButton.tsx  Top-right Share button (mode-aware)
│   ├── PublishShowcaseButton.tsx     Owner-only: bake + publish library snapshot
│   ├── ExploreView.tsx               Wrapper for /explore (Starfield + share button)
│   ├── SharedConstellation.tsx       Wrapper for /share/[id] (Starfield + snapshot)
│   ├── ShowcaseConstellation.tsx     Home-page constellation preview
│   ├── ShowcaseOwnerBanner.tsx       Owner-only banner for showcase mode
│   ├── NodeList.tsx                  Side rail of nodes by rank
│   ├── StatsSummary.tsx              Library stats at top of /library
│   └── UploadZone.tsx                /upload drag-and-drop + ZIP parser
├── lib/                              Pure logic, no React
│   ├── spotify.ts                    OAuth, refresh-token cache, rate-limit cooldown map
│   ├── spotify-api.ts                Fetch helpers wrapped around spotifyFetch
│   ├── spotify-showcase.ts           Server-side fetch using SHOWCASE_REFRESH_TOKEN
│   ├── client-cache.ts               localStorage TTL helpers (read fresh / read stale / write / clear)
│   ├── library-artists-cache.ts      Per-name client cache for /api/library-artists
│   ├── owner-top-store.ts            Blob-backed top-artists snapshot (3 ranges; weekly)
│   ├── owner-recently-store.ts       Blob-backed recents (SWR; daily cron + on-visit refresh)
│   ├── share-store.ts                Blob R/W for user-published `/share/{id}` snapshots
│   ├── showcase-library.ts           LibrarySnapshot / ArtistsSnapshot type definitions
│   ├── showcase-library-store.ts     Blob R/W for the owner's published library
│   ├── showcase-library-bake.ts      Client-side: aggregate plays into a LibrarySnapshot
│   ├── share-id.ts                   Random base62 ID generation
│   ├── pkce.ts                       PKCE code-verifier / challenge for OAuth
│   ├── parser.ts                     Spotify ZIP → Play[] streaming parser
│   ├── storage.ts                    IndexedDB load/save for parsed plays
│   ├── aggregate.ts                  Plays → top artists/tracks aggregation
│   ├── graph.ts                      buildArtistGraph / buildTrackGraph
│   ├── cluster.ts                    Community detection on the graph
│   ├── coplay.ts                     Co-play matrix builder for the overlay
│   ├── moods.ts                      Mood taxonomy + tag-to-mood matcher
│   └── types.ts                      Shared types (Play, etc.)
├── public/                           Static assets + dev-mode JSON shadow of Blob
├── README.md                         Public-facing docs
├── DEPLOYMENT.md                     Owner setup walkthrough (env vars, OAuth, Blob)
├── ROADMAP.md                        Future ideas
├── PROJECT.md                        This file
└── AGENTS.md                         Note about Next.js 16 breaking changes
```

---

## Data flow

### A signed-in user lands on `/`

1. Server Component `app/page.tsx` runs. `hasAuthSession()` reads the
   `spotify_refresh` cookie and returns `true`. Renders the page with
   the Now-Playing section visible.
2. Client mounts. `ProfileBadge` hydrates from `localStorage:lyra:profile`,
   then fetches `/api/profile` to refresh.
3. `NowPlaying` polls `/api/now-playing` every 3 s. Server hits Spotify
   `/me/player/currently-playing` via `spotifyFetch` (which reads the
   refresh-cookie, exchanges for an access token via cached singleflight,
   honors per-token rate-limit cooldowns).
4. `RecentlyPlayed` reads its localStorage cache; if fresh (<60 s),
   renders without a network call. Otherwise hits `/api/recently-played`
   and writes the result back to cache. Polls every 60 s.
5. `TopArtists` does the same against `/api/top?type=artists` per
   selected time range. Cache TTL 1 hour (Spotify top-artists barely
   change daily).
6. `ShowcaseConstellation` renders a small preview of the owner's
   constellation. Reads from `/api/showcase/library` (Blob).

### An anonymous visitor lands on `/`

1. Server Component runs; `hasAuthSession()` returns `false`. Now-Playing
   section hidden. Visitor banner shown ("Cards below show kivtur00's
   live streaming…").
2. `RecentlyPlayed`, `TopArtists` fetch the same routes, but those
   routes detect `!authed` and read from the Blob-backed showcase
   snapshots instead of Spotify.
3. The 3D constellation preview renders from the published library
   snapshot.

### A user signs in

1. `Connect Spotify` button hits `/api/auth/login` which redirects to
   Spotify with PKCE.
2. Spotify returns to `/api/auth/callback` with `?code=...&state=...`.
3. Callback verifies state, exchanges code for tokens, calls `/me` to
   confirm the account is on the dev allowlist (returns 403 otherwise).
4. **Cookie-set quirk**: Next.js 16 has issues with `cookies().set()`
   on a redirect response. We hand-format the `Set-Cookie` header via
   `response.headers.append()` instead. See
   `app/api/auth/callback/route.ts` for the full incantation.
5. 303 redirect to `/`. Browser sends new cookie on next request.

### A user uploads a Spotify export ZIP at `/upload`

1. ZIP parsed entirely in-browser via `fflate`. No server upload.
2. Plays stored in IndexedDB via `idb-keyval`.
3. `/library` reads from IndexedDB and renders the full history.

### A user shares their constellation

1. Click `Share constellation` button on `/library` or `/explore`.
2. Client bakes a `LibrarySnapshot` (or `ArtistsSnapshot`) from local
   data + Last.fm enrichment via `/api/library-artists`.
3. POST to `/api/share/create`. Server validates size (1 MB cap),
   shape, per-IP rate limit (10/hour), generates random 10-char base62
   ID, writes to Blob at `shares/{id}.json`.
4. Returns ID. Client copies `https://lyra00.vercel.app/share/{id}` to
   clipboard.
5. Recipient opens the link. Server reads Blob, renders Starfield with
   the snapshot. No auth required.

---

## Authentication model

- **OAuth flow**: Authorization Code + PKCE. With `SPOTIFY_CLIENT_SECRET`
  set, runs as confidential client → refresh tokens are long-lived and
  do NOT rotate on each refresh.
- **Refresh cookie**: `spotify_refresh`, HttpOnly, SameSite=Lax, Secure
  (in production), Max-Age 1 year, Path=/.
- **Access tokens**: never exposed to the client. Server caches by
  refresh-token key in module-scope `Map<refresh, {accessToken, expiresAt}>`.
  Singleflight via `inflightRefreshes: Map<refresh, Promise>` to
  serialize concurrent refreshes for the same token.
- **Cookie-clearing policy**: only on `error: invalid_grant`,
  `invalid_client`, or `invalid_request` from Spotify's `/api/token`.
  Generic 4xx, 5xx, network errors, and 429 are ALL transient. Logs
  `[auth] clearing refresh cookie — Spotify rejected token (...)` when
  it does happen, so the cause is auditable from Vercel logs.
- **Rate-limit cooldown**: per-refresh-token `Map<refresh, untilEpoch>`.
  Honoring Spotify's `Retry-After` (clamped to 1–600 seconds). While in
  cooldown, `spotifyFetch` short-circuits to `null` instead of hitting
  Spotify, which would extend the window.
- **Showcase token**: `SHOWCASE_REFRESH_TOKEN` env var = the cookie
  value of the owner's session. Independent of any visitor's cookie.
  State persisted on `globalThis.__lyraShowcase` to survive Turbopack
  HMR in dev.

---

## Caching strategy (multi-layer)

| Layer | Mechanism | TTL | Used for |
|---|---|---|---|
| **Browser localStorage** | `lib/client-cache.ts` | 1h–7d depending on data | TopArtists list, RecentlyPlayed, ProfileBadge, library-artists per-name, showcase library snapshot |
| **Browser IndexedDB** | `idb-keyval` | Indefinite | Uploaded play history (millions of rows) |
| **Server module-scope** | Plain `Map` / `let cached` | 5 min for Blob reads, 1 min for showcase responses | Dedup concurrent visitor reads, access-token cache |
| **Server Vercel Blob** | `@vercel/blob` | Refreshed by cron / on-visit SWR | Owner top-artists (weekly), owner recents (5-min SWR), library snapshot (manual), shares (30 days) |
| **Spotify Web API** | Network | n/a | Source of truth for live data |

Layered so a typical request walks: localStorage → server in-process
cache → Blob → Spotify, falling through only as needed. **Most user
visits make zero Spotify API calls** because everything they need is
cached at one of the upper layers.

### Specific TTLs in code

- `RecentlyPlayed.tsx`: `CACHE_TTL = 60s`, `POLL_MS = 60s`
- `TopArtists.tsx`: `CACHE_TTL = 1h`
- `Starfield.tsx` (api branch): `CACHE_TTL = 1h`
- `Starfield.tsx` showcase library: `1h`
- `library-artists-cache.ts`: `7 days`
- `owner-top-store.ts`: `READ_TTL_MS = 5min`, `REFRESH_AFTER_MS = 7 days`
- `owner-recently-store.ts`: `READ_TTL_MS = 5min`, `REFRESH_AFTER_MS = 24h`, `SWR_STALE_AFTER_MS = 5min`
- `share-store.ts`: shares persist 30 days, swept by cron
- `NowPlaying.tsx`: `POLL_MS = 3000`, `TICK_MS = 250` (250 ms is a render-only progress-bar tick, not a network call)

---

## Showcase architecture

### Owner top-artists (Blob-backed, weekly)

`lib/owner-top-store.ts` reads/writes `owner-top.json` containing
`{ short_term, medium_term, long_term }` arrays of 50 enriched
`ArtistApiItem`s each. Cron's `maybeRefreshOwnerTop()` re-fetches all
three ranges from Spotify only when the existing snapshot is older
than `REFRESH_AFTER_MS = 7 days`. Refuses to overwrite a good snapshot
with empties (rate-limit / dead-token protection).

Read by:
- `/api/showcase/top-artists` (anonymous)
- `/api/top` showcase branch (when `!authed`)

### Owner recently-played (Blob-backed, SWR)

`lib/owner-recently-store.ts` writes `owner-recently.json`. Same
structure but with on-visit SWR refresh: `readOwnerRecentlyFresh()`
returns the Blob if `<5min` old, else triggers a Spotify refresh
(deduped via module-scope `inflightRefresh: Promise | null`) and
waits up to 2.5 s before falling back to stale.

Cron also has `maybeRefreshOwnerRecently()` as a safety floor; both
paths call the same `refreshOwnerRecentlyFromSpotify()` writer.

### Owner library snapshot (Blob-backed, manual publish)

`lib/showcase-library-store.ts` writes `showcase-library.json`.
**Owner re-publishes manually** via the `PublishShowcaseButton` →
POSTs to `/api/showcase/library/publish`. Identity check: visitor's
Spotify ID must match the showcase owner's ID (resolved via the
showcase token's `/me`). Snapshot is the full `LibrarySnapshot`
baked client-side from IndexedDB plays.

### User-published shares (Blob, 30-day TTL)

`lib/share-store.ts` writes `shares/{id}.json`. Random 10-char base62
IDs (~60 bits). Per-IP rate-limit on creation: 10/hour, sliding
window in module-scope `Map<ip, number[]>`. Sweep step in the cron
deletes shares where `uploadedAt < now - 30 days`.

### Cron job

`/api/cron/refresh-showcase` runs daily at `0 6 * * *` UTC (the only
cadence Vercel Hobby supports). On each tick:

1. `resetShowcaseLatch()` — drop the "env token is dead" latch in case
   the owner rotated `SHOWCASE_REFRESH_TOKEN` since.
2. `invalidateShowcaseCache()` — clear in-process response cache.
3. `maybeRefreshOwnerTop()` — refresh weekly.
4. `maybeRefreshOwnerRecently()` — refresh daily.
5. `sweepOldShares()` — delete shares older than 30 days.
6. Warm `/api/showcase/profile`.

Authenticated by `Authorization: Bearer ${CRON_SECRET}`.

---

## Spotify API constraints (2026)

Spotify removed several endpoints during 2025–2026, which shaped the
codebase:

- `audio-features`, `audio-analysis`, `recommendations`,
  `related-artists`, batch `/tracks?ids=`, batch `/artists?ids=`, and
  editorial playlists are **gone for new apps**.
- `genres` and `popularity` fields on artist responses are now
  **always empty** for new apps. Lyra falls back to Last.fm
  `artist.getTopTags` and `artist.getInfo`.
- Dev mode is capped at **25 users per app** (was historically 5)
  and requires Premium for the owner.
- Extended-quota access (i.e., make the app public) is **no longer
  available for personal projects** as of 2025.
- Playback has **no webhooks** — `/me/player/currently-playing` is
  polled at 3 s with progress-bar interpolation between polls.
- OAuth requires `127.0.0.1` (not `localhost`) for HTTP redirects, or
  HTTPS for production.

Per-token rate limit on `/me*` is approximately 180 calls per rolling
30 s window. Multi-tab users share that budget. Showcase token has
its own budget independent of any signed-in user.

---

## Rate-limit handling (defense-in-depth)

1. **Per-token cooldown**: `cooldownByRefresh: Map<refresh, untilEpoch>`
   in `lib/spotify.ts`. On a 429, record `now + min(Retry-After, 600s)`.
   Subsequent `spotifyFetch` calls within the window short-circuit.
2. **Conservative cookie clearing**: only `invalid_grant` and friends
   from `/api/token` clear the cookie. 429 is always transient.
3. **Client-side cache fallback**: when the server returns
   `rateLimited: true`, components fall back to their localStorage
   cache rather than serving stale-empty.
4. **Visible chip**: `RateLimitChip` polls `/api/profile` every 30 s
   and shows a bottom-center indicator if `rateLimited:true`.
   Hysteresis: requires 2 consecutive `true` polls before showing,
   clears immediately on `false`.
5. **Retry on rate-limited+empty**: `TopArtists` and `Starfield`
   (api branch) retry on the same 1s/2s/4s backoff that the 503 path
   uses, so a brief throttle window doesn't show "No artists yet"
   on a tab toggle.
6. **Per-IP throttle on `/api/share/create`**: 10 creates/hour, 1 MB
   max body. Returns 429 with `Retry-After: 3600`.

---

## Per-user data isolation

Critical invariant: **a signed-in user must never see another user's
data**. Specifically:

- When authed-but-rate-limited, routes return `{ items: [], rateLimited: true }`,
  NOT the showcase owner's data. (Earlier prototypes did fall through;
  it was reverted because friends seeing "kivtur00's data" while
  signed in was confusing.)
- The showcase fallback only runs when `!authed`.
- ProfileBadge cache (`lyra:profile`) clears on logout via
  `clearAllLyraCache()`, which sweeps every `lyra:*` key so a different
  account on the same browser starts fresh.
- IndexedDB plays are **per-browser-origin**, not per-account.
  Uploading a ZIP overwrites whatever was there.

---

## Routes (full map)

### Pages

| Path | Renders |
|---|---|
| `/` | Home — top artists, recently played, now-playing card (if signed in), showcase preview |
| `/explore` | Spotify-top constellation; signed-in user sees their own data, anonymous sees showcase |
| `/library` | Full-history constellation; signed-in user sees uploaded data, anonymous sees published library snapshot |
| `/upload` | ZIP drag-and-drop, parses to IndexedDB |
| `/share/[id]` | Renders a published share snapshot |

### API

| Method | Path | Notes |
|---|---|---|
| GET | `/api/auth/login` | Redirect to Spotify with PKCE |
| GET | `/api/auth/callback` | OAuth callback; sets refresh cookie |
| POST | `/api/auth/logout` | Clears cookie, 303 to `/` |
| GET | `/api/profile` | Visitor profile or `{ rateLimited: true }` |
| GET | `/api/now-playing` | 3 s poll target. Returns `{ rateLimited }` for authed users on throttle. No showcase fallback (privacy). |
| GET | `/api/recently-played` | 60 s poll target. Showcase branch reads Blob via SWR. |
| GET | `/api/top?type=artists\|tracks&time_range=...` | Read Blob-baked owner top for visitors; live for signed-in. |
| POST | `/api/library-artists` | Last.fm enrichment for arbitrary artist names. |
| POST | `/api/share/create` | Publish a snapshot, returns `{ id }`. |
| GET | `/api/share/[id]` | Read a published snapshot (page handler reads it server-side). |
| POST | `/api/owner/refresh-blobs` | Owner-only: force-bake top + recents Blobs. |
| GET | `/api/showcase/profile` | Owner profile resolver. |
| GET | `/api/showcase/now-playing` | Legacy; not used by frontend anymore. |
| GET | `/api/showcase/recently-played` | SWR-backed Blob read. |
| GET | `/api/showcase/top-artists?time_range=...` | Blob-backed; live fallback. |
| GET | `/api/showcase/library` | Read owner's published library snapshot. |
| POST | `/api/showcase/library/publish` | Owner-only: publish library snapshot. |
| GET | `/api/showcase/debug/...` | Diagnostic endpoints. |
| GET | `/api/cron/refresh-showcase` | Vercel cron, daily 6am UTC. |

---

## Environment variables

| Name | Required for | What it does |
|---|---|---|
| `SPOTIFY_CLIENT_ID` | Always | Spotify dev app ID |
| `SPOTIFY_CLIENT_SECRET` | Showcase mode | Makes Lyra a confidential OAuth client; refresh tokens stop rotating |
| `SPOTIFY_REDIRECT_URI` | Always | Must match Spotify dev dashboard exactly |
| `LASTFM_API_KEY` | Always | Genre / listener / playcount enrichment |
| `SHOWCASE_REFRESH_TOKEN` | Showcase mode | Owner's refresh-token cookie value |
| `BLOB_READ_WRITE_TOKEN` | Production | Vercel Blob token; without it, all Blob stores fall through to `public/*.json` files |
| `CRON_SECRET` | Production | Authorizes the daily cron route |

DEPLOYMENT.md has the step-by-step setup walkthrough.

---

## State invariants worth knowing

- **Module-scope state lives on `globalThis`** in dev so Turbopack HMR
  doesn't reset it (`spotify-showcase.ts` is the canonical example).
  Without this, the rotated in-memory refresh token gets forgotten on
  every recompile.
- **Singleflight** for refresh-token exchanges (`inflightRefreshes`
  map). Concurrent requests with the same refresh token share one
  network call — without this, a refresh-token rotation race causes
  one of the requests to hit `invalid_grant` on an already-rotated
  token.
- **Stale-while-revalidate inflight dedup** for owner-recents refresh
  (`inflightRefresh: Promise | null` in `owner-recently-store.ts`).
- **Per-instance state** doesn't cross Vercel Fluid Compute instances
  — the per-IP share rate-limit map and the SWR inflight promise are
  best-effort within an instance, deliberately not cross-instance.
- **localStorage caches are per-browser**, not per-account. The
  `clearAllLyraCache()` on logout is what protects against account
  bleed.

---

## Subtle bugs the codebase guards against

- **`cookies().set()` on redirect doesn't land in Next 16**. Use
  `response.headers.append("Set-Cookie", ...)` with hand-formatted
  cookie string. See `auth/callback/route.ts:107`.
- **Spotify returns 4xx that *isn't* `invalid_grant`** under load.
  Don't clear the cookie — treat as transient. See `spotify.ts:97`.
- **ProfileBadge falling through to "Connect Spotify" on rate-limit**:
  fixed by splitting `!authenticated` and `!name` branches; the
  rate-limited response has `authenticated:true` but no name. See
  `ProfileBadge.tsx:97`.
- **ForceGraph3D node-clone trap**: d3-force-3d resolves link
  `source`/`target` from string IDs to node references on the first
  tick and *mutates the link in place*. If you hand it a parallel
  set of recolored node clones, edges stay attached to the old refs
  while the recolored clones get a fresh layout. Filtering returns
  subset arrays of the *same* references, and cluster coloring is
  applied at render time via a Map override. See `Starfield.tsx:439–448`.
- **ID matching for current-track halo**: a node ID can be a Spotify
  artist ID, `lib:{name}`, `spotify:track:...`, or `track:{name}::{artist}`.
  The matcher in Starfield computes every plausible form so any
  combination of node-source + track-source lights up.
- **Top-of-day spike on cron**: cron triggers refreshes that warm the
  Blob; visitor traffic during the warming window may briefly see the
  pre-refresh data. The 60s in-process read cache absorbs it.

---

## Key user flows

### "I want to share my listening with friends"

1. Owner uploads ZIP at `/upload`. Plays land in IndexedDB.
2. Owner navigates to `/library`. Verifies graph renders.
3. Owner clicks `Publish to showcase` button (owner-only). Bakes a
   `LibrarySnapshot`, posts to `/api/showcase/library/publish`,
   identity-gated → writes `showcase-library.json` to Blob.
4. Owner adds friends' Spotify-account emails to the dev app
   allowlist (Spotify dashboard → User Management).
5. Friends visit `lyra00.vercel.app`. Without signing in they see the
   owner's showcase. Signed in (if added to allowlist) they see their
   own data.

### "I want to share a single constellation snapshot"

1. Anyone with their own data clicks `Share constellation` on
   `/library` or `/explore`.
2. Snapshot baked client-side, posted to `/api/share/create` (per-IP
   rate-limited).
3. Random URL `/share/{id}` returned, copied to clipboard.
4. Snapshot persists 30 days, then swept by cron.

---

## What recently changed (this session, late April 2026)

1. **Conservative cookie clearing** — only true `invalid_grant` /
   `invalid_client` / `invalid_request` clears the refresh cookie.
2. **localStorage caches** added: `client-cache.ts`,
   `library-artists-cache.ts`. Wired into TopArtists, RecentlyPlayed,
   ProfileBadge, Starfield (api branch + library-mode showcase
   fallback), PublishShowcase, ShareConstellation.
3. **Owner data baked to Blob**: `owner-top.json` (weekly),
   `owner-recently.json` (daily + on-visit SWR).
4. **Now-playing scoped to authed users**: anonymous visitors no
   longer see what the owner is currently playing. Saves rate-limit
   budget and tightens privacy.
5. **ArtistTagsPanel** added for genre filtering in Spotify-top mode.
6. **Logout dropdown** in ProfileBadge.
7. **Owner-only `/api/owner/refresh-blobs`** to force-bake without
   waiting for cron.
8. **Share TTL of 30 days** with cron sweep.
9. **Visitor-friendly auth-error copy** for `not_on_allowlist` (the
   most common visitor failure mode).
10. **Now-playing poll = 3 s** (down from 5 s); the progress bar's
    250 ms render tick keeps it visually smooth.

---

## Where to look for things

- "How does auth work" → `lib/spotify.ts` + `app/api/auth/`
- "How does showcase data get baked" → `lib/owner-top-store.ts`,
  `lib/owner-recently-store.ts`, `app/api/cron/refresh-showcase/route.ts`
- "How does the 3D graph build" → `lib/graph.ts`, `components/Starfield.tsx`
- "How does the ZIP parser work" → `lib/parser.ts`, `lib/storage.ts`
- "How are shares stored" → `lib/share-store.ts`,
  `app/api/share/create/route.ts`
- "How does rate-limit handling work" → `lib/spotify.ts` (cooldown map),
  `components/RateLimitChip.tsx`, the `rateLimited` field on
  `/api/{now-playing,top,recently-played,profile}` responses
- "How does Last.fm enrichment work" → `lib/spotify-api.ts`
  (`fetchLastfmArtistData`), `app/api/library-artists/route.ts`,
  `lib/library-artists-cache.ts`

---

## Known limitations

- **Spotify dev-mode cap**: 25 users on the allowlist; can't go wider
  for personal projects.
- **No raw plays in shares**: filters that need play-level data
  (time-of-day, day-of-week, etc.) silently no-op on shared snapshots.
  Trade-off: shipping every play would inflate snapshots ~100x.
- **Per-IP share rate-limit is per-instance**: a determined abuser
  could exceed 10/hr by load-balancing across Fluid Compute instances.
  Acceptable for a small site; if it ever matters, move counters to
  Redis.
- **Cron is daily** (Hobby tier). The 5-min SWR on recents covers
  visitor-side freshness; weekly top-artists is fine because the data
  barely moves.
- **No analytics, no error monitoring** (Sentry / Logtail / etc.).
  Vercel Function Logs are the only observability layer right now.
