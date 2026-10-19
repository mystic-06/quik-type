const express = require("express");
const { requireSession, requireAdmin, requireTrustedOrigin } = require("../auth/oidc");

function routeError(res, error) {
  const code = /required|not found|invalid|closed|active|lobby|in progress|already/.test(error.message) ? 400 : 500;
  return res.status(code).json({ error: error.message });
}

module.exports = eventManager => {
  const router = express.Router();

  router.get("/event/state", (_req, res) => {
    try { return res.json({ event: eventManager.event ? eventManager.snapshot() : null }); }
    catch (error) { return routeError(res, error); }
  });

  router.get("/event/history", requireSession, requireAdmin, async (_req, res) => {
    try { return res.json({ events: await eventManager.listEvents() }); }
    catch (error) { return routeError(res, error); }
  });

  router.get("/event/history/:eventId", requireSession, requireAdmin, async (req, res) => {
    try {
      const event = await eventManager.eventDetails(req.params.eventId);
      return event ? res.json({ event }) : res.status(404).json({ error: "Event not found" });
    } catch (error) { return routeError(res, error); }
  });

  router.get("/event/admin/state", requireSession, requireAdmin, (_req, res) => {
    try { return res.json({ event: eventManager.event ? eventManager.adminSnapshot() : null }); }
    catch (error) { return routeError(res, error); }
  });

  router.get("/event/participant/state", requireSession, (req, res) => {
    try { return res.json({ participant: eventManager.participantStatus(req.principal) }); }
    catch (error) { return routeError(res, error); }
  });

  router.post("/event/admin/create", requireTrustedOrigin, requireSession, requireAdmin, async (req, res) => {
    try {
      await eventManager.createEvent(req.body || {});
      return res.json({ event: eventManager.adminSnapshot() });
    }
    catch (error) { return routeError(res, error); }
  });

  router.post("/event/admin/open", requireTrustedOrigin, requireSession, requireAdmin, (_req, res) => {
    try {
      eventManager.open();
      return res.json({ event: eventManager.adminSnapshot() });
    }
    catch (error) { return routeError(res, error); }
  });

  router.post("/event/admin/stop", requireTrustedOrigin, requireSession, requireAdmin, (_req, res) => {
    try {
      eventManager.close();
      return res.json({ event: eventManager.adminSnapshot() });
    }
    catch (error) { return routeError(res, error); }
  });

  router.post("/event/admin/invalidate", requireTrustedOrigin, requireSession, requireAdmin, (req, res) => {
    try {
      eventManager.invalidate(req.principal, req.body || {});
      return res.json({ event: eventManager.adminSnapshot() });
    }
    catch (error) { return routeError(res, error); }
  });

  router.post("/event/admin/reinstate", requireTrustedOrigin, requireSession, requireAdmin, (req, res) => {
    try {
      eventManager.reinstate(req.principal, req.body || {});
      return res.json({ event: eventManager.adminSnapshot() });
    }
    catch (error) { return routeError(res, error); }
  });

  return router;
};
