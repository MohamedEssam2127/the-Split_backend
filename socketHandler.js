import Room from './models/Room.js';

const socketMap = new Map();

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
