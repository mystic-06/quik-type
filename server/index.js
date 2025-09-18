const express = require('express');
const cors = require('cors')
const { createServer } = require('node:http');
const { join } = require('node:path');
const { Server } = require('socket.io');

const app = express();
app.use(cors());

const server = createServer(app);

const rooms = new Map();

const io = new Server(server, {
  cors: {
    origin: "http://localhost:3000",
    methods: ["GET", "POST"]
  }
});

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  //Handle join-room event
  socket.on('join-room',(roomId,username) => {
    console.log(`${username} wants to join ${roomId}`);

    let room = rooms.get(roomId);
    if (!room){
      room = {
        id: roomId,
        hostId: socket.id,
        phase: 'setup',
        config: {
          timerDuration: 30
        },
        participants: []
      }
    }

    const participant = {
      id: socket.id,
      username: username,
      isReady: false,
      isHost: socket.id == room.hostId
    }
    
    room.participants.push(participant);

    socket.join(roomId);

    //To use later
    socket.roomId = roomId;
    socket.username = username;
    
    socket.emit('room-joined',room);
    socket.to(roomId).emit('participant-joined',participant);

    console.log(`${username} has joined ${roomId}`);
  })

  //Handle time configuration event
  socket.on('configure-test',(newConfig) => {
    console.log(`Host wants to change the time to ${newConfig.timerDuration}`);

    const room = rooms.get(socket.roomId);
    
    if (!room) {
      socket.emit('error', 'Room not found');
      return;
    }

    if (socket.id !== room.hostId) {
      socket.emit('error', 'Only host can configure test');
      return;
    }
    room.config.timerDuration = newConfig.timerDuration;

    io.to(socket.roomId).emit('config-updated', room.config);
    console.log(`Host has changed the time to ${newConfig.timerDuration}`);
  })
});

server.listen(3001, () => {
  console.log('server running at http://localhost:3001');
});
