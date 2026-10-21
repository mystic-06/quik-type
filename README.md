# QuikType

A high-performance, real-time multiplayer typing speed test application built with Next.js and Socket.IO.

Live Application: [quik-type.vercel.app](https://quik-type.vercel.app)

## Screenshot

![QuikType Application Screenshot](public/screenshots/preview.png)

## Features

### Core Features
- Countdown Timer: A five-second countdown synchronized across players before a test begins.
- Dynamic Test Phase Management: React hooks managing setup, countdown, test, and result phases.
- Real-Time Calculations: Words Per Minute (WPM), raw WPM, accuracy, and character count computed instantly.
- Adaptive Word Generation: Dynamic generation of words with configurable typing duration.

### Multiplayer Capabilities
- Room System: Create or join custom rooms using generated room codes.
- Synchronized Test Start: Coordinated countdown and test launch for all participants.
- Leaderboard Ranking: Post-test WPM and accuracy metrics compiled and ranked.
- Server-Scored Results: Clients send what they typed, never a score. The server scores it against the real text and its own clock.
- Reconnect and Refresh: A dropped connection or a page refresh keeps the player's seat (30 seconds), ready state and host role, and picks the round back up.
- Restart Recovery: With Redis configured, rooms survive a server restart or redeploy mid-game.
- Global Leaderboard: Best verified result per player, per test length, all time and per day.
- Teams: Squads of 1 to 4 with a captain and a team code. A team starts when it is full and everyone is ready; its score is the average of its members, and it has its own leaderboard.
- Team List (Roster): An organizer can load a CSV of pre-registered teams. Players then check in with their registered email and are placed in their team.

### Event Competition
- Separate participant and admin pages at `/event` and `/event/admin`.
- Admin-created 10- or 15-minute windows with a fixed server-side close time.
- Participants may take repeated 60-second attempts; their best attempt meeting the 80% accuracy floor is ranked by WPM, then accuracy.
- Participants share the same generated prompt for each attempt number, so their rounds are comparable.
- Final leaderboard positions are snapshotted when an event closes and retained with the event history.
- Event attempts and standings persist in PostgreSQL on Neon.
- Generic OIDC sign-in uses Authorization Code with PKCE and a server-side, HTTP-only session cookie. Configure the admin subject allowlist before opening the event.

## Tech Stack

### Frontend
- Next.js 16
- React 19
- TypeScript
- Tailwind CSS 4
- Lucide React (Icons)
- Socket.IO Client

### Backend
- Express.js
- Socket.IO Server
- Upstash Redis (optional): room persistence and the leaderboard
- Origin allow-list, per-connection rate limits, input validation

## Getting Started

### Prerequisites
- Node.js 22 or later
- npm, yarn, or pnpm

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/mystic-06/quik-type.git
   cd quik-type
   ```

2. Install the dependencies (the frontend at the root, and the server in `server/`, which has its own `package.json`):
   ```bash
   npm install
   npm run server:install
   ```

3. Configure the environment variables:
   Copy the example for the Next.js frontend and Express backend, then fill in their values:
   ```bash
   cp .env.example .env.local
   cp .env.example .env
   ```
   The backend reads `.env`; Next.js reads `.env.local`. Configure `FRONTEND_URL` and `NEXT_PUBLIC_SOCKET_URL` for the two deployed origins. Redis is optional: without the two `UPSTASH_REDIS_REST_*` values rooms and leaderboards run in memory.

### Run in Development

1. Start the Socket.IO Express backend server:
   ```bash
   npm run server:dev
   ```

2. In a separate terminal session, start the Next.js development frontend:
   ```bash
   npm run dev
   ```

3. Access the application in your browser at:
   [http://localhost:3002](http://localhost:3002)

### Run in Production

1. Build the production assets:
   ```bash
   npm run build
   ```

2. Start the production Next.js server:
   ```bash
   npm start
   ```

3. Start the production backend server:
   ```bash
   npm run server
   ```

### Tests

```bash
npm test                      # the server: rules, scoring, rooms, reconnects, Redis persistence, leaderboard (no network)
cd server && UPSTASH_LIVE_TEST=1 node --env-file=../.env --test test/upstashLive.test.js   # the same Redis code against the real Redis
```

## Environment Variables

For deployments, set the following environment variables:

- `NEXT_PUBLIC_SOCKET_URL`: URL of the deployed Socket.IO server.
- `PORT`: Server port (defaults to 3001).
- `NODE_ENV`: Set to "production".
- `FRONTEND_URL`: URL of the frontend client (comma separated for several). Only these origins, local development origins (outside production) and `ALLOWED_ORIGIN_PATTERNS` may connect.
- `OIDC_ISSUER`: OIDC issuer URL; for USAR FOSS OIDC use `https://oidc.fossclub.tech`. Its discovery document is at `/.well-known/openid-configuration`.
- `OIDC_CLIENT_ID`: OIDC client identifier.
- `OIDC_CLIENT_SECRET`: Optional secret for confidential clients; public clients use PKCE without it.
- `OIDC_CLIENT_AUTH_METHOD`: Optional confidential client token endpoint method: `client_secret_basic` (default) or `client_secret_post`.
- `OIDC_REDIRECT_URI`: Registered callback URL, `http://localhost:3001/auth/callback` for local development. Set an exact HTTPS URL in production.
- `OIDC_POST_LOGIN_URL`: Frontend event URL to open after sign-in.
- `OIDC_SCOPES`: Requested scopes (defaults to `openid profile email club` for USAR FOSS OIDC).
- `OIDC_DISPLAY_NAME_CLAIM`: Profile claim shown on the leaderboard (defaults to `name`). The stable OIDC `sub` is the participant key.
- `OIDC_ADMIN_SUBJECTS`: Comma-separated OIDC `sub` values allowed to control the event.
- `OIDC_SESSION_SECRET`: Random server-only secret used to sign the HTTP-only session cookie. Use at least 32 random bytes.
- `OIDC_COOKIE_DOMAIN`: Optional shared parent domain (for example `.example.com`) when the frontend and backend use sibling subdomains.
- `DATABASE_URL`: Neon PostgreSQL connection string. Use the pooled connection string (`-pooler` in the hostname) for the backend, and keep this value private on the backend only.

Generate a local session secret with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`. Register the exact callback URL (`http://localhost:3001/auth/callback` locally, your public API URL plus `/auth/callback` in production) as an app in [USAR FOSS OIDC](https://github.com/USAR-FOSS/OIDC/blob/main/docs/ADDING-AN-APP.md). Use a confidential client with `client_secret_basic`, Authorization Code + PKCE S256, and scopes `openid profile email club`. User identity comes from the verified `sub`; the leaderboard display name uses `name`. Add event admins to `OIDC_ADMIN_SUBJECTS` by their OIDC `sub`. Create a Neon database and set its pooled PostgreSQL connection string as `DATABASE_URL` on the backend service. The server creates its event tables automatically at startup; no separate migration command is needed.

The OIDC client must allow the Authorization Code flow with PKCE S256 and the configured scopes. ID tokens signed with RS256 or ES256 are supported. The app reads the configured display-name claim from the verified ID token or the OIDC UserInfo response.

In production, serve the frontend and API from the same site (for example `app.example.com` and `api.example.com`) so browsers accept the HTTP-only session cookie. Set `OIDC_COOKIE_DOMAIN` to the shared parent domain when needed. A frontend and API on unrelated domains may be blocked by third-party cookie restrictions.

Configure `DATABASE_URL` and OIDC before opening an event. Keep one backend instance active because live event state and timers are held in that process; Neon stores durable event state and history across restarts. Without OIDC, event APIs reject unauthenticated access. Casual multiplayer remains available without OIDC.

- `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`: enable Redis. Run exactly one server per Redis: a second one refuses to start while the first holds the lease. `REDIS_KEY_PREFIX` separates deployments that share one.
- `STATE_BACKEND=memory`: ignore the Redis values and run in memory.
- `TRUST_PROXY_HOPS`: reverse proxies in front of the server (defaults to 1 in production). Used to find the player's address for abuse limits.
- `ADMIN_TOKEN`: enables the organizer routes below and `GET /debug/rooms` (ids, phases and counts only) for requests sending `Authorization: Bearer <token>`. Without it those routes do not exist.

See `.env.example` for the complete list.

## How the Server Works

- **Identity.** Each browser keeps a random secret; the server derives the player's identity from it and stores only hashes. A refresh or reconnect is the same player, and a second tab takes the seat over. There is no sign-in.
- **A round** is `setup`, `countdown`, `test`, `results`, then the host starts a new round. Every phase change is driven by a deadline saved on the room, so after a restart the timers are re-armed from it.
- **Scoring.** The client sends the text it typed. The server compares it to the room's text, times the round itself, and rejects results sent before the time is up unless the whole text was finished. Results above 250 WPM are shown in the room but kept off the leaderboard.
- **Redis** holds a copy of every room (written a moment after each change, only what changed) and the leaderboard (a sorted set per test length, best score per player). Redis is never on the path of a player's action: if it fails the game carries on in memory and catches up when it returns.
- **Teams** follow the Matiks squad rules. A team has 1 to 4 players (a roster team may be larger), a captain, and a code like `AB-12`. A player is in one team at a time. The team must be full, or locked by the captain at its current size, and every member (who is not excused) must be connected and ready before a round starts. Members keep their seat when they disconnect and leave only on purpose. The team's result is the average of its members, a member who did not play counting as zero. It goes on the team leaderboard only if the team was full, no organizer disqualified it, and every member's result was verified.
- **Forming a team** is done over HTTP with the browser secret in an `x-player-secret` header (`POST /teams/create`, `/teams/join`, `/teams/checkin`, `/teams/leave`, `GET /teams`), then the team plays in its room over the socket.
- **The team list (roster).** While one is loaded, free team making is switched off and players check in with their registered email. The first browser to check in with an email owns that seat, so knowing a teammate's email is not enough to take their place; an organizer can reset a seat. Emails are personal data: they are kept only on the server (in Redis) and shown only to organizers, never to players. `GET /teams` lists team names, codes and progress, no emails.
- **The typing event and the rooms game share one server.** The event (club sign-in, timed attempts, admin console, history in PostgreSQL) needs `DATABASE_URL`; without it, or if the database is unreachable, the rooms game still runs and `/event` is off (503). The event sign-in is a cookie, so `/auth`, `/event` and the event sockets accept only the exact frontends in `FRONTEND_URL` (plus localhost outside production), never the preview-deployment patterns, and the game's own routes never allow credentials. `npm run stress-test` drives the rooms game with bots.
- **Limits.** Per-socket limits on every event, per-address limits on connections and requests, a cap on rooms and players, and validated room codes and usernames.
- **Organizer routes** (behind `ADMIN_TOKEN`): `GET|POST|DELETE /admin/roster` (POST takes the CSV as the request body; either the one-row-per-team layout `team_name,email_1,email_2,...` or an Unstop export), `POST /admin/roster/reset-member` `{email}`, `GET /admin/teams`, and `POST /admin/teams/:code/excuse|kick|dissolve|disqualify|reinstate`. Excusing removes a member from the ready gate and the average for their team's rounds; disqualifying takes a team off the team leaderboard and keeps it off.
  ```bash
  curl -X POST $SERVER/admin/roster -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: text/csv" --data-binary @teams.csv
  ```
- **Endpoints.** `GET /health` (includes the state backend and Redis status), `GET /leaderboard?duration=30&period=all|day&limit=50&me=<player id>`, and the same with `&scope=team&me=<team code>` for the team leaderboard.

## Project Structure

```
src/
├── app/
│   ├── event/             # Participant event page and admin controls
│   ├── room/[roomId]/     # Dynamic room interfaces
│   ├── multiplayer/       # Multiplayer lobby logic
│   ├── leaderboard/       # Score rankings
│   └── page.tsx           # Application landing page
├── components/
│   ├── CountdownPhase.tsx # Pre-test countdown UI
│   ├── Header.tsx         # Navbar and branding
│   ├── SetupPhase.tsx     # Room configuration UI
│   ├── ResultPhase.tsx    # Post-game statistics and rankings
│   └── TypingArea.tsx     # Core typing game logic
├── hooks/
│   └── useSocket.ts       # Socket.IO event listener hook
server/                 # Its own package.json; the Docker image installs only this
├── auth/              # OIDC login and event session validation (events)
├── config/            # Settings (timings and limits) and the origin policy
├── controllers/       # Socket.IO event handlers
├── lib/               # Scoring, validation, rate limits, Redis access
├── managers/          # Rooms, players and the round state machine; PostgreSQL-backed event state
├── services/          # Redis room copy, leaderboard
├── jobs/              # Periodic housekeeping
├── routes/            # REST API endpoints
├── test/              # Server tests
├── app.js             # Builds the server (also used by the tests)
└── index.js           # Process entry: start, signals, clean shutdown
```

## License

This project is private and not licensed for public use.
