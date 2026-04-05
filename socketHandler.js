import Room from './models/Room.js';

const socketMap = new Map();
const roomTimers = new Map();

const endRound = async (io, roomCode) => {
  const timers = roomTimers.get(roomCode);
  if (timers && timers.roundInterval) {
    clearInterval(timers.roundInterval);
    timers.roundInterval = null;
  }
  
  const room = await Room.findOne({ roomCode });
  if (room) {
    let changed = false;
    room.players.forEach(p => {
      if (p.isAlive && p.currentDecision === 'none') {
        p.currentDecision = 'pass';
        changed = true;
      }
    });

    if (changed) {
      await room.save();
    }
    
    io.to(roomCode).emit('round_ended');
  }
};

const startRoundTimer = (io, roomCode) => {
  let timers = roomTimers.get(roomCode);
  if (!timers) return;

  timers.roundTimeLeft = 60;
  
  if (timers.roundInterval) clearInterval(timers.roundInterval);

  timers.roundInterval = setInterval(() => {
    timers.roundTimeLeft -= 1;
    io.to(roomCode).emit('round_timer_update', { timeLeft: timers.roundTimeLeft });

    if (timers.roundTimeLeft <= 0) {
      clearInterval(timers.roundInterval);
      timers.roundInterval = null;
      endRound(io, roomCode);
    }
  }, 1000);
};

export const setupSocketHandlers = (io) => {
  io.on('connection', (socket) => {
    socket.on('join_room', async ({ roomCode, playerId }) => {
      socket.join(roomCode);
      socketMap.set(socket.id, { roomCode, playerId });

      const room = await Room.findOne({ roomCode });
      if (room) {
        socket.emit('room_data', { players: room.players });
        
        const player = room.players.find(p => p.id === playerId);
        if (player) {
          socket.to(roomCode).emit('player_joined', { player });
        }
      }
    });

    socket.on('start_game', async ({ roomCode, playerId }) => {
      const room = await Room.findOne({ roomCode });
      if (room) {
        const player = room.players.find(p => p.id === playerId);
        if (player && player.isAdmin) {
          room.status = 'running';
          await room.save();
          io.to(roomCode).emit('game_started', { status: 'running' });

          const timers = {
            globalTimeLeft: 600,
            roundTimeLeft: 60,
            globalInterval: null,
            roundInterval: null
          };
          roomTimers.set(roomCode, timers);

          timers.globalInterval = setInterval(() => {
            timers.globalTimeLeft -= 1;
            io.to(roomCode).emit('game_timer_update', { timeLeft: timers.globalTimeLeft });
            if (timers.globalTimeLeft <= 0) {
              clearInterval(timers.globalInterval);
              if (timers.roundInterval) clearInterval(timers.roundInterval);
              io.to(roomCode).emit('game_over', { reason: 'Time Expired' });
            }
          }, 1000);

          startRoundTimer(io, roomCode);
        }
      }
    });

    socket.on('submit_decision', async ({ roomCode, playerId, decision }) => {
      if (decision !== 'pass' && decision !== 'open') return;

      const room = await Room.findOne({ roomCode });
      if (room) {
        const player = room.players.find(p => p.id === playerId);
        if (player && player.isAlive) {
          player.currentDecision = decision;
          await room.save();

          const allReady = room.players
            .filter(p => p.isAlive)
            .every(p => p.currentDecision !== 'none');

          if (allReady) {
            await endRound(io, roomCode);
          }
        }
      }
    });

    socket.on('disconnect', async () => {
      const data = socketMap.get(socket.id);
      if (data) {
        const { roomCode, playerId } = data;
        socketMap.delete(socket.id);

        const room = await Room.findOne({ roomCode });
        if (room) {
          const index = room.players.findIndex(p => p.id === playerId);
          if (index !== -1) {
            const wasAdmin = room.players[index].isAdmin;
            room.players.splice(index, 1);

            let newAdminId = null;
            if (wasAdmin && room.players.length > 0) {
              room.players[0].isAdmin = true;
              newAdminId = room.players[0].id;
            }

            await room.save();

            io.to(roomCode).emit('player_disconnected', { playerId });

            if (newAdminId) {
              io.to(roomCode).emit('admin_changed', { newAdminId });
            }
          }
        }
      }
    });
  });
};
