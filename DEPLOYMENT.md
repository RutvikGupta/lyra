# Lyra deployment runbook

End-to-end checklist for getting Lyra live on Vercel from a clean state.
Skip steps you've already done. Items in **bold** are gotchas that have
bitten us during local setup.

---

## 0. Prerequisites

- A Spotify Developer app (Client ID + Client secret).
- A GitHub repo containing this codebase, pushed to `main`.
- A Vercel account with the GitHub repo accessible.
- The Vercel CLI installed locally (`npm i -g vercel`) — optional but
  makes env-var management painless.

## 1. Create the Vercel project

1. Vercel Dashboard → **Add New → Project**.
2. Import the `lyra` GitHub repo.
3. Framework preset: **Next.js** (auto-detected).
4. Don't deploy yet — set env vars first (next step) so the first build
   has them.

## 2. Provision Vercel Blob (for the library showcase + shares)

Both the owner's library snapshot AND any user-shared constellations
(`/share/{id}`) live in Vercel Blob in prod. Without this, the
"Refresh showcase" and "Share constellation" buttons have no place to
write to (Vercel's `public/` folder is read-only at runtime).

1. Vercel Dashboard → your project → **Storage** tab → **Create
   Database** → **Blob**.
2. Name it (e.g. `lyra-showcase`) and **connect to project**.
3. Vercel injects `BLOB_READ_WRITE_TOKEN` into your project's env vars
   automatically — verify it appears under **Settings → Environment
   Variables** for Production (and Preview if you want previews to share
   the same blob).

## 3. Set environment variables

Vercel Dashboard → your project → **Settings → Environment Variables**.
Set these for **Production** (and **Preview** if you want previews to
have the same showcase). Don't set for Development unless you're using
`vercel dev`.

| Name | Value | Notes |
|---|---|---|
| `SPOTIFY_CLIENT_ID` | (your client ID) | from Spotify dashboard |
| `SPOTIFY_CLIENT_SECRET` | (your secret) | **required** — without this, Spotify rotates refresh tokens on every use and showcase dies on the first server restart |
| `SPOTIFY_REDIRECT_URI` | `https://<your-domain>/api/auth/callback` | use the prod domain, not `127.0.0.1` |
| `LASTFM_API_KEY` | (your key) | required for genre coloring |
| `SHOWCASE_REFRESH_TOKEN` | (your `spotify_refresh` cookie) | see step 5 — must be minted via the **non-PKCE** flow (i.e. with `SPOTIFY_CLIENT_SECRET` already set in env when you OAuth) |
| `CRON_SECRET` | random hex | `openssl rand -hex 32`. Used by `/api/cron/refresh-showcase` |
| `BLOB_READ_WRITE_TOKEN` | (auto-injected) | from step 2 — verify it's there |

## 4. Update the Spotify Developer dashboard

1. https://developer.spotify.com/dashboard → your Lyra app → **Edit
   settings**.
2. Under **Redirect URIs**, **add** `https://<your-domain>/api/auth/callback`.
   Keep the existing `http://127.0.0.1:3000/api/auth/callback` for local
   dev.
3. Save.

> Use `127.0.0.1`, not `localhost` — Spotify rejects `localhost` since
> Nov 2025. Production domain must be HTTPS.

## 5. Mint the `SHOWCASE_REFRESH_TOKEN`

The token must be minted under the **non-PKCE confidential flow**, which
only happens when `SPOTIFY_CLIENT_SECRET` is set on the server doing the
OAuth. Two paths — choose one:

### Path A — mint locally, paste into Vercel

1. Make sure `SPOTIFY_CLIENT_SECRET` is set in your local `.env.local`.
2. Restart `npm run dev` so the secret is loaded.
3. Revoke any previous Lyra access at
   https://www.spotify.com/account/apps so old PKCE tokens die.
4. Open http://127.0.0.1:3000/api/auth/login → finish Spotify consent.
5. DevTools → **Application → Cookies → `127.0.0.1` → `spotify_refresh`** →
   copy **Value** (long opaque string starting with `AQ…`, ~130 chars).
6. Paste it as `SHOWCASE_REFRESH_TOKEN` in Vercel env vars (production).

### Path B — mint on the deployed site

Same flow but on `https://<your-domain>`. Useful if you want different
tokens per environment.

> The token survives restarts because the non-PKCE flow issues
> long-lived tokens. If for any reason it does get rotated, the
> in-memory state will track the rotation while the process is alive;
> after a Vercel cold start, the env-var token is what's used.

## 6. Configure Vercel cron auth

`vercel.json` already wires `/api/cron/refresh-showcase` to run every
6 hours.

1. Vercel Dashboard → your project → **Settings → Cron Jobs** →
   the cron entry → **Edit**.
2. Under **Authorization Header**, paste `Bearer <CRON_SECRET>` (using
   the value you set in step 3).
3. Save.

Without this header, the cron route returns 401 and the cache stays
cold. (The route is still callable without auth if `CRON_SECRET` is
unset, but that's not recommended for prod.)

## 7. First deploy

1. Push to `main` (or click **Deploy** in the Vercel UI).
2. Wait for the build. Watch the build log for `Generating static
   pages` and `Route (app)` — you should see all `/api/showcase/*`
   routes listed.
3. Once deployed, visit `https://<your-domain>` in **incognito**
   (so you're not authed). You should see:
   - Showcase section with your name + avatar + 12 artist tiles
   - Now playing / Recently played / Top artists populated
   - **Top artists** and **Track library** CTAs
   - The attribution chip "*Cards below show the owner's live
     listening — Connect Spotify above to see yours.*"

If anything is empty, the most likely cause is that
`SHOWCASE_REFRESH_TOKEN` was minted under PKCE before
`SPOTIFY_CLIENT_SECRET` was set. Repeat step 5.

## 8. Bake the library snapshot

The home Showcase shows artists, but `/library` (the track
constellation) shows an empty state until you publish a snapshot.

1. Sign in to your deployed site at `https://<your-domain>` (the same
   account whose token is in `SHOWCASE_REFRESH_TOKEN`).
2. Go to `/upload`. Drop your Spotify ZIP. Wait for parsing.
3. Go to `/library`. Wait for the constellation to render.
4. Click **↻ Refresh showcase** in the top-right.
5. The button bakes a snapshot from your IndexedDB and POSTs it to
   `/api/showcase/library/publish`, which writes it to Vercel Blob.
6. Reload `/library` in **incognito** to verify the snapshot serves
   to unauthed visitors.

The button is gated to the showcase owner only — the server-side
publish endpoint also independently rejects non-owners with a 403.

> Re-bake whenever you upload fresh streaming history. The blob URL is
> stable, so no Vercel redeploy is needed — visitors see the new
> snapshot within ~60 s (read-side cache TTL).

## 9. Custom domain (optional)

1. Vercel Dashboard → your project → **Settings → Domains** → add your
   domain.
2. Update Spotify Developer dashboard's Redirect URI to match (step 4).
3. Update `SPOTIFY_REDIRECT_URI` env var to the new domain (step 3).
4. Redeploy.

## 10. Operational notes

### Token rotation — security hygiene

The values in this repo's chat history (`SHOWCASE_REFRESH_TOKEN`,
`SPOTIFY_CLIENT_SECRET`) have been exposed. Once everything is working:

1. Spotify dashboard → Lyra app → **Reset client secret** → grab the new
   one → update `SPOTIFY_CLIENT_SECRET` locally and on Vercel.
2. https://www.spotify.com/account/apps → **Remove access** → re-OAuth
   → grab new `spotify_refresh` cookie → update
   `SHOWCASE_REFRESH_TOKEN` on Vercel.
3. Redeploy (env-var changes don't auto-trigger a deploy — go to
   Deployments → Redeploy latest).

### Verifying showcase health

- `/api/showcase/profile` — returns `{profile: {...}}` if the token
  is alive, `{profile: null}` if not.
- `/api/showcase/now-playing` — returns `{isPlaying: …, track?: {...}}`.
- `/api/showcase/top-artists?time_range=long_term` — returns
  `{items: [...]}`.
- `/api/showcase/library` — returns the baked snapshot or 404 if
  nothing has been published.
- `/api/share/<id>` — returns a published share or 404. Use a known
  ID from a recent `↗ Share constellation` click to test.

### What to do if the showcase goes dark

1. Hit `/api/showcase/profile`. If it returns null, the token is dead.
   Re-mint per step 5.
2. Hit `/api/showcase/library`. If 404, re-bake per step 8.
3. Check Vercel Deployment logs for `[showcase] refresh token rejected`
   — that's the latch firing on a dead env-var token.

### Cost expectations

- Vercel Hobby tier covers everything here for personal use.
- Vercel Blob: free tier is 1 GB stored / 10 GB bandwidth — the
  snapshot is ~50 KB and gets downloaded on each `/library` cold
  visit (cached for 60s in memory after that). Won't approach limits.
- Spotify API: cron + visitor traffic is well under their unauthed
  rate limits when cached at 5–60 min TTLs as configured.
