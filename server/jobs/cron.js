// Periodic housekeeping.
module.exports = ({ manager, leaderboard, settings, limiters, log = console.log }) => {
  const timers = [];
  const every = (ms, fn) => {
    const t = setInterval(fn, ms);
    t.unref?.();
    timers.push(t);
  };

  // Results that could not be written to Redis earlier are written when it is back
  every(15_000, () => void leaderboard.flushPending());

  // Forget address counters from past minutes
  every(60_000, () => limiters.forEach((limiter) => limiter.sweep()));

  // Teams nobody has been in for a long time are forgotten
  every(60 * 60_000, () => {
    const removed = manager.sweepIdleTeams(settings.teamRoomTtlMs);
    if (removed > 0) log(`Removed ${removed} idle team room(s).`);
  });

  every(2 * 60_000, () => {
    const stats = manager.stats();
    log(`Server stats - Rooms: ${stats.rooms} (${stats.teams} teams), Players: ${stats.players} (${stats.connected} connected)`);
  });

  return () => timers.forEach(clearInterval);
};
