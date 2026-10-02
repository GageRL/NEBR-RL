# Nebraska Esports training hub

Players plan their week, check in to sessions and reflect. The coach manages logins, sees the roster, and sets weekly requirements.

Static site in `public/`, one Cloudflare Pages Function in `functions/api/`, and a Cloudflare D1 database. No build step.

## Deploy on Cloudflare Pages

1. **D1 database:** Workers & Pages → D1 → Create database (any name, e.g. `nebraska-esports`).
2. **Pages project:** Workers & Pages → Create → Pages → Connect to Git → pick this repo.
   - Framework preset: None
   - Build command: *(leave empty)*
   - Build output directory: `public`
3. **Bind the database:** Project → Settings → Bindings → Add → D1 database. Variable name `DB`, pick the database. Add it for Production (and Preview if you use previews).
4. **Redeploy** (Deployments → Retry deployment) so the binding takes effect.
5. **First visit** asks you to create the coach account. Tables are created automatically.

## Hourly ranks

A scheduled task on the coach's computer reads each player's Rocket League Tracker page in the Claude desktop app's browser and posts the numbers here, signed in as the coach.

- `GET /api/coach/trackers` → `{ players: [{ id, name, trackerUrl }] }`
- `POST /api/coach/ranks` with `{ updates: [{ id, playlists: { duel|doubles|standard: { tier, div, mmr, games } } }] }`

Tiers use names like `Diamond I` or `Grand Champion II`; divisions use `Div I` through `Div IV`.

## Local development

```
npx wrangler pages dev public --d1 DB
```
