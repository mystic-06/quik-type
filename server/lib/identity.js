const { createHash, randomBytes } = require("node:crypto");

const sha = (text) => createHash("sha256").update(text).digest("hex");

const validSecret = (secret) => typeof secret === "string" && secret.length >= 16 && secret.length <= 128;

/**
 * A player's identity comes from a secret their browser keeps. The server stores only hashes of it: `key` (private, how the server knows the
 * player) and `pubId` (shown to other players). Knowing someone's public id does not let you act as them.
 * Without a usable secret the identity is random and lasts only for that connection.
 */
function identityFrom(secret) {
  const usable = validSecret(secret) ? secret : randomBytes(24).toString("hex");
  return { key: sha(`key:${usable}`), pubId: `p${sha(`pub:${usable}`).slice(0, 12)}` };
}

module.exports = { identityFrom, validSecret };
