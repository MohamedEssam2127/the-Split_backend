import mongoose from 'mongoose';

const playerSchema = new mongoose.Schema({
  id: { type: String, required: true },
  name: { type: String },
  isAdmin: { type: Boolean, default: false },
  isAlive: { type: Boolean, default: true },
  isPeeker: { type: Boolean, default: false },
  money: { type: Number, default: 0 },
  currentDecision: {
    type: String,
    enum: ['none', 'pass', 'open'],
    default: 'none'
  }
}, { _id: false });

const roomSchema = new mongoose.Schema({
  roomCode: { 
    type: String, 
    unique: true, 
    uppercase: true, 
    minlength: 4, 
    maxlength: 6,
    required: true
  },
  status: {
    type: String,
    enum: ['waiting', 'running', 'finished'],
    default: 'waiting'
  },
  gameState: {
    currentRound: { type: Number, default: 0, min: 0, max: 14 },
    heatMeter: { type: Number, default: 0, min: 0, max: 100 },
    boxContent: {
      type: String,
      enum: ['police', 'money', 'bomb', 'unknown', 'empty'],
      default: 'unknown'
    },
    trueBoxContent: {
      type: String,
      enum: ['police', 'money', 'bomb', 'empty'],
      default: 'empty'
    },
    lastPeekerId: { type: String, default: null },
    peekerClaim: { type: String, default: null },
    phase: { type: String, enum: ['waiting', 'deception', 'decision', 'resolution'], default: 'waiting' }
  },
  players: [playerSchema]
});

export default mongoose.model('Room', roomSchema);
