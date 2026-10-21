const production = process.env.NODE_ENV === "production";

const intFromEnv = (name, fallback) => {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

// Every timing and limit in one place. Tests pass overrides to run in milliseconds.
const DEFAULTS = Object.freeze({
  validDurations: [15, 30, 60, 120],
  countdownMs: 5000,
  // How long after the test deadline the server still accepts a result before it closes the round
  submitGraceMs: 3000,
  // A result may arrive this much before the test ends (the client timer and the server clock drift apart)
  earlySubmitSlackMs: 1500,
  // A player who drops keeps their seat this long
  reconnectGraceMs: 30_000,
  maxRooms: 500,
  maxPlayersPerRoom: 8,
  roomTtlMs: 6 * 60 * 60 * 1000,
  flushDebounceMs: 100,
  leaseTtlMs: 20_000,
  leaseRenewMs: 6_000,

  // Teams (same rules as Matiks: 1 to 4 players, one team per player, a captain, a full team to start)
  teamMaxSize: 4,
  // Team rooms are kept for days (a team forms over time); open rooms only for hours
  teamRoomTtlMs: 7 * 24 * 60 * 60 * 1000,
  teamRequestsPerMinutePerIp: 40,
  rosterMaxTeams: 500,
  rosterMaxMembersPerTeam: 8,
  rosterMaxBytes: 512 * 1024,

  // Leaderboard
  maxVerifiedWpm: 250,
  minLeaderboardChars: 25,
  leaderboardSize: 100,
  leaderboardCacheMs: 5000,

  // Abuse limits. Per address, and generous: a classroom shares one.
  maxConnectionsPerIp: 100,
  connectionsPerMinutePerIp: 300,
  httpRequestsPerMinutePerIp: 120,
  trustProxyHops: intFromEnv("TRUST_PROXY_HOPS", production ? 1 : 0),
});

function buildSettings(overrides = {}) {
  return Object.freeze({ ...DEFAULTS, ...overrides });
}

module.exports = { DEFAULTS, buildSettings };
