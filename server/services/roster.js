// The team list for an event: which teams exist, who is in them, and which browser has claimed which email.
//
// While a roster is loaded, teams cannot be made up freely: a player checks in with the email they were registered with and is placed in
// their team (the same rule as the Matiks event roster). The first browser to check in with an email owns that seat; a different browser
// presenting the same email is refused until an organizer resets it, so knowing a teammate's email is not enough to take their place.
// Emails are personal data: they live only here, in Redis, and on the organizer's endpoints. They are never sent to players.

const { GameError } = require("../lib/errors");
const { parseRosterCsv } = require("../lib/rosterCsv");
const { guard, key } = require("../lib/redis");

const NOT_REGISTERED = "That email is not registered in any team for this event. Check it with your team leader or the organizers.";

class Roster {
  constructor({ settings, clock = Date.now }) {
    this.settings = settings;
    this.clock = clock;
    /** teamCode -> { teamName, teamCode, targetSize, members: [{ email, name, isLeader, claimedBy, checkedInAt }] } */
    this.teams = new Map();
    this.emailIndex = new Map();
    this.saveTimer = null;
    this.loadedAt = 0;
  }

  isActive() {
    return this.teams.size > 0;
  }

  /* ---------------------------------------------------------------------------------------------- loading a list */

  /** Replaces the roster with the teams in a CSV. Throws GameError if it holds none or is too large. */
  load(csv) {
    if (typeof csv !== "string" || csv.length === 0) throw new GameError("The CSV is empty.");
    if (Buffer.byteLength(csv) > this.settings.rosterMaxBytes) throw new GameError("The CSV is too large.");

    const parsed = parseRosterCsv(csv);
    if (parsed.length === 0) throw new GameError("The CSV contained no valid teams or member emails.");
    if (parsed.length > this.settings.rosterMaxTeams) throw new GameError(`A roster can hold at most ${this.settings.rosterMaxTeams} teams.`);

    const teams = new Map();
    const emails = new Map();
    const seenCodes = new Set();
    let counter = 1;
    for (const team of parsed) {
      if (team.members.length > this.settings.rosterMaxMembersPerTeam) {
        throw new GameError(`Team "${team.teamName}" has more than ${this.settings.rosterMaxMembersPerTeam} members.`);
      }
      let code = team.teamCode;
      while (seenCodes.has(code)) code = `${team.teamCode.slice(0, 7)}${counter++}`.slice(0, 10);
      seenCodes.add(code);

      const members = [];
      for (const m of team.members) {
        if (emails.has(m.email)) continue; // one email, one team: the first listing wins
        members.push({ ...m, claimedBy: null, checkedInAt: 0 });
        emails.set(m.email, code);
      }
      if (members.length === 0) continue;
      teams.set(code, { teamName: team.teamName, teamCode: code, targetSize: members.length, members });
    }
    if (teams.size === 0) throw new GameError("The CSV contained no valid teams or member emails.");

    this.teams = teams;
    this.emailIndex = emails;
    this.loadedAt = this.clock();
    this.scheduleSave();
    return { teams: teams.size, members: emails.size };
  }

  clear() {
    this.teams = new Map();
    this.emailIndex = new Map();
    this.scheduleSave();
  }

  /* ---------------------------------------------------------------------------------------------- lookups and claims */

  find(email) {
    const code = this.emailIndex.get(email);
    const team = code ? this.teams.get(code) : undefined;
    const member = team?.members.find((m) => m.email === email);
    return team && member ? { team, member } : null;
  }

  /**
   * The browser `playerKey` takes the seat for this email. Throws GameError if the email is unknown or another browser already holds it.
   * Returns whether this is the first time the seat was taken.
   */
  claim(email, playerKey) {
    const found = this.find(email);
    if (!found) throw new GameError(NOT_REGISTERED);
    const { team, member } = found;
    if (member.claimedBy && member.claimedBy !== playerKey) {
      throw new GameError("That email was already checked in from another browser. Ask an organizer to reset it if it was you.");
    }
    const firstTime = member.claimedBy === null;
    if (firstTime) {
      member.claimedBy = playerKey;
      member.checkedInAt = this.clock();
      this.scheduleSave();
    }
    return { team, member, firstTime };
  }

  /** Undoes a first-time claim (the check-in failed after the seat was taken). */
  unclaim(email, playerKey) {
    const member = this.find(email)?.member;
    if (member && member.claimedBy === playerKey) {
      member.claimedBy = null;
      member.checkedInAt = 0;
      this.scheduleSave();
    }
  }

  /** An organizer frees a seat so its owner can check in from another browser. */
  resetMember(email) {
    const member = this.find(email)?.member;
    if (!member) return false;
    member.claimedBy = null;
    member.checkedInAt = 0;
    this.scheduleSave();
    return true;
  }

  /** Which seat a browser holds, if any. */
  seatOf(playerKey) {
    for (const team of this.teams.values()) {
      const member = team.members.find((m) => m.claimedBy === playerKey);
      if (member) return { team, member };
    }
    return null;
  }

  /* ---------------------------------------------------------------------------------------------- views */

  /** What anyone may see: team names, codes and how far along they are. No emails, no names of people. */
  publicList(statusOf) {
    return [...this.teams.values()].map((team) => ({
      name: team.teamName,
      code: team.teamCode,
      targetSize: team.targetSize,
      checkedIn: team.members.filter((m) => m.claimedBy).length,
      ...statusOf(team.teamCode),
    }));
  }

  /** For organizers: everything, including emails. */
  adminList() {
    return [...this.teams.values()].map((team) => ({
      name: team.teamName,
      code: team.teamCode,
      targetSize: team.targetSize,
      members: team.members.map((m) => ({ email: m.email, name: m.name, isLeader: m.isLeader, checkedIn: Boolean(m.claimedBy), checkedInAt: m.checkedInAt })),
    }));
  }

  /* ---------------------------------------------------------------------------------------------- saving */

  serialize() {
    return { v: 1, loadedAt: this.loadedAt, teams: [...this.teams.values()] };
  }

  restore(data) {
    if (!data || data.v !== 1 || !Array.isArray(data.teams)) return 0;
    this.teams = new Map();
    this.emailIndex = new Map();
    for (const team of data.teams) {
      if (!team?.teamCode || !Array.isArray(team.members)) continue;
      this.teams.set(team.teamCode, team);
      for (const m of team.members) this.emailIndex.set(m.email, team.teamCode);
    }
    this.loadedAt = data.loadedAt ?? 0;
    return this.teams.size;
  }

  scheduleSave() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.save();
    }, this.settings.flushDebounceMs);
    this.saveTimer.unref?.();
  }

  /** Writes the roster to Redis. Never throws; a failed save is retried on the next change. */
  async save() {
    try {
      await guard.run("roster.save", (r) => r.set(key("roster"), JSON.stringify(this.serialize())));
      return true;
    } catch {
      this.scheduleSave();
      return false;
    }
  }

  /** Reads the roster back from Redis. Throws RedisUnavailableError if Redis cannot be reached. */
  async loadFromRedis() {
    const raw = await guard.run("roster.load", (r) => r.get(key("roster")));
    if (!raw) return 0;
    try {
      return this.restore(JSON.parse(raw));
    } catch {
      console.warn("[Roster] The saved roster in Redis was unreadable and was ignored.");
      return 0;
    }
  }

  /** Saves now (for shutdown). */
  async flush() {
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    return this.save();
  }
}

module.exports = { Roster };
