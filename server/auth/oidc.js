const crypto = require("node:crypto");

const pendingLogins = new Map();
let discoveryPromise;
let jwksCache = { expiresAt: 0, keys: [] };
const COOKIE_NAME = "quiktype_event_session";
const STATE_COOKIE = "quiktype_oidc_state";

function cookieDomainAttribute() {
  const domain = process.env.OIDC_COOKIE_DOMAIN;
  if (!domain) return "";
  if (!/^\.?[A-Za-z0-9.-]+$/.test(domain)) throw new Error("OIDC_COOKIE_DOMAIN must be a domain name");
  return `; Domain=${domain}`;
}

function stateCookieAttributes() {
  const production = process.env.NODE_ENV === "production";
  return `; SameSite=${production ? "None" : "Lax"}${production ? "; Secure" : ""}`;
}

function configured() {
  return Boolean(process.env.OIDC_ISSUER && process.env.OIDC_CLIENT_ID && process.env.OIDC_SESSION_SECRET?.length >= 32);
}

function githubPictureUrl(profile, claims) {
  const pictureClaim = process.env.OIDC_PICTURE_CLAIM || "picture";
  const candidate = profile[pictureClaim] || claims[pictureClaim];
  if (typeof candidate === "string") {
    try {
      const url = new URL(candidate);
      if (url.protocol === "https:" && ["avatars.githubusercontent.com", "github.com"].includes(url.hostname)) return url.toString();
    } catch { /* Fall back to the verified GitHub username. */ }
  }

  const usernameClaim = process.env.OIDC_GITHUB_USERNAME_CLAIM || "preferred_username";
  const username = profile[usernameClaim] || profile.login || profile.github_username || claims[usernameClaim] || claims.login;
  if (typeof username === "string" && /^[A-Za-z0-9-]{1,39}$/.test(username)) {
    return `https://github.com/${username}.png?size=96`;
  }
  return null;
}

function cookieValue(req, name) {
  const raw = req.headers.cookie || "";
  for (const item of raw.split(";")) {
    const [key, ...value] = item.trim().split("=");
    if (key === name) {
      try { return decodeURIComponent(value.join("=")); } catch { return null; }
    }
  }
  return null;
}

function signSession(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", process.env.OIDC_SESSION_SECRET).update(body).digest("base64url");
  return `${body}.${signature}`;
}

function readSession(req) {
  if (!configured()) return null;
  const token = cookieValue(req, COOKIE_NAME);
  if (!token) return null;
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;
  const expected = crypto.createHmac("sha256", process.env.OIDC_SESSION_SECRET).update(body).digest();
  let actual;
  try { actual = Buffer.from(signature, "base64url"); } catch { return null; }
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;
  try {
    const session = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!session.exp || session.exp <= Math.floor(Date.now() / 1000)) return null;
    return session;
  } catch { return null; }
}

function requireSession(req, res, next) {
  const principal = readSession(req);
  if (!principal) return res.status(configured() ? 401 : 503).json({ error: configured() ? "Sign in required" : "OIDC is not configured" });
  req.principal = principal;
  next();
}

function requireAdmin(req, res, next) {
  if (!req.principal?.isEventAdmin) return res.status(403).json({ error: "Event admin access required" });
  next();
}

function requireTrustedOrigin(req, res, next) {
  const origin = req.get("origin");
  const trusted = (process.env.FRONTEND_URL || "http://localhost:3002").split(",").map(value => value.trim().replace(/\/$/, ""));
  if (!origin || !trusted.includes(origin.replace(/\/$/, ""))) return res.status(403).json({ error: "Request origin is not allowed" });
  next();
}

async function getDiscovery() {
  if (!configured()) throw new Error("OIDC is not configured");
  if (process.env.NODE_ENV === "production" && (!process.env.OIDC_REDIRECT_URI || new URL(process.env.OIDC_REDIRECT_URI).protocol !== "https:")) throw new Error("Set OIDC_REDIRECT_URI to the registered HTTPS callback URL");
  if (process.env.NODE_ENV === "production" && new URL(process.env.OIDC_ISSUER).protocol !== "https:") throw new Error("OIDC_ISSUER must use HTTPS in production");
  if (!discoveryPromise) {
    const issuer = process.env.OIDC_ISSUER.replace(/\/$/, "");
    const discoveryUrl = process.env.OIDC_DISCOVERY_URL || `${issuer}/.well-known/openid-configuration`;
    discoveryPromise = fetch(discoveryUrl).then(async response => {
      if (!response.ok) throw new Error(`OIDC discovery failed (${response.status})`);
      const metadata = await response.json();
      if (metadata.issuer !== issuer) throw new Error("OIDC discovery issuer does not match OIDC_ISSUER");
      if (!metadata.authorization_endpoint || !metadata.token_endpoint || !metadata.jwks_uri) throw new Error("OIDC discovery document is missing required endpoints");
      if (process.env.NODE_ENV === "production" && [metadata.authorization_endpoint, metadata.token_endpoint, metadata.jwks_uri, metadata.userinfo_endpoint].filter(Boolean).some(endpoint => new URL(endpoint).protocol !== "https:")) throw new Error("OIDC endpoints must use HTTPS in production");
      return metadata;
    }).catch(error => { discoveryPromise = null; throw error; });
  }
  return discoveryPromise;
}

async function loadJwks(uri) {
  if (jwksCache.expiresAt > Date.now() && jwksCache.uri === uri) return jwksCache.keys;
  const response = await fetch(uri);
  if (!response.ok) throw new Error("Could not load OIDC signing keys");
  const data = await response.json();
  jwksCache = { uri, keys: data.keys || [], expiresAt: Date.now() + 5 * 60_000 };
  return jwksCache.keys;
}

async function validateIdToken(token, nonce, metadata) {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Invalid OIDC ID token");
  const header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
  const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  if (!["RS256", "ES256"].includes(header.alg) || !header.kid) throw new Error("Unsupported OIDC ID token signing algorithm");
  let keys = await loadJwks(metadata.jwks_uri);
  let jwk = keys.find(key => key.kid === header.kid && key.use !== "enc");
  if (!jwk) {
    jwksCache.expiresAt = 0;
    keys = await loadJwks(metadata.jwks_uri);
    jwk = keys.find(key => key.kid === header.kid && key.use !== "enc");
  }
  if (!jwk) throw new Error("OIDC signing key not found");
  if ((header.alg === "RS256" && jwk.kty !== "RSA") || (header.alg === "ES256" && (jwk.kty !== "EC" || jwk.crv !== "P-256"))) throw new Error("OIDC signing key type does not match the token algorithm");
  const publicKey = crypto.createPublicKey({ key: jwk, format: "jwk" });
  const verifyOptions = header.alg === "RS256" ? publicKey : { key: publicKey, dsaEncoding: "ieee-p1363" };
  const verified = crypto.verify(header.alg === "RS256" ? "RSA-SHA256" : "sha256", Buffer.from(`${parts[0]}.${parts[1]}`), verifyOptions, Buffer.from(parts[2], "base64url"));
  if (!verified) throw new Error("OIDC ID token signature is invalid");
  if (header.alg === "RS256" && (publicKey.asymmetricKeyDetails?.modulusLength || 0) < 2048) throw new Error("OIDC RSA signing key is too weak");
  const now = Math.floor(Date.now() / 1000);
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (claims.iss !== metadata.issuer || !audience.includes(process.env.OIDC_CLIENT_ID) || (audience.length > 1 && claims.azp !== process.env.OIDC_CLIENT_ID)) throw new Error("OIDC ID token issuer or audience is invalid");
  if (typeof claims.sub !== "string" || !claims.sub || !Number.isSafeInteger(claims.iat) || claims.iat > now + 30 || !Number.isSafeInteger(claims.exp) || claims.exp <= now || (claims.nbf && (!Number.isSafeInteger(claims.nbf) || claims.nbf > now + 30)) || claims.nonce !== nonce) throw new Error("OIDC ID token claims are invalid");
  return claims;
}

function installOidcRoutes(app) {
  app.get("/auth/login", async (req, res) => {
    try {
      const metadata = await getDiscovery();
      const state = crypto.randomBytes(32).toString("base64url");
      const nonce = crypto.randomBytes(32).toString("base64url");
      const verifier = crypto.randomBytes(48).toString("base64url");
      for (const [pendingState, pending] of pendingLogins) if (pending.expiresAt < Date.now()) pendingLogins.delete(pendingState);
      const redirectUri = process.env.OIDC_REDIRECT_URI || `${req.protocol}://${req.get("host")}/auth/callback`;
      pendingLogins.set(state, { nonce, verifier, redirectUri, expiresAt: Date.now() + 10 * 60_000 });
      const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
      const url = new URL(metadata.authorization_endpoint);
      for (const [key, value] of Object.entries({ response_type: "code", client_id: process.env.OIDC_CLIENT_ID, redirect_uri: redirectUri, scope: process.env.OIDC_SCOPES || "openid profile email club", state, nonce, code_challenge: challenge, code_challenge_method: "S256" })) url.searchParams.set(key, value);
      res.setHeader("Set-Cookie", `${STATE_COOKIE}=${state}; HttpOnly; Path=/auth/callback; Max-Age=600${stateCookieAttributes()}${cookieDomainAttribute()}`);
      res.redirect(url.toString());
    } catch (error) { res.status(503).type("text/plain").send(error.message); }
  });

  app.get("/auth/callback", async (req, res) => {
    try {
      const state = String(req.query.state || "");
      const pending = pendingLogins.get(state);
      pendingLogins.delete(state);
      if (!pending || pending.expiresAt < Date.now() || cookieValue(req, STATE_COOKIE) !== state || !req.query.code) {
        res.setHeader("Set-Cookie", `${STATE_COOKIE}=; HttpOnly; Path=/auth/callback; Max-Age=0${stateCookieAttributes()}${cookieDomainAttribute()}`);
        return res.status(400).send("Invalid or expired sign-in request");
      }
      const metadata = await getDiscovery();
      const params = new URLSearchParams({ grant_type: "authorization_code", code: String(req.query.code), redirect_uri: pending.redirectUri, client_id: process.env.OIDC_CLIENT_ID, code_verifier: pending.verifier });
      const headers = { "content-type": "application/x-www-form-urlencoded" };
      if (process.env.OIDC_CLIENT_SECRET) {
        if ((process.env.OIDC_CLIENT_AUTH_METHOD || "client_secret_basic") === "client_secret_post") {
          params.set("client_secret", process.env.OIDC_CLIENT_SECRET);
        } else {
          headers.authorization = `Basic ${Buffer.from(`${process.env.OIDC_CLIENT_ID}:${process.env.OIDC_CLIENT_SECRET}`).toString("base64")}`;
          params.delete("client_id");
        }
      }
      const response = await fetch(metadata.token_endpoint, { method: "POST", headers, body: params });
      const tokens = await response.json();
      if (!response.ok || !tokens.id_token) throw new Error(tokens.error_description || "OIDC token exchange failed");
      const claims = await validateIdToken(tokens.id_token, pending.nonce, metadata);
      let profile = claims;
      if (metadata.userinfo_endpoint && tokens.access_token) {
        const profileResponse = await fetch(metadata.userinfo_endpoint, { headers: { authorization: `Bearer ${tokens.access_token}` } });
        if (!profileResponse.ok) throw new Error("OIDC user profile request failed");
        profile = await profileResponse.json();
        if (profile.sub !== claims.sub) throw new Error("OIDC user profile does not match the signed-in account");
      }
      const displayClaim = process.env.OIDC_DISPLAY_NAME_CLAIM || "name";
      const admins = (process.env.OIDC_ADMIN_SUBJECTS || "").split(",").map(value => value.trim()).filter(Boolean);
      const sessionSeconds = Number(process.env.OIDC_SESSION_SECONDS || 8 * 60 * 60);
      const principal = { sub: claims.sub, displayName: profile[displayClaim] || profile.name || profile.email || claims[displayClaim] || claims.name || claims.email || "Participant", pictureUrl: githubPictureUrl(profile, claims), isEventAdmin: admins.includes(claims.sub), exp: Math.floor(Date.now() / 1000) + sessionSeconds };
      const production = process.env.NODE_ENV === "production";
      const cookiePolicy = production ? "; SameSite=None; Secure" : "; SameSite=Lax";
      const domain = cookieDomainAttribute();
      const stateCookieClear = `${STATE_COOKIE}=; HttpOnly; Path=/auth/callback; Max-Age=0${stateCookieAttributes()}${domain}`;
      res.setHeader("Set-Cookie", [`${COOKIE_NAME}=${encodeURIComponent(signSession(principal))}; HttpOnly; Path=/; Max-Age=${sessionSeconds}${cookiePolicy}${domain}`, stateCookieClear]);
      const frontend = (process.env.FRONTEND_URL || "http://localhost:3002").split(",")[0].trim().replace(/\/$/, "");
      res.redirect(process.env.OIDC_POST_LOGIN_URL || `${frontend}/event`);
    } catch (error) {
      res.setHeader("Set-Cookie", `${STATE_COOKIE}=; HttpOnly; Path=/auth/callback; Max-Age=0${stateCookieAttributes()}${cookieDomainAttribute()}`);
      res.status(401).type("text/plain").send(`Sign-in failed: ${error.message}`);
    }
  });

  app.get("/auth/me", requireSession, (req, res) => res.json({ id: req.principal.sub, displayName: req.principal.displayName, pictureUrl: req.principal.pictureUrl || null, isEventAdmin: req.principal.isEventAdmin }));
  app.post("/auth/logout", requireTrustedOrigin, (req, res) => {
    const production = process.env.NODE_ENV === "production";
    const cookiePolicy = production ? "; SameSite=None; Secure" : "; SameSite=Lax";
    res.setHeader("Set-Cookie", `${COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0${cookiePolicy}${cookieDomainAttribute()}`);
    res.json({ ok: true });
  });
}

function principalFromSocket(socket) {
  return readSession({ headers: { cookie: socket.handshake.headers.cookie || "" } });
}

module.exports = { configured, installOidcRoutes, requireSession, requireAdmin, requireTrustedOrigin, principalFromSocket };
