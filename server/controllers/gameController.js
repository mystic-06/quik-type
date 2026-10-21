const { generate } = require("random-words");

module.exports = (io, socket, roomManager) => {
  const configureTest = (newConfig) => {
    if (!newConfig || typeof newConfig !== "object") {
      socket.emit("error", "Invalid configuration payload");
      return;
    }

    try {
      const room = roomManager.getRoom(socket.roomId);
      if (!room) {
        socket.emit("error", "Room not found");
        return;
      }

      if (socket.id !== room.hostId) {
        socket.emit("error", "Only host can configure test");
        return;
      }

      // Validate timer duration
      const validDurations = [15, 30, 60, 120];
      if (!validDurations.includes(newConfig.timerDuration)) {
        socket.emit("error", "Invalid timer duration");
        return;
      }

      room.config.timerDuration = newConfig.timerDuration;

      // Broadcast config update to all participants
      io.to(socket.roomId).emit("config-updated", room.config);

    } catch (error) {
      console.error("Error in configure-test:", error);
      socket.emit("error", "Failed to update configuration");
    }
  };

  const readyToggle = () => {
    try {
      const room = roomManager.getRoom(socket.roomId);
      if (!room) {
        socket.emit("error", "Room not found");
        return;
      }

      const participant = room.participants.get(socket.id);
      if (!participant) {
        socket.emit("error", "Participant not found in room");
        return;
      }

      // Toggle ready state
      participant.isReady = !participant.isReady;

      // Broadcast ready state change to all participants in the room
      io.to(socket.roomId).emit(
        "ready-state-changed",
        socket.id,
        participant.isReady
      );

      // Check if all participants are ready and start countdown if so
      const allParticipants = Array.from(room.participants.values());
      const allReady = allParticipants.length >= 1 && allParticipants.every((p) => p.isReady);

      if (allReady && room.phase === "setup") {
        roomManager.clearRoomTimers(room);

        room.phase = "countdown";

        // Start 3-second countdown
        let countdown = 5;
        io.to(socket.roomId).emit("countdown-start", countdown);

        room.countdownInterval = setInterval(() => {
          countdown--;
          if (countdown > 0) {
            io.to(socket.roomId).emit("countdown-update", countdown);
          } else {
            if (room.countdownInterval) {
              clearInterval(room.countdownInterval);
              room.countdownInterval = null;
            }

            // Start the test
            room.phase = "test";
            // Generate random words for the test (same for all players in the room)
            const testWords = generate(200);
            const testText = Array.isArray(testWords) ? testWords.join(" ") : testWords;
            room.config.testText = testText;

            io.to(socket.roomId).emit(
              "test-start",
              testText,
              room.config.timerDuration
            );

            // Set a timeout to force end the test if not all players submit results
            // This is a safety mechanism - normally results should be submitted by clients
            room.testTimeout = setTimeout(() => {
              room.testTimeout = null;
              if (room.phase === "test") {
                // Force submit results for players who haven't submitted yet
                const allParticipants = Array.from(room.participants.values());
                allParticipants.forEach(p => {
                  if (!p.finalResults) {
                    p.finalResults = {
                      wpm: 0,
                      rawWpm: 0,
                      accuracy: 0,
                      charactersTyped: 0,
                      completionPercentage: 0,
                      submittedAt: Date.now(),
                    };
                  }
                });

                // Create rankings and send them
                const rankings = allParticipants
                  .map(p => ({
                    id: p.id,
                    username: p.username,
                    wpm: p.finalResults.wpm,
                    rawWpm: p.finalResults.rawWpm,
                    accuracy: p.finalResults.accuracy,
                    charactersTyped: p.finalResults.charactersTyped,
                    completionPercentage: p.finalResults.completionPercentage,
                  }))
                  .sort((a, b) => b.wpm - a.wpm)
                  .map((player, index) => ({
                    ...player,
                    rank: index + 1,
                  }));

                room.phase = "results";

                // Send room state update first, then rankings
                io.to(socket.roomId).emit("room-state-updated", {
                  ...room,
                  participants: allParticipants,
                });

                io.to(socket.roomId).emit("final-rankings", rankings);
              }
            }, (room.config.timerDuration + 5) * 1000); // Give 5 extra seconds for result submission
          }
        }, 1000);
      }
    } catch (error) {
      console.error("Error in ready-toggle:", error);
      socket.emit("error", "Failed to toggle ready state");
    }
  };

  const submitResults = (results) => {
    if (!results || typeof results !== "object") {
      socket.emit("error", "Invalid results payload");
      return;
    }

    const wpm = results.wpm || 0;
    const rawWpm = results.rawWpm || 0;
    const accuracy = results.accuracy || 0;
    const charactersTyped = results.charactersTyped || 0;
    const completionPercentage = results.completionPercentage || 0;

    // Validate boundaries to prevent cheating and invalid values
    if (
      typeof wpm !== "number" || wpm < 0 || wpm >= 300 ||
      typeof rawWpm !== "number" || rawWpm < 0 || rawWpm >= 500 ||
      typeof accuracy !== "number" || accuracy < 0 || accuracy > 100 ||
      typeof completionPercentage !== "number" || completionPercentage < 0 || completionPercentage > 100 ||
      typeof charactersTyped !== "number" || charactersTyped < 0
    ) {
      socket.emit("error", "Results failed sanity validation checks");
      return;
    }

    try {
      const room = roomManager.getRoom(socket.roomId);
      if (!room) {
        socket.emit("error", "Room not found");
        return;
      }

      // Check if room is in active test phase
      if (room.phase !== "test") {
        socket.emit("error", "Cannot submit results when test is not active");
        return;
      }

      const participant = room.participants.get(socket.id);
      if (!participant) {
        socket.emit("error", "Participant not found in room");
        return;
      }

      // Store final results
      participant.finalResults = {
        wpm: wpm,
        rawWpm: rawWpm,
        accuracy: accuracy,
        charactersTyped: charactersTyped,
        completionPercentage: completionPercentage,
        submittedAt: Date.now(),
      };

      // Check if all participants have submitted results
      const allParticipants = Array.from(room.participants.values());
      const allSubmitted = allParticipants.every(p => p.finalResults !== null);

      if (allSubmitted) {
        // Clear testTimeout since all submitted
        if (room.testTimeout) {
          clearTimeout(room.testTimeout);
          room.testTimeout = null;
        }

        // Create rankings based on WPM
        const rankings = allParticipants
          .map(p => ({
            id: p.id,
            username: p.username,
            wpm: p.finalResults.wpm,
            rawWpm: p.finalResults.rawWpm,
            accuracy: p.finalResults.accuracy,
            charactersTyped: p.finalResults.charactersTyped,
            completionPercentage: p.finalResults.completionPercentage,
          }))
          .sort((a, b) => b.wpm - a.wpm) // Sort by WPM descending
          .map((player, index) => ({
            ...player,
            rank: index + 1,
          }));

        // Transition to results phase and send final rankings
        room.phase = "results";

        // Send room state update first, then rankings
        io.to(socket.roomId).emit("room-state-updated", {
          ...room,
          participants: allParticipants,
        });

        io.to(socket.roomId).emit("final-rankings", rankings);

        // Reset participants' ready state and results for potential next round
        room.resultsTimeout = setTimeout(() => {
          room.resultsTimeout = null;
          allParticipants.forEach(p => {
            p.isReady = false;
            p.finalResults = null;
          });
          room.phase = "setup";
        }, 10000); // Reset after 10 seconds
      }
    } catch (error) {
      console.error("Error in submit-results:", error);
      socket.emit("error", "Failed to submit results");
    }
  };

  socket.on("configure-test", configureTest);
  socket.on("ready-toggle", readyToggle);
  socket.on("submit-results", submitResults);
};
