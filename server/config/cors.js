// Which browser origins may talk to this server.
//
// Nothing here is a login: the game uses no cookies, so CORS only decides which web pages a browser lets read the responses. Non-browser
// clients send no Origin and are always let through; abuse by those is limited separately (lib/rateLimit.js).

const DEFAULT_FRONTEND = "https://quik-type.vercel.app";
// Preview deployments of this project on Vercel
const DEFAULT_PATTERNS = ["quik-type*.vercel.app"];

const splitList = (value) =>
  String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

const globToRegExp = (glob) =>
  new RegExp("^" + glob.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[a-z0-9-]*") + "$", "i");

function buildOriginPolicy(env = process.env) {
  const production = env.NODE_ENV === "production";
  const exact = new Set((splitList(env.FRONTEND_URL).length ? splitList(env.FRONTEND_URL) : [DEFAULT_FRONTEND]).map((url) => url.replace(/\/$/, "")));
  const patterns = (splitList(env.ALLOWED_ORIGIN_PATTERNS).length ? splitList(env.ALLOWED_ORIGIN_PATTERNS) : DEFAULT_PATTERNS).map(globToRegExp);
  const allowLocalhost = !production || env.ALLOW_LOCALHOST_ORIGINS === "true";

  function isAllowed(origin) {
    if (!origin) return true;
    let url;
    try {
      url = new URL(origin);
    } catch {
      return false;
    }
    if (exact.has(url.origin)) return true;
    if (allowLocalhost && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return true;
    return url.protocol === "https:" && patterns.some((pattern) => pattern.test(url.hostname));
  }

  const corsOptions = {
    origin: (origin, callback) => callback(null, isAllowed(origin)),
    methods: ["GET", "POST"],
    credentials: false,
  };

  return { isAllowed, corsOptions, allowedOrigins: [...exact] };
}

module.exports = { buildOriginPolicy };
