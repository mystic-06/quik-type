/**
 * Quik-Type Stress Test Script
 * Simulates concurrent players across multiple rooms with full game lifecycles.
 *
 * Usage:
 *   node scripts/stress-test.js [options]
 *
 * Options:
 *   --url <url>         Backend Socket.IO URL (default: http://localhost:3001)
 *   --users <num>       Total number of concurrent players (default: 70)
 *   --roomSize <num>    Max players per room (default: 8, max supported by backend)
 *   --duration <secs>   Test timer duration in seconds if host configures it (default: 15)
 *   --ramp <ms>         Delay between each user connection in ms (default: 50)
 *   --help              Show this help message
 */

const { io } = require("socket.io-client");

// Parse CLI arguments
const args = process.argv.slice(2);
function getArg(flag, defaultValue) {
  const index = args.indexOf(flag);
  return index !== -1 && args[index + 1] ? args[index + 1] : defaultValue;
}

if (args.includes("--help") || args.includes("-h")) {
  console.log(`
Quik-Type Stress Test Script
Options:
  --url <url>         Target Socket.IO URL (default: http://localhost:3001)
  --users <num>       Total players (default: 70)
  --roomSize <num>    Players per room (default: 8)
  --ramp <ms>         Delay between user joins in ms (default: 50)
  `);
  process.exit(0);
}

const TARGET_URL = getArg("--url", process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:3001");
const TOTAL_USERS = parseInt(getArg("--users", "70"), 10);
const ROOM_SIZE = parseInt(getArg("--roomSize", "8"), 10);
const RAMP_DELAY = parseInt(getArg("--ramp", "50"), 10);

const totalRooms = Math.ceil(TOTAL_USERS / ROOM_SIZE);

console.log("==================================================");
console.log(`🚀 Starting Stress Test for Quik-Type`);
console.log(`🎯 Target URL:       ${TARGET_URL}`);
console.log(`👥 Total Users:      ${TOTAL_USERS}`);
console.log(`🏠 Total Rooms:      ${totalRooms} (max ${ROOM_SIZE} players/room)`);
console.log(`⏱️  Ramp-up delay:    ${RAMP_DELAY}ms per player`);
console.log("==================================================\n");

const stats = {
  connected: 0,
  connectionErrors: 0,
  joinedRoom: 0,
  roomErrors: 0,
  countdownStarted: 0,
  testsStarted: 0,
  resultsSubmitted: 0,
  rankingsReceived: 0,
  disconnected: 0,
  connectionTimes: [],
};

const startTime = Date.now();

function formatTime() {
  return ((Date.now() - startTime) / 1000).toFixed(1) + "s";
}

function printSummary() {
  const avgConnTime = stats.connectionTimes.length
    ? (stats.connectionTimes.reduce((a, b) => a + b, 0) / stats.connectionTimes.length).toFixed(1)
    : 0;

  console.log("\n================ STRESS TEST SUMMARY ================");
  console.log(`Total Runtime:             ${formatTime()}`);
  console.log(`Sockets Connected:         ${stats.connected}/${TOTAL_USERS}`);
  console.log(`Avg Connection Latency:    ${avgConnTime} ms`);
  console.log(`Connection Failures:       ${stats.connectionErrors}`);
  console.log(`Rooms Joined:              ${stats.joinedRoom}/${TOTAL_USERS}`);
  console.log(`Room/Socket Errors:        ${stats.roomErrors}`);
  console.log(`Countdowns Started:        ${stats.countdownStarted} events`);
  console.log(`Tests Started:             ${stats.testsStarted} events`);
  console.log(`Results Submitted:         ${stats.resultsSubmitted}/${TOTAL_USERS}`);
  console.log(`Final Rankings Received:   ${stats.rankingsReceived} events`);
  console.log(`Premature Disconnects:     ${stats.disconnected}`);
  console.log("=====================================================");

  if (stats.connected === TOTAL_USERS && stats.roomErrors === 0 && stats.connectionErrors === 0) {
    console.log("✅ SUCCESS: Server successfully handled all concurrent players without errors!");
  } else {
    console.log("⚠️ WARNING: Some connections, events, or rooms encountered issues. Check server logs.");
  }
}

// Global timeout to conclude test
const testTimeout = setTimeout(() => {
  console.log(`\n⏳ Test duration reached maximum limit. Wrapping up...`);
  printSummary();
  process.exit(0);
}, 60000); // 60 seconds max run

async function simulatePlayer(userId) {
  const roomIndex = Math.floor(userId / ROOM_SIZE);
  const roomId = `stress-room-${roomIndex}`;
  const username = `bot_${userId}`;
  const isHost = userId % ROOM_SIZE === 0;

  const connStart = Date.now();
  const socket = io(TARGET_URL, {
    transports: ["websocket", "polling"],
    timeout: 10000,
    forceNew: true,
  });

  socket.on("connect", () => {
    const connDuration = Date.now() - connStart;
    stats.connected++;
    stats.connectionTimes.push(connDuration);

    // Join room
    socket.emit("join-room", roomId, username);
  });

  socket.on("connect_error", (err) => {
    stats.connectionErrors++;
    console.error(`[${formatTime()}] ❌ Player ${username} connect error: ${err.message}`);
  });

  socket.on("error", (msg) => {
    stats.roomErrors++;
    console.error(`[${formatTime()}] ⚠️ Player ${username} received error: ${msg}`);
  });

  socket.on("room-joined", (roomState) => {
    stats.joinedRoom++;

    // If host, configure 15s timer
    if (isHost) {
      socket.emit("configure-test", { timerDuration: 15 });
    }

    // Toggle ready after a brief delay
    setTimeout(() => {
      socket.emit("ready-toggle");
    }, 500 + Math.random() * 500);
  });

  socket.on("countdown-start", () => {
    stats.countdownStarted++;
  });

  socket.on("test-start", (testText, duration) => {
    stats.testsStarted++;

    // The server scores what was typed and refuses a result sent before the time is up, so a bot "types" a stretch of the real text
    // (with the odd typo) and submits just before the deadline.
    const waitMs = Math.max(((duration || 15) * 1000) - 1000, 0);
    setTimeout(() => {
      const length = Math.min(Math.floor(120 + Math.random() * 130), testText.length);
      const typed = testText
        .slice(0, length)
        .split("")
        .map((char) => (Math.random() < 0.03 ? "#" : char))
        .join("");
      socket.emit("submit-results", { typed });
      stats.resultsSubmitted++;
    }, waitMs);
  });

  socket.on("final-rankings", (rankings) => {
    stats.rankingsReceived++;

    // If all submitted in this room, disconnect after seeing rankings
    setTimeout(() => {
      socket.disconnect();
    }, 1000);
  });

  socket.on("disconnect", (reason) => {
    if (reason === "io server disconnect" || reason === "transport close" || reason === "ping timeout") {
      stats.disconnected++;
    }
  });
}

async function run() {
  for (let i = 0; i < TOTAL_USERS; i++) {
    simulatePlayer(i);
    if (RAMP_DELAY > 0) {
      await new Promise((res) => setTimeout(res, RAMP_DELAY));
    }
  }

  // Periodic status update
  const statusInterval = setInterval(() => {
    process.stdout.write(
      `\r[${formatTime()}] Connected: ${stats.connected}/${TOTAL_USERS} | In Rooms: ${stats.joinedRoom} | Submissions: ${stats.resultsSubmitted} | Errors: ${stats.connectionErrors + stats.roomErrors}`
    );

    // If all users received rankings, conclude early
    if (stats.resultsSubmitted >= TOTAL_USERS && stats.rankingsReceived >= TOTAL_USERS) {
      clearInterval(statusInterval);
      clearTimeout(testTimeout);
      setTimeout(() => {
        printSummary();
        process.exit(0);
      }, 1500);
    }
  }, 1000);
}

run();
