# Listening Web

A 3D starfield visualization of your Spotify listening history with a real-time now-playing overlay.

## One-time setup

Add the dev redirect URI to your Spotify app:

1. Open https://developer.spotify.com/dashboard
2. Click your app → **Edit settings**
3. Under **Redirect URIs**, add: `http://127.0.0.1:3000/api/auth/callback`
4. Click **Save**

> Use `127.0.0.1`, not `localhost` — Spotify rejects `localhost` since Nov 2025.

## Run

```bash
npm install
npm run dev
```

Open http://127.0.0.1:3000 and click **Connect Spotify**. After approving the scopes, play something on Spotify — the now-playing panel polls every 5 seconds.

## Phases

- ✅ **Phase 1** — PKCE auth + now-playing widget
- ⏳ **Phase 2** — Upload extended streaming history ZIP, parse, dedupe to unique tracks/artists
- ⏳ **Phase 3** — Per-artist genre enrichment via Spotify Web API + Last.fm `artist.getSimilar` for cross-genre edges
- ⏳ **Phase 4** — 3D force graph (`react-force-graph-3d`), precomputed layout, hover/click for track info
- ⏳ **Phase 5** — Wire now-playing into the graph: pulse the current node, trace recent listening session
- ⏳ **Phase 6** — Polish: filters, search, share links

## Notes

- **Spotify Web API in 2026**: `audio-features`, `recommendations`, `related-artists`, batch `GET /tracks?ids=`, and editorial playlist endpoints are gone for new apps. Genre data comes from `GET /artists/{id}.genres` only — no batch — with aggressive caching.
- **Dev mode**: capped at 5 users, requires Premium account.
- **Real-time**: polling `/me/player/currently-playing` every 5s. Spotify has no webhooks for playback.
