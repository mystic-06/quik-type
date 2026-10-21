// Forming teams. Teams are made, joined and checked into over HTTP, then played in the room over the socket.
// The player is identified by the browser secret in the `x-player-secret` header, the same one the socket connects with.

const express = require("express");
const { GameError } = require("../lib/errors");
const { identityFrom, validSecret } = require("../lib/identity");
const { clientIp } = require("../lib/rateLimit");
const { cleanUsername, cleanTeamName, normalizeTeamCode, normalizeEmail } = require("../lib/validate");

const ROSTER_LOCKED = "An event roster is loaded, so teams are pre-assigned. Check in with the email you registered with.";

module.exports = ({ manager, roster, settings, teamLimiter }) => {
  const router = express.Router();
  const json = express.json({ limit: "8kb" });

  /** Rate limit, identify the player, and turn a GameError into a JSON error. */
  const handle = (handler, { needsPlayer = true } = {}) => async (req, res) => {
    const ip = clientIp(req.headers, req.socket.remoteAddress, settings.trustProxyHops);
    if (!teamLimiter.allow(ip)) {
      res.status(429).json({ error: "Too many requests. Try again in a minute." });
      return;
    }
    const secret = req.get("x-player-secret");
    if (needsPlayer && !validSecret(secret)) {
      res.status(400).json({ error: "Missing player identity." });
      return;
    }
    req.player = validSecret(secret) ? identityFrom(secret) : null;
    try {
      await handler(req, res);
    } catch (err) {
      if (err instanceof GameError) {
        res.status(err.status).json({ error: err.message });
      } else {
        console.error("Team route failed:", err);
        res.status(500).json({ error: "Something went wrong" });
      }
    }
  };

  const summary = (room) => ({ code: room.id, name: room.team.name, targetSize: room.team.targetSize });

  const usernameFor = (body, fallbacks = []) => {
    const name = [body?.username, ...fallbacks].map(cleanUsername).find(Boolean);
    if (!name) throw new GameError("Username must be 1 to 20 characters.");
    return name;
  };

  // The team list: with a roster loaded, every registered team and how far along it is (never emails or people's names).
  // With the secret header, also the team this player is in.
  router.get(
    "/teams",
    handle(
      (req, res) => {
        const code = req.player ? manager.teamOf(req.player.key) : null;
        const room = code ? manager.getRoom(code) : null;
        res.json({
          rosterActive: roster.isActive(),
          teams: roster.isActive() ? roster.publicList((teamCode) => manager.teamStatus(teamCode)) : [],
          myTeam: room ? summary(room) : null,
        });
      },
      { needsPlayer: false }
    )
  );

  router.post(
    "/teams/create",
    json,
    handle((req, res) => {
      if (roster.isActive()) throw new GameError(ROSTER_LOCKED, 403);
      const name = cleanTeamName(req.body?.name);
      if (!name) throw new GameError("Team name must be 1 to 30 characters.");
      const username = usernameFor(req.body);
      if (manager.listTeams().some((t) => t.name.toLowerCase() === name.toLowerCase())) throw new GameError("A team with that name already exists.");

      const { room } = manager.createTeam({ name, size: Number(req.body?.size), key: req.player.key, pubId: req.player.pubId, username });
      res.status(201).json(summary(room));
    })
  );

  router.post(
    "/teams/join",
    json,
    handle((req, res) => {
      if (roster.isActive()) throw new GameError(ROSTER_LOCKED, 403);
      const code = normalizeTeamCode(req.body?.code);
      if (!code) throw new GameError("Enter the team code.");
      const username = usernameFor(req.body);
      const { room } = manager.joinTeam({ code, key: req.player.key, pubId: req.player.pubId, username });
      res.json(summary(room));
    })
  );

  // Check in with the registered email: the player is placed in their team, which is created when its first member arrives.
  router.post(
    "/teams/checkin",
    json,
    handle((req, res) => {
      if (!roster.isActive()) throw new GameError("No event roster is loaded.", 404);
      const email = normalizeEmail(req.body?.email);
      if (!email) throw new GameError("Enter a valid email address.");

      const found = roster.find(email);
      if (!found) throw new GameError("That email is not registered in any team for this event. Check it with your team leader or the organizers.", 404);
      const seat = roster.seatOf(req.player.key);
      if (seat && seat.member.email !== email) {
        throw new GameError("This browser is already checked in as another member. Ask an organizer to reset it.", 409);
      }

      const claim = (() => {
        try {
          return roster.claim(email, req.player.key);
        } catch (err) {
          if (err instanceof GameError) err.status = 409;
          throw err;
        }
      })();
      const { team, member, firstTime } = claim;

      try {
        const username = usernameFor(req.body, [member.name, email.split("@")[0]]);
        const player = { key: req.player.key, pubId: req.player.pubId, username };
        const existing = manager.getRoom(team.teamCode);
        const room = existing
          ? manager.joinTeam({ code: team.teamCode, ...player, makeCaptain: member.isLeader }).room
          : manager.createTeam({ code: team.teamCode, name: team.teamName, size: team.targetSize, roster: true, ...player }).room;
        res.json(summary(room));
      } catch (err) {
        if (firstTime) roster.unclaim(email, req.player.key);
        throw err;
      }
    })
  );

  // Leave the team this player is in (before opening the room, or instead of it).
  router.post(
    "/teams/leave",
    handle((req, res) => {
      const code = manager.teamOf(req.player.key);
      if (!code) throw new GameError("You are not in a team.");
      manager.removePlayer(code, req.player.key);
      res.json({ left: code });
    })
  );

  return router;
};
