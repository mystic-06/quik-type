const { principalFromSocket } = require("../auth/oidc");

module.exports = (io, socket, eventManager) => {
  const requirePrincipal = () => {
    const principal = principalFromSocket(socket);
    if (!principal) throw new Error("Sign in with your event account first");
    return principal;
  };
  const publish = () => io.to("typing-event").emit("event-state-changed", eventManager.snapshot());

  socket.on("event-join", () => {
    try {
      eventManager.join(requirePrincipal());
      socket.join("typing-event");
      eventManager.setConnection(requirePrincipal(), socket.id, true);
      const activeAttempt = eventManager.resumeAttempt(requirePrincipal());
      socket.emit("event-joined", { event: eventManager.snapshot(), participant: eventManager.participantStatus(requirePrincipal()), attempt: activeAttempt });
      publish();
    } catch (error) { socket.emit("event-error", error.message); }
  });

  socket.on("event-attempt-start", () => {
    try {
      const attempt = eventManager.startAttempt(requirePrincipal());
      socket.emit("event-attempt-started", attempt);
      publish();
    } catch (error) { socket.emit("event-error", error.message); }
  });

  socket.on("event-attempt-progress", payload => {
    try {
      const participant = eventManager.updateProgress(requirePrincipal(), payload || {});
      if (participant?.attempts) socket.emit("event-attempt-saved", participant);
      publish();
    } catch (error) { socket.emit("event-error", error.message); }
  });

  socket.on("disconnect", () => {
    try {
      const principal = principalFromSocket(socket);
      if (principal && eventManager.event?.participants.has(principal.sub)) {
        eventManager.setConnection(principal, socket.id, false);
      }
    } catch { /* The event may not exist yet. */ }
  });
};
