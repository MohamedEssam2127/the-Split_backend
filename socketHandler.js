import Room from './models/Room.js';

const socketMap = new Map();
const roomTimers = new Map();

const getRandomMoney = () => {
  const amounts = [3000, 5000, 7000];
  return amounts[Math.floor(Math.random() * amounts.length)];
};

const generateBoxContent = () => {
  const r = Math.random() * 100;
  let boxContent = '';
  if (r < 30) boxContent = 'money';
  else if (r < 70) boxContent = 'bomb';
  else if (r < 80) boxContent = 'police';
  else if (r < 85) boxContent = 'empty';
  else boxContent = 'unknown';

  let trueBoxContent = boxContent;
  if (boxContent === 'unknown') {
    trueBoxContent = Math.random() < 0.5 ? 'money' : 'bomb';
  }
  return { boxContent, trueBoxContent };
};

const checkGameOver = async (io, room) => {
  const alivePlayers = room.players.filter(p => p.isAlive).length;
  const globalTimer = roomTimers.get(room.roomCode)?.globalTimeLeft || 0;
  
  if (room.gameState.heatMeter >= 100 || room.gameState.currentRound === 14 || globalTimer <= 0 || alivePlayers < 2) {
    if (room.gameState.heatMeter >= 100) {
      room.players.forEach(p => { p.money = 0; });
    }
    room.status = 'finished';
    await room.save();
    
    const timers = roomTimers.get(room.roomCode);
    if (timers) {
      if (timers.globalInterval) clearInterval(timers.globalInterval);
      if (timers.roundInterval) clearInterval(timers.roundInterval);
      roomTimers.delete(room.roomCode);
    }
    
    io.to(room.roomCode).emit('game_over', { 
      leaderboard: room.players,
      reason: room.gameState.heatMeter >= 100 ? 'Heat Meter Full' : 
              globalTimer <= 0 ? 'Time Expired' : 
              alivePlayers < 2 ? 'Not Enough Players' : 'Max Rounds Reached'
    });
    return true;
  }
  return false;
};

const endRound = async (io, roomCode) => {
  const timers = roomTimers.get(roomCode);
  if (timers && timers.roundInterval) {
    clearInterval(timers.roundInterval);
    timers.roundInterval = null;
  }
  
  const room = await Room.findOne({ roomCode });
  if (!room) return;

  room.gameState.phase = 'resolution';

  room.players.forEach(p => {
    if (p.isAlive && !p.isPeeker && p.currentDecision === 'none') {
      p.currentDecision = 'pass';
    }
  });

  const alivePlayers = room.players.filter(p => p.isAlive);
  const openers = alivePlayers.filter(p => p.currentDecision === 'open');
  const truth = room.gameState.trueBoxContent;

  if (openers.length > 0) {
    if (truth === 'money') {
      const moneyAmt = getRandomMoney();
      const split = Math.floor(moneyAmt / openers.length);
      openers.forEach(o => { o.money += split; });
    } else if (truth === 'bomb') {
      openers.forEach(o => {
        if (o.money < 1000) {
          o.isAlive = false;
        } else {
          o.money -= Math.floor(o.money * 0.5);
        }
      });
    } else if (truth === 'police') {
      room.gameState.heatMeter += (openers.length / alivePlayers.length) * 100;
    }
  }

  await room.save();
  io.to(roomCode).emit('round_results', { 
    boxContent: room.gameState.boxContent,
    trueBoxContent: truth,
    players: room.players 
  });

  const isOver = await checkGameOver(io, room);
  if (!isOver) {
    setTimeout(async () => {
      const updatedRoom = await Room.findOne({ roomCode });
      if (updatedRoom) {
        updatedRoom.gameState.currentRound += 1;
        updatedRoom.gameState.peekerClaim = null;
        updatedRoom.players.forEach(p => {
          p.currentDecision = 'none';
          p.isPeeker = false;
        });
        await updatedRoom.save();
        startNextRound(io, roomCode);
      }
    }, 5000);
  }
};

const startNextRound = async (io, roomCode) => {
  const room = await Room.findOne({ roomCode });
  if (!room) return;

  room.gameState.phase = 'deception';
  const { boxContent, trueBoxContent } = generateBoxContent();
  room.gameState.boxContent = boxContent;
  room.gameState.trueBoxContent = trueBoxContent;

  const validPeekers = room.players.filter(p => p.isAlive && p.id !== room.gameState.lastPeekerId);
  const peekerPool = validPeekers.length > 0 ? validPeekers : room.players.filter(p => p.isAlive);
  
  const peeker = peekerPool[Math.floor(Math.random() * peekerPool.length)];
  room.gameState.lastPeekerId = peeker.id;
  room.players.forEach(p => { p.isPeeker = (p.id === peeker.id); });

  await room.save();

  let peekerSocketId = null;
  for (let [sId, data] of socketMap.entries()) {
    if (data.roomCode === roomCode && data.playerId === peeker.id) {
      peekerSocketId = sId;
      break;
    }
  }
  
  if (peekerSocketId) {
    io.to(peekerSocketId).emit('peeker_turn', { boxContent });
  }
  
  const timers = roomTimers.get(roomCode);
  if (timers) {
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
  }
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
          room.gameState.currentRound = 0;
          await room.save();
          io.to(roomCode).emit('game_started', { status: 'running' });

          const timers = {
            globalTimeLeft: 600,
            roundTimeLeft: 60,
            globalInterval: null,
            roundInterval: null
          };
          roomTimers.set(roomCode, timers);

          timers.globalInterval = setInterval(async () => {
            timers.globalTimeLeft -= 1;
            io.to(roomCode).emit('game_timer_update', { timeLeft: timers.globalTimeLeft });
            if (timers.globalTimeLeft <= 0) {
              clearInterval(timers.globalInterval);
              if (timers.roundInterval) clearInterval(timers.roundInterval);
              const r = await Room.findOne({ roomCode });
              if (r) await checkGameOver(io, r);
            }
          }, 1000);

          startNextRound(io, roomCode);
        }
      }
    });
    
    socket.on('peeker_submit_claim', async ({ roomCode, claim }) => {
      const data = socketMap.get(socket.id);
      if (!data) return;
      
      const room = await Room.findOne({ roomCode });
      if (room && room.gameState.phase === 'deception') {
        const peeker = room.players.find(p => p.id === data.playerId);
        if (peeker && peeker.isPeeker && peeker.isAlive) {
          room.gameState.peekerClaim = claim;
          room.gameState.phase = 'decision';
          await room.save();
          io.to(roomCode).emit('claim_broadcast', { claim });
        }
      }
    });

    socket.on('submit_decision', async ({ roomCode, playerId, decision }) => {
      if (decision !== 'pass' && decision !== 'open') return;

      const room = await Room.findOne({ roomCode });
      if (room && room.gameState.phase === 'decision') {
        const player = room.players.find(p => p.id === playerId);
        if (player && player.isAlive && !player.isPeeker) {
          player.currentDecision = decision;
          await room.save();

          const allReady = room.players
            .filter(p => p.isAlive && !p.isPeeker)
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
