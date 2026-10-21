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
- Node.js 18 or later
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
   Copy the example environment file and fill in your details:
   ```bash
   cp .env.example .env
   ```
   Note: Configure FRONTEND_URL and NEXT_PUBLIC_SOCKET_URL to point to your respective backend and frontend hostnames. Redis is optional: without the two `UPSTASH_REDIS_REST_*` values everything runs in memory.

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
   [http://localhost:3000](http://localhost:3000)

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
├── config/            # Settings (timings and limits) and the origin policy
├── controllers/       # Socket.IO event handlers
├── lib/               # Scoring, validation, rate limits, Redis access
├── managers/          # Rooms, players and the round state machine
├── services/          # Redis room copy, leaderboard
├── jobs/              # Periodic housekeeping
├── routes/            # REST API endpoints
├── test/              # Server tests
├── app.js             # Builds the server (also used by the tests)
└── index.js           # Process entry: start, signals, clean shutdown
```

## License

This project is private and not licensed for public use.
