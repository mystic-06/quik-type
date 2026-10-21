const ROOM_ID = /^[A-Z0-9_-]{3,16}$/;

// Control characters, zero-width and bidirectional-override characters: they make names invisible or reorder the page
const INVISIBLE_RANGES = [
  [0x0000, 0x001f],
  [0x007f, 0x009f],
  [0x200b, 0x200f],
  [0x2028, 0x202e],
  [0x2060, 0x206f],
  [0xfeff, 0xfeff],
];
const INVISIBLE = new RegExp(
  "[" + INVISIBLE_RANGES.map(([from, to]) => `${String.fromCharCode(from)}-${String.fromCharCode(to)}`).join("") + "]",
  "g"
);

function normalizeRoomId(raw) {
  if (typeof raw !== "string") return null;
  const id = raw.trim().toUpperCase();
  return ROOM_ID.test(id) ? id : null;
}

function cleanUsername(raw) {
  if (typeof raw !== "string") return null;
  const name = raw.replace(INVISIBLE, "").replace(/\s+/g, " ").trim();
  if (name.length === 0 || name.length > 20) return null;
  return name;
}

module.exports = { normalizeRoomId, cleanUsername };

const TEAM_CODE = /^[A-Z0-9-]{3,10}$/;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

/** A team's display name: same cleaning as a username, up to 30 characters. */
function cleanTeamName(raw) {
  if (typeof raw !== "string") return null;
  const name = raw.replace(INVISIBLE, "").replace(/\s+/g, " ").trim();
  if (name.length === 0 || name.length > 30) return null;
  return name;
}

function normalizeTeamCode(raw) {
  if (typeof raw !== "string") return null;
  const code = raw.trim().toUpperCase();
  return TEAM_CODE.test(code) ? code : null;
}

function normalizeEmail(raw) {
  if (typeof raw !== "string") return null;
  const email = raw.trim().toLowerCase();
  return email.length <= 254 && EMAIL.test(email) ? email : null;
}

module.exports.cleanTeamName = cleanTeamName;
module.exports.normalizeTeamCode = normalizeTeamCode;
module.exports.normalizeEmail = normalizeEmail;
