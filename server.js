import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import connectDB from './config/db.js';
import roomRoutes from './routes/roomRoutes.js';
import { notFound, errorHandler } from './middlewares/errorMiddleware.js';
import { setupSocketHandlers } from './socketHandler.js';

dotenv.config();

connectDB();
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

app.use(cors());
app.use(express.json());

app.use('/rooms', roomRoutes);

app.use(notFound);
app.use(errorHandler);

setupSocketHandlers(io);

const PORT = process.env.PORT || 5000;

httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
