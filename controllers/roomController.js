import Room from '../models/Room.js';

const generateRoomCode = () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let result = '';
  for (let i = 0; i < 5; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};

export const createRoom = async (req, res) => {
  try {
    const { id, playerName } = req.body;
    let roomCode = generateRoomCode();
    let existingRoom = await Room.findOne({ roomCode });
    
    while (existingRoom) {
      roomCode = generateRoomCode();
      existingRoom = await Room.findOne({ roomCode });
    }

    const newRoom = new Room({
      roomCode,
      status: 'waiting',
      players: [{ id, name: playerName, isAdmin: true }]
    });

    await newRoom.save();
    res.status(201).json(newRoom);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

export const joinRoom = async (req, res) => {
  try {
    const { roomCode, id, playerName } = req.body;

    const userInActiveRoom = await Room.findOne({
      status: { $in: ['waiting', 'running'] },
      'players.id': id
    });

    if (userInActiveRoom) {
      return res.status(403).json({ error: 'User already in active room' });
    }

    const room = await Room.findOne({ roomCode: roomCode?.toUpperCase() });

    if (!room) {
      return res.status(404).json({ error: 'Room not found' });
    }

    if (room.status !== 'waiting') {
      return res.status(403).json({ error: 'Room is not waiting' });
    }

    if (room.players.length >= 7) {
      return res.status(403).json({ error: 'Room is full' });
    }

    room.players.push({ id, name: playerName, isAdmin: false });
    await room.save();

    res.status(200).json(room);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
