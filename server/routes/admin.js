// Organizer routes: the team list and team governance. Behind ADMIN_TOKEN (see lib/adminAuth.js).

const express = require("express");
const { GameError } = require("../lib/errors");
const { requireAdmin } = require("../lib/adminAuth");
const { normalizeEmail, normalizeTeamCode } = require("../lib/validate");

module.exports = ({ manager, roster, leaderboard, settings }) => {
  const router = express.Router();
  router.use("/admin", requireAdmin);

  const route = (handler) => (req, res) => {
    try {
      Promise.resolve(handler(req, res)).catch((err) => fail(res, err));
    } catch (err) {
      fail(res, err);
    }
  };
  const fail = (res, err) => {
    if (err instanceof GameError) {
      res.status(err.status).json({ error: err.message });
    } else {
      console.error("Admin route failed:", err);
      res.status(500).json({ error: "Something went wrong" });
    }
  };
  const teamCode = (req) => {
    const code = normalizeTeamCode(req.params.code);
    if (!code) throw new GameError("Invalid team code.");
    return code;
  };

  // The roster: GET shows it (with emails), POST replaces it with a CSV body, DELETE removes it
  router.get("/admin/roster", route((_req, res) => res.json({ active: roster.isActive(), teams: roster.adminList() })));

  router.post(
    "/admin/roster",
    express.text({ type: () => true, limit: settings.rosterMaxBytes }),
    route((req, res) => {
      const result = roster.load(typeof req.body === "string" ? req.body : "");
      res.status(201).json(result);
    })
  );

  router.delete("/admin/roster", route((_req, res) => {
    roster.clear();
    res.json({ active: false });
  }));

  router.post(
    "/admin/roster/reset-member",
    express.json({ limit: "4kb" }),
    route((req, res) => {
      const email = normalizeEmail(req.body?.email);
      if (!email || !roster.resetMember(email)) throw new GameError("That email is not in the roster.", 404);
      res.json({ reset: email });
    })
  );

  // The teams that exist right now
  router.get("/admin/teams", route((_req, res) => res.json({ teams: manager.listTeams() })));

  const json = express.json({ limit: "4kb" });

  router.post("/admin/teams/:code/excuse", json, route((req, res) => {
    manager.setExcused(teamCode(req), String(req.body?.id ?? ""), req.body?.excused !== false);
    res.json({ ok: true });
  }));

  router.post("/admin/teams/:code/kick", json, route((req, res) => {
    manager.kick(teamCode(req), String(req.body?.id ?? ""));
    res.json({ ok: true });
  }));

  router.post("/admin/teams/:code/dissolve", route(async (req, res) => {
    const code = teamCode(req);
    manager.dissolve(code);
    await leaderboard.teams.remove(code);
    res.json({ ok: true });
  }));

  // A disqualified team keeps playing but is taken off the team leaderboard and stays off it
  router.post("/admin/teams/:code/disqualify", route(async (req, res) => {
    const code = teamCode(req);
    manager.setDisqualified(code, true);
    await leaderboard.teams.remove(code);
    res.json({ ok: true });
  }));

  router.post("/admin/teams/:code/reinstate", route((req, res) => {
    manager.setDisqualified(teamCode(req), false);
    res.json({ ok: true });
  }));

  return router;
};
