const { timingSafeEqual } = require("node:crypto");

function sameToken(given, expected) {
  const a = Buffer.from(String(given));
  const b = Buffer.from(String(expected));
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Organizer routes. They need ADMIN_TOKEN set on the server and sent as "Authorization: Bearer <token>". Without a token set, or with the
 * wrong one, the route answers 404 as if it did not exist, so nothing reveals that an admin interface is there.
 */
function requireAdmin(req, res, next) {
  const expected = process.env.ADMIN_TOKEN;
  const given = String(req.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
  if (!expected || !sameToken(given, expected)) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  next();
}

module.exports = { requireAdmin, sameToken };
