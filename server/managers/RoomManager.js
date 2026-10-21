const { randomBytes } = require("node:crypto");
const { generate } = require("random-words");
const { GameError } = require("../lib/errors");
const { scoreTyping } = require("../lib/scoring");

const NO_RESULT = Object.freeze({ wpm: 0, rawWpm: 0, accuracy: 0, charactersTyped: 0, completionPercentage: 0 });
const MAX_TIMER_MS = 2 ** 31 - 1;
const CODE_LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";

const round1 = (n) => Math.round(n * 10) / 10;

/**
 * Rooms, players and the round state machine:  setup -> countdown -> test -> results -> (host restarts) -> setup.
 *
 * Two kinds of room share it:
 *   open   anyone with the code may join, any number up to the room limit, a short grace period if a connection drops, and a round
 *          starts when everyone connected is ready. Results are individual.
 *   team   (the Matiks squad rules) 1 to 4 players with a captain, one team per player, the team must be full (or locked at its current
 *          size by the captain) before a round can start, members stay seated when they disconnect, and the team's result is the average
 *          of its members. Teams are formed over HTTP (create, join with the code, or check in from a roster), then played in the room.
 *
 * Players are identified by a key derived from a secret the browser keeps, not by socket id, so a dropped connection keeps its seat and a
 * refresh or a reconnect picks up where the player was. Every phase change is driven by an absolute deadline stored on the room
 * (`countdownEndsAt`, `testEndsAt`), so after a restart the timers are re-armed from the saved room.
 *
 * This class owns state and rules. How events reach sockets, and how rooms are saved, are passed in:
 *   emit(roomId, event, ...args)      to everyone in a room
 *   evict(roomId, socketId, message)  take one socket out of a room (kicked, or the team was dissolved)
 *   onChange(room) / onRemove(id)     the room changed / is gone (for saving)
 *   onFinished({ room, duration, results, team })   a round ended (for the leaderboards)
 */
class RoomManager {
  constructor({
    settings,
    emit,
    evict = () => {},
    onChange = () => {},
    onRemove = () => {},
    onFinished = () => {},
    clock = Date.now,
    words = () => generate(200),
  }) {
    this.settings = settings;
    this.emit = emit;
    this.evict = evict;
    this.onChange = onChange;
    this.onRemove = onRemove;
    this.onFinished = onFinished;
    this.clock = clock;
    this.words = words;
    this.rooms = new Map();
    /** player key -> code of the team they are in. A player is in at most one team. */
    this.keyTeams = new Map();
  }

  /* ------------------------------------------------------------------------------------------------ lookups */

  getRoom(roomId) {
    return this.rooms.get(roomId);
  }

  teamOf(key) {
    return this.keyTeams.get(key) ?? null;
  }

  stats() {
    let players = 0;
    let connected = 0;
    let teams = 0;
    for (const room of this.rooms.values()) {
      if (room.kind === "team") teams += 1;
      players += room.players.size;
      for (const p of room.players.values()) if (p.socketId) connected += 1;
    }
    return { rooms: this.rooms.size, teams, players, connected };
  }

  /** What a client is allowed to see of a room: no keys, no socket ids, no timers. */
  publicRoom(room) {
    return {
      id: room.id,
      kind: room.kind,
      hostId: room.players.get(room.hostKey)?.pubId ?? null,
      phase: room.phase,
      config: { timerDuration: room.config.timerDuration },
      team: room.kind === "team" ? this.publicTeam(room) : null,
      participants: [...room.players.values()].map((p) => this.publicPlayer(room, p)),
      countdownEndsAt: room.phase === "countdown" ? room.countdownEndsAt : null,
      testEndsAt: room.phase === "test" ? room.testEndsAt : null,
      serverNow: this.clock(),
    };
  }

  publicTeam(room) {
    return {
      name: room.team.name,
      code: room.id,
      targetSize: room.team.targetSize,
      full: room.players.size >= room.team.targetSize,
      fromRoster: room.team.roster,
      disqualified: room.team.disqualified,
      captainId: room.players.get(room.hostKey)?.pubId ?? null,
    };
  }

  publicPlayer(room, player) {
    return {
      id: player.pubId,
      username: player.username,
      isReady: player.isReady,
      isHost: player.key === room.hostKey,
      connected: player.socketId !== null,
      excused: player.excused,
    };
  }

  /** How far a team has got, for the public team list. */
  teamStatus(code) {
    const room = this.rooms.get(code);
    if (!room || room.kind !== "team") return { status: "NOT_STARTED", joined: 0, full: false };
    const full = room.players.size >= room.team.targetSize;
    const status =
      room.phase === "setup" ? (full ? "AWAITING_READY" : "LOBBY") : room.phase === "countdown" ? "COUNTDOWN" : room.phase === "test" ? "IN_TEST" : "FINISHED";
    return { status, joined: room.players.size, full };
  }

  /** Every team room with its members, for organizers. */
  listTeams() {
    return [...this.rooms.values()]
      .filter((room) => room.kind === "team")
      .map((room) => ({
        code: room.id,
        name: room.team.name,
        targetSize: room.team.targetSize,
        phase: room.phase,
        fromRoster: room.team.roster,
        disqualified: room.team.disqualified,
        members: [...room.players.values()].map((p) => ({ ...this.publicPlayer(room, p) })),
      }));
  }

  /* ------------------------------------------------------------------------------------------------ joining and leaving */

  /**
   * Seats a player in an open room, or takes a team member's seat back in a team room (a refresh, a reconnect, a second tab).
   * Anyone else must fit and arrive before a round starts; a team's seats are filled through joinTeam instead.
   */
  join({ roomId, key, pubId, username, socketId }) {
    let room = this.rooms.get(roomId);
    const existing = room?.players.get(key);

    if (!existing) {
      if (room?.kind === "team") throw new GameError("This is a team room. Join it from the Teams page with the team code.");
      if (room && room.players.size >= this.settings.maxPlayersPerRoom) throw new GameError("Room is full");
      if (room && (room.phase === "countdown" || room.phase === "test")) throw new GameError("Cannot join room during active test");
    }
    if (!room) room = this.createRoom(roomId, "open");

    let player = existing;
    let displacedSocketId = null;
    if (player) {
      if (player.socketId && player.socketId !== socketId) displacedSocketId = player.socketId;
      player.socketId = socketId;
      player.disconnectedAt = null;
      clearTimeout(player.graceTimer);
      player.graceTimer = null;
    } else {
      player = this.newPlayer({ key, pubId, username: this.uniqueName(room, username), socketId });
      room.players.set(key, player);
      if (!room.players.has(room.hostKey)) room.hostKey = key;
    }

    this.touch(room);
    return { room, player, displacedSocketId, rejoined: Boolean(existing) };
  }

  newPlayer({ key, pubId, username, socketId }) {
    return { key, pubId, username, isReady: false, excused: false, socketId, disconnectedAt: null, graceTimer: null, finalResults: null };
  }

  uniqueName(room, wanted) {
    const taken = new Set([...room.players.values()].map((p) => p.username.toLowerCase()));
    if (!taken.has(wanted.toLowerCase())) return wanted;
    for (let n = 2; n < 100; n++) {
      const suffix = ` (${n})`;
      const candidate = wanted.slice(0, 20 - suffix.length) + suffix;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
    return wanted;
  }

  /** The connection dropped. An open room's player keeps their seat for the grace period; a team member keeps it until they leave. */
  socketDisconnected(roomId, key, socketId) {
    const room = this.rooms.get(roomId);
    const player = room?.players.get(key);
    if (!room || !player || player.socketId !== socketId) return;
    this.markDisconnected(room, player);
    this.emit(roomId, "participant-status", player.pubId, false);
    this.touch(room);
  }

  markDisconnected(room, player) {
    player.socketId = null;
    player.disconnectedAt = this.clock();
    clearTimeout(player.graceTimer);
    player.graceTimer = null;
    if (room.kind === "team") return;
    player.graceTimer = setTimeout(() => this.removePlayer(room.id, player.key), this.settings.reconnectGraceMs);
    player.graceTimer.unref?.();
  }

  /** The player left on purpose, or an open room's grace period ran out. */
  removePlayer(roomId, key) {
    const room = this.rooms.get(roomId);
    const player = room?.players.get(key);
    if (!room || !player) return;

    clearTimeout(player.graceTimer);
    room.players.delete(key);
    if (this.keyTeams.get(key) === roomId) this.keyTeams.delete(key);

    if (room.players.size === 0) {
      this.deleteRoom(roomId);
      return;
    }

    this.emit(roomId, "participant-left", player.pubId);
    if (room.hostKey === key) this.passHost(room);
    if (room.kind === "team") this.emit(roomId, "team-updated", this.publicTeam(room));
    if (room.phase === "test") this.finishIfAllIn(room);
    this.touch(room);
  }

  passHost(room) {
    const all = [...room.players.values()];
    const next = all.find((p) => p.socketId && !p.excused) ?? all.find((p) => !p.excused) ?? all[0];
    room.hostKey = next.key;
    this.emit(room.id, "host-changed", next.pubId);
  }

  /* ------------------------------------------------------------------------------------------------ teams */

  generateTeamCode() {
    for (let attempt = 0; attempt < 200; attempt++) {
      const letter = () => CODE_LETTERS[Math.floor(Math.random() * CODE_LETTERS.length)];
      const code = `${letter()}${letter()}-${Math.floor(10 + Math.random() * 90)}`;
      if (!this.rooms.has(code)) return code;
    }
    for (let attempt = 0; attempt < 50; attempt++) {
      const code = `TM-${randomBytes(2).toString("hex").toUpperCase()}`;
      if (!this.rooms.has(code)) return code;
    }
    throw new GameError("Could not allocate a team code. Try again.");
  }

  /** Starts a team with its creator as captain. `roster` teams come from the team list and may be larger. */
  createTeam({ code, name, size, key, pubId, username, socketId = null, roster = false }) {
    this.requireFree(key);
    const max = roster ? this.settings.maxPlayersPerRoom : this.settings.teamMaxSize;
    if (!Number.isInteger(size) || size < 1 || size > max) throw new GameError(`A team has 1 to ${max} players.`);
    const id = code ?? this.generateTeamCode();
    if (this.rooms.has(id)) throw new GameError(`Team code ${id} is already in use.`);

    const room = this.createRoom(id, "team");
    room.team = { name, targetSize: size, roster, disqualified: false };
    const player = this.newPlayer({ key, pubId, username, socketId });
    room.players.set(key, player);
    room.hostKey = key;
    this.keyTeams.set(key, id);
    this.touch(room);
    return { room, player };
  }

  /** Takes a seat in a team. A member already in the team just gets it back. `makeCaptain` is for a roster team's registered leader. */
  joinTeam({ code, key, pubId, username, socketId = null, makeCaptain = false }) {
    const room = this.rooms.get(code);
    if (!room || room.kind !== "team") throw new GameError(`Team ${code} does not exist.`);

    const existing = room.players.get(key);
    if (existing) {
      if (socketId) existing.socketId = socketId;
      if (makeCaptain && room.hostKey !== key) this.makeCaptain(room, key);
      return { room, player: existing, rejoined: true };
    }

    this.requireFree(key);
    if (room.players.size >= room.team.targetSize) throw new GameError(`Team ${code} is full.`);
    if (room.phase !== "setup") throw new GameError("The team is in the middle of a round. Join once it is over.");

    const player = this.newPlayer({ key, pubId, username: this.uniqueName(room, username), socketId });
    room.players.set(key, player);
    this.keyTeams.set(key, code);
    if (makeCaptain) this.makeCaptain(room, key);

    this.emit(code, "participant-joined", this.publicPlayer(room, player));
    this.emit(code, "team-updated", this.publicTeam(room));
    this.touch(room);
    return { room, player, rejoined: false };
  }

  requireFree(key) {
    const current = this.keyTeams.get(key);
    if (current) throw new GameError(`You are already in team ${current}. Leave it first.`);
  }

  makeCaptain(room, key) {
    room.hostKey = key;
    this.emit(room.id, "host-changed", room.players.get(key).pubId);
  }

  /** The captain fixes the team at the players it has now, so a team missing someone can still play. */
  lockRoster(roomId, key) {
    const room = this.requireMember(roomId, key);
    if (room.kind !== "team") throw new GameError("Only a team has a roster to lock.");
    if (room.hostKey !== key) throw new GameError("Only the team captain can lock the roster.");
    if (room.phase !== "setup") throw new GameError("The roster can only be locked before a round.");
    const size = room.players.size;
    if (size >= room.team.targetSize) throw new GameError(`The team already has ${size} players.`);

    room.team.targetSize = size;
    this.emit(roomId, "team-updated", this.publicTeam(room));
    this.maybeStart(room);
    this.touch(room);
  }

  /* ------------------------------------------------------------------------------------------------ organizer controls */

  playerByPubId(room, pubId) {
    const player = [...room.players.values()].find((p) => p.pubId === pubId);
    if (!player) throw new GameError("That player is not in this team.");
    return player;
  }

  requireTeam(code) {
    const room = this.rooms.get(code);
    if (!room || room.kind !== "team") throw new GameError(`Team ${code} does not exist.`);
    return room;
  }

  /** A member who cannot play this round (a dead laptop) stops counting toward the team's average and the ready gate. */
  setExcused(code, pubId, excused) {
    const room = this.requireTeam(code);
    const player = this.playerByPubId(room, pubId);
    if (excused) {
      const active = [...room.players.values()].filter((p) => !p.excused);
      if (active.length <= 1 && active[0] === player) throw new GameError("Cannot excuse the last active member of a team.");
    }
    player.excused = excused;
    if (excused) {
      player.isReady = false;
      if (room.phase === "test" && !player.finalResults) player.finalResults = { ...NO_RESULT, submittedAt: this.clock(), verified: false };
      if (room.hostKey === player.key) this.passHost(room);
    }
    this.emit(code, "participant-excused", player.pubId, excused);
    if (room.phase === "setup") this.maybeStart(room);
    if (room.phase === "test") this.finishIfAllIn(room);
    this.touch(room);
  }

  /** Removes a member before a round. */
  kick(code, pubId) {
    const room = this.requireTeam(code);
    if (room.phase !== "setup") throw new GameError("A member can only be removed before a round. Excuse them instead.");
    const player = this.playerByPubId(room, pubId);
    if (player.socketId) this.evict(code, player.socketId, "An organizer removed you from the team.");
    this.removePlayer(code, player.key);
  }

  /** Ends a team: everyone is told and the code is free again. */
  dissolve(code) {
    const room = this.requireTeam(code);
    this.emit(code, "team-dissolved", "An organizer dissolved this team.");
    for (const p of room.players.values()) if (p.socketId) this.evict(code, p.socketId, null);
    this.deleteRoom(code);
  }

  setDisqualified(code, disqualified) {
    const room = this.requireTeam(code);
    room.team.disqualified = disqualified;
    this.emit(code, "team-updated", this.publicTeam(room));
    this.touch(room);
    return room;
  }

  /* ------------------------------------------------------------------------------------------------ setup phase */

  configure(roomId, key, config) {
    const room = this.requireMember(roomId, key);
    if (room.hostKey !== key) throw new GameError(room.kind === "team" ? "Only the team captain can configure the test" : "Only host can configure test");
    if (room.phase !== "setup") throw new GameError("The test can only be configured before it starts");
    if (!config || typeof config !== "object" || !this.settings.validDurations.includes(config.timerDuration)) {
      throw new GameError("Invalid timer duration");
    }
    room.config.timerDuration = config.timerDuration;
    this.emit(roomId, "config-updated", { timerDuration: room.config.timerDuration });
    this.touch(room);
  }

  toggleReady(roomId, key) {
    const room = this.requireMember(roomId, key);
    if (room.phase !== "setup") throw new GameError("Ready can only be changed before the test starts");
    const player = room.players.get(key);
    if (player.excused) throw new GameError("An organizer excused you from this round.");
    player.isReady = !player.isReady;
    this.emit(roomId, "ready-state-changed", player.pubId, player.isReady);
    this.maybeStart(room);
    this.touch(room);
  }

  /**
   * The ready gate. An open room starts when everyone connected is ready. A team starts only when it is full and every member who is not
   * excused is both connected and ready, so the team average is never computed over someone who is not there.
   */
  maybeStart(room) {
    if (room.phase !== "setup") return;
    if (room.kind === "team") {
      if (room.players.size < room.team.targetSize) return;
      const active = [...room.players.values()].filter((p) => !p.excused);
      if (active.length >= 1 && active.every((p) => p.socketId && p.isReady)) this.startCountdown(room);
      return;
    }
    const present = [...room.players.values()].filter((p) => p.socketId);
    if (present.length >= 1 && present.every((p) => p.isReady)) this.startCountdown(room);
  }

  restart(roomId, key) {
    const room = this.requireMember(roomId, key);
    if (room.hostKey !== key) throw new GameError(room.kind === "team" ? "Only the team captain can start a new round" : "Only host can restart room");
    if (room.phase !== "results" && room.phase !== "setup") throw new GameError("The test is still running");

    this.clearTimer(room);
    for (const p of room.players.values()) {
      p.isReady = false;
      p.finalResults = null;
    }
    room.phase = "setup";
    room.testText = "";
    room.rankings = null;
    this.emit(roomId, "room-restarted", this.publicRoom(room));
    this.touch(room);
  }

  /* ------------------------------------------------------------------------------------------------ the round */

  startCountdown(room) {
    room.phase = "countdown";
    room.countdownEndsAt = this.clock() + this.settings.countdownMs;
    this.emit(room.id, "countdown-start", Math.ceil(this.settings.countdownMs / 1000));
    this.arm(room);
  }

  startTest(room) {
    const generated = this.words();
    room.testText = Array.isArray(generated) ? generated.join(" ") : String(generated);
    const now = this.clock();
    room.phase = "test";
    room.testStartedAt = now;
    room.testEndsAt = now + room.config.timerDuration * 1000;
    for (const p of room.players.values()) p.finalResults = null;

    this.emit(room.id, "test-start", room.testText, room.config.timerDuration, { endsAt: room.testEndsAt, serverNow: now });
    this.arm(room);
    this.touch(room);
  }

  /**
   * A player's answer: what they typed. The server scores it against the real text and its own clock, so a client cannot choose its
   * score, finish before the time is up, or play a different text.
   */
  submit(roomId, key, typed) {
    const room = this.requireMember(roomId, key);
    if (room.phase !== "test") throw new GameError("Cannot submit results when test is not active");
    if (typeof typed !== "string") throw new GameError("Invalid results payload");
    if (typed.length > room.testText.length) throw new GameError("Invalid results payload");
    const player = room.players.get(key);
    if (player.excused) throw new GameError("An organizer excused you from this round.");
    if (player.finalResults) throw new GameError("Results already submitted");

    const now = this.clock();
    const finishedText = typed.length === room.testText.length;
    if (!finishedText && now < room.testEndsAt - this.settings.earlySubmitSlackMs) {
      throw new GameError("The test is still running");
    }
    if (now > room.testEndsAt + this.settings.submitGraceMs) throw new GameError("The test has ended");

    const durationMs = room.config.timerDuration * 1000;
    const elapsedMs = finishedText ? Math.min(Math.max(now - room.testStartedAt, 1000), durationMs) : durationMs;
    player.finalResults = { ...scoreTyping({ typed, text: room.testText, elapsedMs }), submittedAt: now, verified: true };

    this.finishIfAllIn(room);
    this.touch(room);
  }

  finishIfAllIn(room) {
    const present = [...room.players.values()].filter((p) => p.socketId && !p.excused);
    if (present.length > 0 && present.every((p) => p.finalResults)) this.finalize(room);
  }

  finalize(room) {
    if (room.phase !== "test") return;
    this.clearTimer(room);

    const players = [...room.players.values()];
    for (const p of players) {
      if (!p.finalResults) p.finalResults = { ...NO_RESULT, submittedAt: this.clock(), verified: false };
    }
    // Someone excused did not take part: they are not ranked and do not count toward a team average
    const playing = players.filter((p) => !p.excused);

    const rankings = playing
      .map((p, order) => ({ p, order }))
      .sort((a, b) => b.p.finalResults.wpm - a.p.finalResults.wpm || b.p.finalResults.accuracy - a.p.finalResults.accuracy || a.order - b.order)
      .map(({ p }, index) => ({
        id: p.pubId,
        username: p.username,
        wpm: p.finalResults.wpm,
        rawWpm: p.finalResults.rawWpm,
        accuracy: p.finalResults.accuracy,
        charactersTyped: p.finalResults.charactersTyped,
        completionPercentage: p.finalResults.completionPercentage,
        rank: index + 1,
      }));

    room.phase = "results";
    room.rankings = rankings;

    const team = room.kind === "team" ? this.teamResult(room, playing) : null;

    // Room state first, then the rankings, as clients expect
    this.emit(room.id, "room-state-updated", this.publicRoom(room));
    this.emit(room.id, "final-rankings", rankings);
    if (team) {
      this.emit(room.id, "team-result", { name: team.name, code: team.code, averageWpm: team.averageWpm, averageAccuracy: team.averageAccuracy, members: team.members, counted: team.eligible });
    }

    this.onFinished({
      room,
      duration: room.config.timerDuration,
      results: playing.map((p) => ({ id: p.pubId, name: p.username, ...p.finalResults })),
      team,
    });
    this.touch(room);
  }

  /**
   * The team's result: the average of its members who played (a member who did not submit counts as zero). It goes on the team
   * leaderboard only if the team was full, no organizer disqualified it, and every member's result was verified and plausible.
   */
  teamResult(room, playing) {
    const n = Math.max(playing.length, 1);
    const results = playing.map((p) => p.finalResults);
    const eligible =
      !room.team.disqualified &&
      room.players.size >= room.team.targetSize &&
      playing.length > 0 &&
      results.every((r) => r.verified && r.charactersTyped >= this.settings.minLeaderboardChars && r.wpm <= this.settings.maxVerifiedWpm);
    return {
      code: room.id,
      name: room.team.name,
      averageWpm: round1(results.reduce((sum, r) => sum + r.wpm, 0) / n),
      averageAccuracy: round1(results.reduce((sum, r) => sum + r.accuracy, 0) / n),
      members: playing.length,
      eligible,
    };
  }

  /* ------------------------------------------------------------------------------------------------ timers */

  clearTimer(room) {
    clearTimeout(room.timer);
    room.timer = null;
  }

  /** One timer per room, pointed at the next deadline of the current phase. */
  arm(room) {
    this.clearTimer(room);
    let at = null;
    if (room.phase === "countdown") at = room.countdownEndsAt;
    if (room.phase === "test") at = room.testEndsAt + this.settings.submitGraceMs;
    if (at === null) return;

    room.timer = setTimeout(() => this.onTimer(room.id), Math.min(Math.max(at - this.clock(), 0), MAX_TIMER_MS));
    room.timer.unref?.();
  }

  onTimer(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return;
    room.timer = null;
    try {
      if (room.phase === "countdown") {
        if (this.clock() >= room.countdownEndsAt - 5) this.startTest(room);
        else this.arm(room);
      } else if (room.phase === "test") {
        if (this.clock() >= room.testEndsAt + this.settings.submitGraceMs - 5) this.finalize(room);
        else this.arm(room);
      }
    } catch (err) {
      console.error(`[Room ${roomId}] timer failed:`, err);
    }
  }

  /* ------------------------------------------------------------------------------------------------ internals */

  requireMember(roomId, key) {
    const room = this.rooms.get(roomId);
    if (!room) throw new GameError("Room not found");
    if (!room.players.has(key)) throw new GameError("Participant not found in room");
    return room;
  }

  createRoom(id, kind) {
    if (this.rooms.size >= this.settings.maxRooms) throw new GameError("The server is full right now. Try again in a few minutes.");
    const now = this.clock();
    const room = {
      id,
      kind,
      team: null,
      hostKey: null,
      phase: "setup",
      config: { timerDuration: 30 },
      players: new Map(),
      testText: "",
      countdownEndsAt: 0,
      testStartedAt: 0,
      testEndsAt: 0,
      rankings: null,
      createdAt: now,
      updatedAt: now,
      timer: null,
    };
    this.rooms.set(id, room);
    return room;
  }

  deleteRoom(id) {
    const room = this.rooms.get(id);
    if (!room) return;
    this.clearTimer(room);
    for (const p of room.players.values()) {
      clearTimeout(p.graceTimer);
      if (this.keyTeams.get(p.key) === id) this.keyTeams.delete(p.key);
    }
    this.rooms.delete(id);
    this.onRemove(id);
  }

  touch(room) {
    room.updatedAt = this.clock();
    this.onChange(room);
  }

  /** Stops every timer. For shutdown and tests. */
  dispose() {
    for (const room of this.rooms.values()) {
      this.clearTimer(room);
      for (const p of room.players.values()) clearTimeout(p.graceTimer);
    }
  }

  /** Removes team rooms nobody has been in for `idleMs`. Returns how many. */
  sweepIdleTeams(idleMs) {
    const cutoff = this.clock() - idleMs;
    let removed = 0;
    for (const room of [...this.rooms.values()]) {
      if (room.kind !== "team" || room.updatedAt > cutoff) continue;
      if ([...room.players.values()].some((p) => p.socketId)) continue;
      this.deleteRoom(room.id);
      removed += 1;
    }
    return removed;
  }

  /* ------------------------------------------------------------------------------------------------ saving and restoring */

  serialize(room) {
    return {
      v: 1,
      id: room.id,
      kind: room.kind,
      team: room.team,
      hostKey: room.hostKey,
      phase: room.phase,
      config: room.config,
      testText: room.testText,
      countdownEndsAt: room.countdownEndsAt,
      testStartedAt: room.testStartedAt,
      testEndsAt: room.testEndsAt,
      rankings: room.rankings,
      createdAt: room.createdAt,
      updatedAt: room.updatedAt,
      players: [...room.players.values()].map((p) => ({
        key: p.key,
        pubId: p.pubId,
        username: p.username,
        isReady: p.isReady,
        excused: p.excused,
        finalResults: p.finalResults,
      })),
    };
  }

  /**
   * Puts saved rooms back after a restart. Everyone starts out disconnected. An open room's players keep their seat for the grace
   * period, so clients that reconnect and rejoin find their room as it was and rooms nobody comes back to disappear; a team's members
   * keep theirs until they leave. Timers are re-armed from the saved deadlines.
   */
  restore(saved) {
    let restored = 0;
    for (const data of saved) {
      if (!data || data.v !== 1 || typeof data.id !== "string" || !Array.isArray(data.players) || this.rooms.has(data.id)) continue;
      const isTeam = data.kind === "team" && data.team;
      const room = {
        id: data.id,
        kind: isTeam ? "team" : "open",
        team: isTeam ? { name: data.team.name, targetSize: data.team.targetSize, roster: Boolean(data.team.roster), disqualified: Boolean(data.team.disqualified) } : null,
        hostKey: data.hostKey,
        phase: data.phase,
        config: { timerDuration: this.settings.validDurations.includes(data.config?.timerDuration) ? data.config.timerDuration : 30 },
        players: new Map(),
        testText: data.testText ?? "",
        countdownEndsAt: data.countdownEndsAt ?? 0,
        testStartedAt: data.testStartedAt ?? 0,
        testEndsAt: data.testEndsAt ?? 0,
        rankings: data.rankings ?? null,
        createdAt: data.createdAt ?? this.clock(),
        updatedAt: data.updatedAt ?? this.clock(),
        timer: null,
      };
      for (const p of data.players) {
        const player = { ...this.newPlayer({ key: p.key, pubId: p.pubId, username: p.username, socketId: null }), isReady: Boolean(p.isReady), excused: Boolean(p.excused), finalResults: p.finalResults ?? null };
        player.disconnectedAt = this.clock();
        room.players.set(player.key, player);
        this.markDisconnected(room, player);
        if (isTeam && !this.keyTeams.has(player.key)) this.keyTeams.set(player.key, room.id);
      }
      if (room.players.size === 0) continue;
      if (!room.players.has(room.hostKey)) room.hostKey = room.players.keys().next().value;
      this.rooms.set(room.id, room);
      this.arm(room);
      restored += 1;
    }
    return restored;
  }
}

module.exports = RoomManager;
