const { generate } = require("random-words");
const { randomUUID } = require("node:crypto");

const MIN_ACCURACY = 80;
const MAX_EVENT_DURATION_SECONDS = 15 * 60;
const ATTEMPT_DURATION_SECONDS = 60;
const MAX_ATTEMPTS_PER_PARTICIPANT = 3;
const MIN_WPM_ELAPSED_MS = 3000;

/**
 * Owns the single live typing event. Identity is deliberately supplied by the
 * caller as a verified principal; socket IDs and user supplied names are not
 * participant identities.
 */
class EventManager {
  constructor({ clock = () => Date.now(), textFactory = () => generate(200).join(" "), store = null } = {}) {
    this.clock = clock;
    this.textFactory = textFactory;
    this.store = store;
    this.onUpdate = null;
    this.event = null;
    this.connections = new Map();
    this.closeTimeout = null;
    this.persistTimeout = null;
    this.nextAttemptId = 1;
    const saved = this.store?.load();
    if (saved) {
      this.event = this.restoreEvent(saved);
      for (const participant of this.event.participants.values()) participant.isOnline = false;
      this.nextAttemptId = saved.nextAttemptId || 1;
      this.restoreTimers();
    }
  }

  persist() {
    if (!this.store || !this.event) return;
    const save = () => {
      this.persistTimeout = null;
      this.store.save({ ...this.serializeEvent(this.event), nextAttemptId: this.nextAttemptId });
    };
    if (this.persistTimeout) return;
    this.persistTimeout = setTimeout(save, 200);
    this.persistTimeout.unref?.();
  }

  restoreEvent(saved) {
    // Normalize persisted events written by older versions before the admin
    // invalidation history and participant removal reason were added.
    return {
      ...saved,
      invalidations: Array.isArray(saved.invalidations) ? saved.invalidations : [],
      participants: new Map((Array.isArray(saved.participants) ? saved.participants : []).map(([id, participant]) => [id, {
        ...participant,
        attempts: Array.isArray(participant.attempts) ? participant.attempts : [],
        invalidated: Boolean(participant.invalidated),
        invalidationReason: participant.invalidationReason || null,
      }])),
    };
  }

  serializeEvent(event) {
    const participants = [...event.participants.entries()].map(([id, participant]) => {
      const activeAttempt = participant.activeAttempt;
      return [id, { ...participant, activeAttempt: activeAttempt ? (({ timeout, ...attempt }) => attempt)(activeAttempt) : null }];
    });
    return { ...event, participants };
  }

  notify() {
    if (this.onUpdate && this.event) this.onUpdate(this.snapshot());
  }

  restoreTimers() {
    if (this.event.status === "open") {
      const remaining = this.event.closesAt - this.clock();
      if (remaining <= 0) this.close();
      else this.closeTimeout = setTimeout(() => this.close(), remaining);
      for (const participant of this.event.participants.values()) {
        const attempt = participant.activeAttempt;
        if (!attempt) continue;
        const attemptRemaining = attempt.startedAt + ATTEMPT_DURATION_SECONDS * 1000 - this.clock();
        if (attemptRemaining <= 0) this.finishAttempt(participant, attempt, false);
        else {
          attempt.timeout = setTimeout(() => {
            if (participant.activeAttempt === attempt) this.finishAttempt(participant, attempt, false);
          }, Math.min(attemptRemaining, Math.max(0, remaining)));
        }
      }
    }
  }

  createEvent({ title = "QuikType Speed Typing Event", durationSeconds = 900 } = {}) {
    if (![600, 900].includes(durationSeconds)) {
      throw new Error("Event duration must be 10 or 15 minutes");
    }
    if (this.event && this.event.status !== "closed") {
      throw new Error("An event is already active");
    }
    if (this.event?.status === "closed") {
      this.store?.archive({ ...this.serializeEvent(this.event), nextAttemptId: this.nextAttemptId });
    }
    this.event = {
      id: `event-${randomUUID()}`,
      createdAt: this.clock(),
      title: String(title || "").trim().slice(0, 80) || "QuikType Speed Typing Event",
      durationSeconds,
      status: "lobby",
      opensAt: null,
      closesAt: null,
      prompts: Array.from({ length: 30 }, () => this.textFactory()),
      participants: new Map(),
      invalidations: [],
    };
    this.persist();
    this.notify();
    return this.snapshot();
  }

  open() {
    const event = this.requireEvent();
    if (event.status !== "lobby") throw new Error("Event is not in the lobby");
    event.status = "open";
    event.opensAt = this.clock();
    event.closesAt = event.opensAt + event.durationSeconds * 1000;
    this.closeTimeout = setTimeout(() => this.close(), Math.max(0, event.closesAt - this.clock()));
    this.persist();
    this.notify();
    return this.snapshot();
  }

  close() {
    const event = this.requireEvent();
    if (event.status === "closed") return this.snapshot();
    if (event.status !== "open") throw new Error("Event is not open");
    event.status = "closed";
    if (this.closeTimeout) clearTimeout(this.closeTimeout);
    this.closeTimeout = null;

    // A cutoff is evaluated against server time. Attempts in progress at close
    // are frozen from their last server-received progress update.
    for (const participant of event.participants.values()) {
      if (participant.activeAttempt) {
        this.finishAttempt(participant, participant.activeAttempt, true);
      }
    }
    this.persist();
    this.notify();
    return this.snapshot();
  }

  join(principal) {
    const event = this.requireEvent();
    this.assertPrincipal(principal);
    let participant = event.participants.get(principal.sub);
    if (!participant) {
      if (event.status === "closed") throw new Error("This event has ended");
      participant = {
        id: principal.sub,
        publicId: randomUUID(),
        displayName: String(principal.displayName || principal.name || "Participant").slice(0, 60),
        pictureUrl: principal.pictureUrl || null,
        attempts: [],
        activeAttempt: null,
        invalidated: false,
        isOnline: false,
      };
      event.participants.set(principal.sub, participant);
      this.persist();
      this.notify();
    }
    if (principal.pictureUrl && participant.pictureUrl !== principal.pictureUrl) {
      participant.pictureUrl = principal.pictureUrl;
      this.persist();
    }
    return this.participantSnapshot(participant);
  }

  startAttempt(principal) {
    const event = this.requireEvent();
    if (event.status !== "open" || this.clock() >= event.closesAt) {
      if (event.status === "open") this.close();
      throw new Error("The event is closed to new attempts");
    }
    const participant = this.requireParticipant(principal);
    if (participant.invalidated) throw new Error("This participant has been removed from the event");
    if (participant.activeAttempt) throw new Error("An attempt is already in progress");
    if (participant.attempts.length >= MAX_ATTEMPTS_PER_PARTICIPANT) {
      throw new Error(`Each participant can complete up to ${MAX_ATTEMPTS_PER_PARTICIPANT} attempts`);
    }
    const text = event.prompts[participant.attempts.length % event.prompts.length];
    const attempt = {
      id: `attempt-${this.nextAttemptId++}`,
      startedAt: this.clock(),
      endedAt: null,
      text,
      progress: { typed: "", updatedAt: this.clock() },
      result: null,
      eligible: false,
      invalidationReason: null,
      timeout: null,
    };
    participant.activeAttempt = attempt;
    attempt.timeout = setTimeout(() => {
      if (participant.activeAttempt === attempt) this.finishAttempt(participant, attempt, false);
    }, ATTEMPT_DURATION_SECONDS * 1000);
    this.persist();
    this.notify();
    return { id: attempt.id, text, startedAt: attempt.startedAt, durationSeconds: ATTEMPT_DURATION_SECONDS, closesAt: event.closesAt };
  }

  updateProgress(principal, { attemptId, typed }) {
    const event = this.requireEvent();
    const participant = this.requireParticipant(principal);
    const attempt = participant.activeAttempt;
    if (!attempt || attempt.id !== attemptId) throw new Error("No matching attempt is active");
    if (event.status !== "open" || this.clock() >= event.closesAt) {
      this.close();
      throw new Error("The event has closed");
    }
    if (typeof typed !== "string" || typed.length > attempt.text.length) throw new Error("Invalid progress");
    // Keep the latest full input so the server can score the exact prefix at
    // completion or at the event cutoff, including corrected characters.
    const now = this.clock();
    const maxCharactersAtCurrentRate = Math.ceil(((now - attempt.startedAt) / 1000) * 30) + 3;
    if (typed.length > maxCharactersAtCurrentRate) throw new Error("Typing progress exceeded the allowed rate");
    attempt.progress = { typed, updatedAt: now };
    this.persist();
    if (typed.length === attempt.text.length) {
      this.finishAttempt(participant, attempt, false);
      return this.participantSnapshot(participant);
    }
    return { progress: typed.length, participant: this.participantSnapshot(participant) };
  }

  finalizeAttempt(participant, attempt, atWindowClose) {
    // Match the client WPM floor so an almost-immediate cutoff cannot produce
    // an extreme score from only a few typed characters.
    const elapsedMs = Math.max(MIN_WPM_ELAPSED_MS, attempt.endedAt - attempt.startedAt);
    const typedCount = attempt.progress.typed.length;
    let correctCount = 0;
    for (let index = 0; index < typedCount; index++) {
      if (attempt.progress.typed[index] === attempt.text[index]) correctCount++;
    }
    const rawAccuracy = typedCount ? (correctCount / typedCount) * 100 : 0;
    const accuracy = Math.round(rawAccuracy * 10) / 10;
    const wpm = Math.round((correctCount / 5) / (elapsedMs / 60000));
    attempt.result = { wpm, accuracy, charactersTyped: typedCount, submittedAt: attempt.endedAt, endedByWindow: atWindowClose };
    attempt.eligible = rawAccuracy >= MIN_ACCURACY && !participant.invalidated && !attempt.invalidationReason;
    participant.attempts.push(attempt);
  }

  finishAttempt(participant, attempt, atWindowClose) {
    if (attempt.timeout) clearTimeout(attempt.timeout);
    attempt.timeout = null;
    if (!attempt.endedAt) attempt.endedAt = atWindowClose
      ? Math.min(this.requireEvent().closesAt, attempt.progress.updatedAt)
      : Math.min(this.clock(), attempt.startedAt + ATTEMPT_DURATION_SECONDS * 1000);
    this.finalizeAttempt(participant, attempt, atWindowClose);
    if (participant.activeAttempt === attempt) participant.activeAttempt = null;
    this.persist();
    this.notify();
    return this.participantSnapshot(participant);
  }

  invalidate(principal, { participantId, attemptId, reason }) {
    this.assertAdmin(principal);
    const event = this.requireEvent();
    const target = event.participants.get(participantId);
    if (!target) throw new Error("Participant not found");
    const cleanReason = String(reason ?? "").trim().slice(0, 200);
    if (!cleanReason) throw new Error("An invalidation reason is required");
    if (attemptId) {
      const attempt = target.attempts.find(item => item.id === attemptId) || target.activeAttempt;
      if (!attempt || attempt.id !== attemptId) throw new Error("Attempt not found");
      attempt.eligible = false;
      attempt.invalidationReason = cleanReason;
    } else {
      target.invalidated = true;
      target.invalidationReason = cleanReason;
      target.attempts.forEach(attempt => {
        attempt.eligible = false;
        attempt.invalidationReason = cleanReason;
      });
      if (target.activeAttempt) {
        target.activeAttempt.eligible = false;
        target.activeAttempt.invalidationReason = cleanReason;
        this.finishAttempt(target, target.activeAttempt, false);
      }
    }
    if (!Array.isArray(event.invalidations)) event.invalidations = [];
    event.invalidations.push({ participantId, attemptId: attemptId || null, reason: cleanReason, at: this.clock(), by: principal.sub });
    this.persist();
    this.notify();
    return this.snapshot();
  }

  reinstate(principal, { participantId }) {
    this.assertAdmin(principal);
    const event = this.requireEvent();
    const target = event.participants.get(participantId);
    if (!target) throw new Error("Participant not found");
    if (!target.invalidated) throw new Error("Participant is not removed");

    target.invalidated = false;
    target.invalidationReason = null;
    if (!Array.isArray(event.invalidations)) event.invalidations = [];
    event.invalidations.push({ participantId, attemptId: null, action: "reinstated", reason: "Participant reinstated", at: this.clock(), by: principal.sub });
    this.persist();
    this.notify();
    return this.snapshot();
  }

  setConnection(principal, socketId, connected) {
    this.assertPrincipal(principal);
    const participant = this.requireEvent().participants.get(principal.sub);
    if (!participant) return;
    let sockets = this.connections.get(principal.sub);
    if (!sockets) {
      sockets = new Set();
      this.connections.set(principal.sub, sockets);
    }
    if (connected) sockets.add(socketId);
    else sockets.delete(socketId);
    if (sockets.size === 0) this.connections.delete(principal.sub);
    participant.isOnline = Boolean(this.connections.get(principal.sub)?.size);
    this.notify();
  }

  leaderboard(event = this.requireEvent()) {
    const sorted = [...event.participants.values()]
      .map(participant => {
        const best = participant.attempts.filter(attempt => attempt.eligible && !participant.invalidated)
          .sort((a, b) => b.result.wpm - a.result.wpm || b.result.accuracy - a.result.accuracy)[0];
        return best ? { id: participant.publicId, displayName: participant.displayName, pictureUrl: participant.pictureUrl || null, wpm: best.result.wpm,
          accuracy: best.result.accuracy, attemptId: best.id, attempts: participant.attempts.length } : null;
      })
      .filter(Boolean)
      .sort((a, b) => b.wpm - a.wpm || b.accuracy - a.accuracy);
    let currentRank = 0;
    return sorted.map((entry, index) => {
      const previous = sorted[index - 1];
      if (!previous || previous.wpm !== entry.wpm || previous.accuracy !== entry.accuracy) currentRank = index + 1;
      return { ...entry, rank: currentRank };
    });
  }

  snapshot(event = this.requireEvent()) {
    return {
      id: event.id, title: event.title, durationSeconds: event.durationSeconds,
      status: event.status, opensAt: event.opensAt, closesAt: event.closesAt,
      minAccuracy: MIN_ACCURACY,
      participantCount: event.participants.size,
      attemptsCompleted: [...event.participants.values()].reduce((total, p) => total + p.attempts.length, 0),
      activeAttempts: [...event.participants.values()].filter(p => p.activeAttempt).length,
      leaderboard: this.leaderboard(event),
    };
  }

  listEvents() {
    const archived = this.store?.listHistory() || [];
    const allEvents = this.event
      ? [this.event, ...archived.filter(item => item.id !== this.event.id).map(item => this.restoreEvent(item))]
      : archived.map(item => this.restoreEvent(item));
    return allEvents.map(event => ({
      id: event.id,
      current: event.id === this.event?.id,
      title: event.title,
      durationSeconds: event.durationSeconds,
      status: event.status,
      createdAt: event.createdAt || event.opensAt || null,
      opensAt: event.opensAt,
      closesAt: event.closesAt,
      participantCount: event.participants.size,
      attemptsCompleted: [...event.participants.values()].reduce((total, participant) => total + participant.attempts.length, 0),
      leaderboard: this.leaderboard(event),
    }));
  }

  eventDetails(id) {
    let event;
    if (this.event?.id === id) event = this.event;
    else {
      const archived = this.store?.getHistory(id);
      if (archived) event = this.restoreEvent(archived);
    }
    if (!event) return null;
    const summary = this.snapshot(event);
    return {
      ...summary,
      createdAt: event.createdAt || event.opensAt || null,
      participants: [...event.participants.values()].map(participant => ({
        id: participant.publicId,
        displayName: participant.displayName,
        pictureUrl: participant.pictureUrl || null,
        invalidated: Boolean(participant.invalidated),
        activeAttempt: Boolean(participant.activeAttempt),
        attempts: participant.attempts.map(attempt => ({
          id: attempt.id,
          result: attempt.result,
          eligible: Boolean(attempt.eligible),
        })),
      })),
    };
  }

  adminSnapshot() {
    const snapshot = this.snapshot();
    snapshot.participants = [...this.event.participants.values()].map(participant => ({
      ...this.participantSnapshot(participant),
      oidcSubject: participant.id,
    }));
    snapshot.invalidations = this.event.invalidations.map(item => ({ ...item }));
    return snapshot;
  }

  participantStatus(principal) {
    return this.participantSnapshot(this.requireParticipant(principal));
  }

  resumeAttempt(principal) {
    const event = this.requireEvent();
    const participant = this.requireParticipant(principal);
    const attempt = participant.activeAttempt;
    if (!attempt) return null;
    const remaining = Math.max(0, Math.min(attempt.startedAt + ATTEMPT_DURATION_SECONDS * 1000, event.closesAt) - this.clock());
    if (remaining <= 0) {
      this.finishAttempt(participant, attempt, this.clock() >= event.closesAt);
      return null;
    }
    return {
      id: attempt.id,
      text: attempt.text,
      typed: attempt.progress.typed,
      startedAt: attempt.startedAt,
      closesAt: event.closesAt,
      durationSeconds: Math.max(1, Math.ceil(remaining / 1000)),
    };
  }

  participantSnapshot(participant) {
    return {
      id: participant.publicId,
      displayName: participant.displayName,
      pictureUrl: participant.pictureUrl || null,
      invalidated: participant.invalidated,
      invalidationReason: participant.invalidationReason || null,
      isOnline: Boolean(participant.isOnline),
      attempts: participant.attempts.map(attempt => ({ id: attempt.id, result: attempt.result,
        eligible: attempt.eligible, invalidationReason: attempt.invalidationReason })),
      activeAttempt: participant.activeAttempt ? { id: participant.activeAttempt.id,
        typedCharacters: participant.activeAttempt.progress.typed.length,
        startedAt: participant.activeAttempt.startedAt } : null,
      best: this.leaderboard().find(entry => entry.id === participant.publicId) || null,
    };
  }

  requireParticipant(principal) {
    this.assertPrincipal(principal);
    const participant = this.requireEvent().participants.get(principal.sub);
    if (!participant) throw new Error("Join the event first");
    return participant;
  }

  requireEvent() {
    if (!this.event) throw new Error("No event has been created");
    return this.event;
  }

  assertPrincipal(principal) {
    if (!principal || typeof principal.sub !== "string" || !principal.sub) {
      throw new Error("A verified OIDC participant identity is required");
    }
  }

  assertAdmin(principal) {
    this.assertPrincipal(principal);
    if (!principal.isEventAdmin) throw new Error("Event admin access required");
  }
}

module.exports = { EventManager, MIN_ACCURACY, MAX_EVENT_DURATION_SECONDS, ATTEMPT_DURATION_SECONDS };
