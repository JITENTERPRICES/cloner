# SHOOTAY

**BUILD DIFFERENT. SHOOT DIFFERENT.** — an online multiplayer voxel FPS that runs in the browser on desktop and Android.

Three.js client, Node.js + Socket.IO authoritative server, PostgreSQL persistence. One project: accounts, inventory, economy, missions and multiplayer all share the same database.

## What is in here

| Area | Status |
|---|---|
| First-person gameplay: aim, fire, reload, switch, sprint, jump, crouch, momentum slide + slide-jump, recoil, sway, hit markers, damage indicators, health regen, footsteps, landing, inspect | Implemented |
| Desktop (keyboard/mouse, pointer lock) and Android (virtual stick, draggable buttons, left-handed mode, auto-fire option) | Implemented |
| Real multiplayer: accounts, matchmaking, private rooms with `/join/ROOMCODE` invite links, host controls, friends, online status, parties, invites | Implemented |
| Modes: Team Deathmatch, Free For All, Gun Game (12-weapon ladder), Domination (3 zones), Battle Royale, Private Matches, plus a solo Training Range | Implemented — see *Known limits* for Battle Royale |
| 32 weapons, 216 attachments, 20 skins, 10 cosmetic effects, six rarities, combination rarity | Implemented (procedural 3D models) |
| Mystery boxes with published odds, server-side rolls, duplicate refunds | Implemented |
| Deyes economy: 100 per verified elimination, credited only at validated match end, idempotent ledger | Implemented |
| 6,000 unique daily missions in the database, 3 per player per day, server-side progress, verified claims | Implemented |
| 3D operator editor: 6 operators, 204 original clothing items in 12 slots, searchable catalogue, live preview | Implemented |
| Three maps: Urban Streets, Abandoned Industrial Complex, Downtown Night District | Implemented |
| Effects: tracers, sparks, dust, smoke, explosive barrels, impact decals, adjustable stylised gore (default 59%) | Implemented |
| Settings saved to the account: graphics, audio, music, sensitivity, mobile layout, crosshair, HUD, accessibility, gore, privacy | Implemented |
| Lobby soundtrack from the four supplied recordings | **Player implemented; the recordings themselves have not been supplied yet** — see *Soundtrack* |

## Folder structure

```
shootay/
  frontend/   Three.js client (Vite). src/engine = rendering, audio, input; src/game = match + movement; src/ui = lobby, panels, HUD
  backend/    Express REST API + Socket.IO game server. src/game/Room.ts is the authoritative match simulation
  shared/     Code used by BOTH sides: weapons, attachments, maps, modes, missions, clothing, physics, settings
  database/   schema.sql and the setup/seed script
  assets/     music-src/ (your MP4s go here) and music/ (extracted OGG + manifest)
  config/     .env.example, Vite + TypeScript config, Dockerfile, docker-compose.yml
  scripts/    data checks, end-to-end server test, audio extraction
```

## Install and run

Requirements: Node.js 20.6+ and PostgreSQL 14+ (ffmpeg only for the soundtrack).

```bash
cd shootay
npm install

# 1. database
sudo -u postgres psql -c "CREATE USER shootay WITH PASSWORD 'choose-a-password'" -c "CREATE DATABASE shootay OWNER shootay"
cp config/.env.example .env        # then edit DATABASE_URL and JWT_SECRET
npm run db:setup                   # creates tables, seeds the 6,000 missions (also happens on server boot)

# 2a. development: API on :3000, client with hot reload on :5173
npm run dev

# 2b. production-style: one server on :3000 serving everything
npm run build
npm start
```

Open `http://localhost:5173` (dev) or `http://localhost:3000` (built). Create an account and you are in the lobby.

## Testing

```bash
npm test            # data integrity: weapon/attachment/mission counts and uniqueness, balance, box odds, map spawn points
npm run typecheck   # TypeScript across client, server and shared code

# end-to-end server test: two real accounts over HTTP + Socket.IO play a full Team Deathmatch
SHOOTAY_TEST=1 npm start &          # test mode shortens countdowns; never use it in production
npx tsx scripts/test-server.ts
```

The end-to-end test checks, among others: forged tokens and unauthenticated sockets are refused; teleporting is corrected; a shot from a forged origin is ignored; Deyes are **not** credited at kill time; the match end credits exactly 100 per kill; replaying a match reward is a no-op; double mission claims are rejected; boxes cannot be opened without funds; unowned weapons cannot be equipped; party members follow their leader.

Manual checks:

- **Solo:** Game Modes → Training Range → *Enter range*. Static targets, no rewards.
- **Two players:** two browsers (or one normal + one private window), two accounts. Multiplayer → *Create private room* → **COPY INVITE LINK** → open the link in the second browser, sign in, and you land in the room. Host presses START MATCH.
- **Public matchmaking:** both accounts press PLAY with the same mode selected. A match starts when two players are in.
- **Phone on your Wi-Fi:** `npm run dev`, then open `http://<your-computer-ip>:5173` on the phone.

## Soundtrack

The lobby music player (play, pause, previous, next, seek, volume, mute, track list, shuffle, repeat, saved preferences, ducking during matches) plays **only** the developer's four recordings:

`255.mp4`, `257.mp4`, `221.mp4`, `201.mp4`

They were not present in the development environment, so nothing has been extracted and no audio has been substituted. Until they are added the player shows "Soundtrack not installed". To install:

```bash
cp /path/to/{255,257,221,201}.mp4 assets/music-src/
npm run audio:extract        # needs ffmpeg; writes assets/music/*.ogg + manifest.json
```

The script only transcodes the audio stream to OGG Vorbis — no trimming, effects or normalisation — and fails if any of the four files is missing. Both folders are git-ignored on purpose: distribute the recordings only if you hold the rights or the artists' permission.

All other audio (weapons, reloads, footsteps, UI, matchmaking, victory/defeat stingers, ambience) is synthesised in the browser with WebAudio, so there are no sound files to license or ship.

## Security model

The client is never trusted. It sends *intent*; the server decides outcomes.

- **Auth:** bcrypt password hashes, signed JWTs (HS256, 7 days), rate-limited login, constant-time-ish login failures, one live session per account.
- **Combat:** `shoot` messages are checked for fire rate, ammunition, reload state, origin (must match the server's position for that player) and pellet spread; the server ray-casts against the shared map geometry and lag-compensated hitboxes and applies damage itself.
- **Movement:** every position update is checked for speed, map bounds, flying and clipping; violations are rejected and the client is snapped back.
- **Economy:** `backend/src/db.ts → moveDeyes` is the only code that changes a balance. It locks the row, refuses overdrafts and writes a ledger row with a unique `(user, reason, reference)` key, so no reward can be paid twice. Match rewards are paid in one transaction at match end, capped per repeated victim, and only when at least two players took part.
- **Missions, boxes, inventory, loadouts:** all derived from database state; box rolls use a CSPRNG on the server; equipped items are re-validated against ownership every time a player joins a match.
- **Transport/API:** helmet + CSP, 16 kB JSON limit, 8 kB socket packets, per-socket token-bucket rate limits, parameterised SQL everywhere, generic 500 responses.
- **Secrets:** only in environment variables (`config/.env.example`). Production refuses to start without `JWT_SECRET` and `DATABASE_URL`.

This is "basic anti-cheat", as requested: it stops forged kills, currency edits, speed/teleport hacks and rapid-fire, but an aimbot that sends plausible inputs is not detected.

## Deployment

The server is a single Node process that serves the built client, the API and WebSockets. It needs a PostgreSQL database and three settings.

**Docker (any VPS):**

```bash
cd shootay/config
printf 'POSTGRES_PASSWORD=%s\nJWT_SECRET=%s\nPUBLIC_URL=https://your-domain.com\n' "$(openssl rand -hex 16)" "$(openssl rand -hex 48)" > .env
docker compose up --build -d
```

Put a TLS reverse proxy (Caddy, nginx, Traefik) in front of port 3000 and make sure it forwards WebSocket upgrades. The app already sets `trust proxy`.

**Managed hosts (Render, Railway, Fly.io…):** create a PostgreSQL instance and a web service from the `shootay/` directory with build command `npm ci && npm run build`, start command `node backend/dist/server.js`, and env vars `NODE_ENV=production`, `DATABASE_URL`, `DATABASE_SSL=true` (if the provider requires TLS), `JWT_SECRET`, `PUBLIC_URL`. Tables and missions are created on first boot.

**Client on a separate static host / CDN:** build with `VITE_SERVER_URL=https://api.your-domain.com npm run build:client`, upload `frontend/dist`, configure the host to serve `index.html` for unknown paths (so `/join/ROOMCODE` works), and set `CORS_ORIGINS=https://your-domain.com` on the server.

**Scaling note:** rooms live in the memory of one process. One instance is the supported topology; running several needs sticky sessions plus a shared room directory, which is not built.

## Android optimisation

- Settings → Graphics → **Low** is the intended preset for most phones: Lambert shading, no dynamic point lights (halo sprites and ground light pools stand in for them), no shadows, device pixel ratio capped at 1.
- **Render resolution** (40–100%) is the biggest single lever; 70% is a good start on mid-range devices.
- Lower **Particle density** and **View distance** next.
- World geometry is merged into one mesh per material (about 15 draw calls per map); particles, decals and tracers are pooled and instanced, so firefights do not allocate.
- Play in landscape. In Chrome use *Add to Home screen* for fullscreen (a web app manifest is included).
- Settings → Mobile: button size/opacity, left-handed layout, auto-sprint, auto-fire, and *Customise button layout* to drag every button.
- To ship on Google Play, wrap the hosted URL as a Trusted Web Activity (Bubblewrap) — that packaging step is not included here.

## Known limits (stated plainly)

- **Soundtrack files are not included** (see above).
- **Battle Royale** is compact: it uses the three arena maps with a shrinking zone, single life and up to 12 players. There is no large dedicated map, parachuting or ground loot — players drop in with their loadout.
- **Weapon and character art is procedural voxel geometry** built in code, with procedural canvas textures. There are no hand-modelled or skeletal-animated assets; animation is procedural.
- **Clothing brands:** every item is an original design under a fictional label. Searching "Nike", "Off-White", "Balenciaga", "Hellstar", "Godspeed" etc. returns a notice saying there is no licensed collection, plus original items in a similar style. Licensed or user-submitted items can be added as rows in the `catalog_items` table (they are merged into the catalogue automatically); there is no upload/moderation UI yet.
- **Testing done:** automated data and end-to-end server tests, plus headless Chromium runs on desktop and emulated-phone viewports (lobby, every panel, training range, invite link, a live two-player match). It has **not** been tested on physical Android hardware or under real internet latency.
- No bots, voice chat, text chat, ranked play, replays or spectator camera.
