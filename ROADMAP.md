# Lyra — Roadmap

Tracking what's done, what's next, and what's been decided about the project. Update this as work lands.

## Done

### Phase 1 — Spotify auth + live now-playing
- PKCE flow at first; **upgraded to confidential client** (PKCE was rotating refresh tokens on every refresh, breaking showcase mode across cold starts)
- `/api/now-playing` polled every 1.5s on home, 2s in the constellation, with progress bar interpolated locally for smooth visual
- Server-side access-token cache (1 API call per poll instead of 2)
- Singleflight refresh-token coalescing so concurrent requests don't race the rotation
- Polling pauses when the tab is hidden; resumes immediately on focus
- Confidential-client OAuth (`SPOTIFY_CLIENT_SECRET`) — refresh tokens are long-lived, env-var stays valid across restarts and Vercel cold starts

### Phase 2 — Upload extended streaming history
- Drag-drop ZIP / individual JSON files
- Schema adapter for both `Streaming_History_Audio_*.json` (extended) and `StreamingHistory*.json` (12-month account data)
- Filter `ms_played >= 30s` (Spotify's "real listen" threshold)
- IndexedDB persistence — your history never leaves the browser
- Top-tracks + top-artists summary

### Phase 3 — Genre + stats enrichment
- Per-artist Last.fm `getTopTags` (Spotify deprecated `genres` from list endpoints + `/artists/{id}` in 2026)
- Per-artist Last.fm `getInfo` for listeners + playcount (Spotify deprecated `popularity` Feb 2026)
- Server-side cache by Spotify ID and by lowercase artist name
- 5-artist parallel batches to respect Last.fm's 5 req/s soft limit

### Phase 4 — Starfield rendering
- `react-force-graph-3d` with Three.js
- Live starfield backdrop (3 layers of `THREE.Points`)
- Edges by shared genre tags; same-artist edges skipped to avoid clique noise
- Node colors by primary genre, size by personal rank or sort metric
- Hover edges → see shared genre chips
- Drag-to-pan + right-drag rotate + scroll zoom (orbit controls)
- Force tuning via `onEngineTick` (avoids "tick" race condition crash)
- O(1) `nodeById` map so edge colors paint from frame 1 (no white-then-recolor)
- Compact tuning (linkDistance ≈140+√n·18, charge ≈-(380+5n), centerStrength 0.85) — clusters readable without zoom

### Phase 5 — Now-playing overlay (preview)
- Current artist node turns brand-green + 4× size
- Pulsing halo via direct THREE.Mesh + raf in render loop
- Now-playing pill with "focus camera" button when match is in graph
- Click any node → open in Spotify (deep link for tracks/API artists; search for library-only)
- Works for visitors via showcase fallback — owner's now-playing pulses in their own published constellation

### Phase A — Listening-context filters
- Time of day (morning / afternoon / evening / night, multi-select)
- Day of week (all / weekdays / weekends)
- Session entry (any / actively picked / auto-played)
- Loved only (avg ≥50% of max ms_played AND skip rate <30%)
- Skip rate buckets (any / low ≤20% / ≤5%)
- Discovery year (filter to tracks first played in year X) — works on owner's library AND on showcase / shared snapshots (firstPlayed baked in)

### Phase B — Last.fm-powered enrichment filters
- Mood/genre tag chip multi-select (lib/moods.ts, TagsPanel)
- Cluster coloring via label propagation on the genre-edge graph (no extra deps)
- Cluster legend showing dominant tag per cluster

### Phase C — Personal collaborative filtering
- Compute listening-session co-occurrence on ZIP load (30-min gap)
- Click a node → "show co-played" overlay highlights frequently co-played artists/tracks

### Lyra rebrand
- Wordmark in its own header band, large display font
- LyraMark constellation logo with pulsing Vega star
- Mobile-responsive header + hero
- Subtle green-tinted overlay gradients (`overlay-tab`, `overlay-card`)

### Showcase mode (the big architectural addition)
- Live now-playing / recently played / top artists for unauthenticated visitors, sourced from owner's refresh token
- Server-side: `/api/showcase/{profile,now-playing,recently-played,top-artists}` with module-scope cache and per-route TTLs (1s now-playing, 5min recents, 1h top artists, 24h profile)
- Personal endpoints (`/api/now-playing` etc.) auto-fall-back to showcase data when no session cookie — components don't need to know which mode they're in
- 503-with-retry on post-OAuth token-propagation lag (no flash of "someone else's data")
- Module state persisted on `globalThis` to survive Turbopack/HMR module reloads
- Dropped PKCE for the OAuth flow when `SPOTIFY_CLIENT_SECRET` is set so the resulting refresh token doesn't rotate
- 6-hour cron at `/api/cron/refresh-showcase` warms the cache on Vercel

### Showcase library snapshot (track-level constellation for visitors)
- Owner clicks **↻ Refresh showcase** on `/library` → bakes top 200 tracks + top 200 artists + per-track firstPlayed + artist-genre map → posts to `/api/showcase/library/publish`
- Storage adapter: Vercel Blob (prod) or `public/showcase-library.json` (zero-config dev)
- Visitors hitting `/library` without their own data render the snapshot through the same Starfield + CriteriaBar — full filter UX where data permits (Discovered year works; play-level filters silently no-op)
- Publish endpoint gates on `isOwner` (visitor's Spotify user id matches the showcase profile id) — independent of the client-side button visibility check
- Owner attribution chip on `/library` and `/explore` for unauthed visitors: "● Viewing kivtur00's library"
- Home Showcase section names the owner: "*You're viewing kivtur00's listening data — top X artists across Y genre clusters, plus a track-level constellation built from kivtur00's full streaming history*" with two CTAs (Top artists / Track library)

### Share-a-constellation
- Anyone with their own uploaded library can click **↗ Share constellation** on `/library`
- Bakes the same `LibrarySnapshot` shape as the owner showcase, posts to `/api/share/create`, gets a short ID, copies `/share/{id}` URL to clipboard
- `/share/[id]` page renders the snapshot through the same Starfield (full filterable UX)
- Storage: same dual-mode (Vercel Blob in prod, `public/shares/{id}.json` locally), namespaced by ID
- Random 10-char base62 IDs (un-enumerable); 1MB upload cap; 30-day blob cache TTL

### Polish + perf
- Mobile responsive pass (header / hero / filter chips wrap; node lists open as overlays)
- Polling pauses when tab hidden — saves Spotify quota and laptop battery
- Static favicon + Lyra meta
- Sort metric drives node sizing (so the largest node always reflects the active sort)
- Smoothness pass on now-playing pulse and edge color paint

## Next up

### Phase D — Per-track API enrichment
- [ ] `/tracks/{id}` per-item lookup for `release_date` (cache forever)
- [ ] Filter by decade (60s / 70s / 80s / 90s / 00s / 10s / 20s)

### Tier-3 polish
- [ ] Replay obsession filter (back-to-back plays in same session)
- [ ] Country / platform / offline filters
- [ ] Search bar (jump to a node by name)
- [ ] Export image / png of the graph
- [ ] Mobile gestures
- [ ] Snapshot expiration (delete shares older than 30d via cron)

### Deployment (next)
- [ ] Provision Vercel Blob (`BLOB_READ_WRITE_TOKEN`)
- [ ] Set production env vars (`SPOTIFY_CLIENT_SECRET`, `SHOWCASE_REFRESH_TOKEN`, `LASTFM_API_KEY`, `CRON_SECRET`)
- [ ] Add prod Redirect URI to Spotify dashboard
- [ ] Bake initial library snapshot via the published `/library` button
- [ ] Verify showcase + share both render in incognito on production
- [ ] Custom domain + DNS
- [ ] Rotate `SPOTIFY_CLIENT_SECRET` and `SHOWCASE_REFRESH_TOKEN` after launch (both have been exposed in dev chat)

See **DEPLOYMENT.md** for the step-by-step.

## Decisions / constraints

- **Spotify Web API in 2026:** `audio-features`, `audio-analysis`, `recommendations`, `related-artists`, batch `/tracks?ids=`, batch `/artists?ids=` are all dead. Per-item `/artists/{id}` and `/tracks/{id}` still work. `genres` and `popularity` fields are now empty on artist responses.
- **Dev mode:** Spotify caps at 5 users per app, requires Premium. Extended-quota access is no longer available for personal projects.
- **Real-time:** no webhooks for playback. Polling `/me/player/currently-playing` at 1.5–2s intervals.
- **OAuth host:** must be `127.0.0.1` (or HTTPS), not `localhost`.
- **PKCE rotates refresh tokens.** For long-lived showcase tokens, the OAuth flow drops PKCE when `SPOTIFY_CLIENT_SECRET` is configured — confidential client, non-rotating tokens.
- **Genre + popularity data:** sourced from Last.fm because Spotify gutted the fields.
- **Edge filter:** same-artist track-track edges are skipped. Tracks of one artist trivially share all genres → would otherwise form a hairball clique with no information.
- **Graph layout:** force-tuning applied via `onEngineTick` (not a useEffect) to avoid "Cannot read properties of undefined (reading 'tick')" race conditions on remount.
- **Snapshot capability:** baked snapshots ship pre-aggregated top tracks/artists + per-track `firstPlayed`. Filters that need raw plays (time-of-day, day-of-week, session-entry, loved, skip-rate) silently no-op for snapshot viewers — the alternative was inflating the snapshot 100× by shipping all plays.
- **Storage:** Vercel Blob for showcase + shares in prod, `public/` files in dev. Module-scope read cache (5 min) keeps blob fetches off the hot path.
