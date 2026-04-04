import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import connectDB from './config/db.js';
import roomRoutes from './routes/roomRoutes.js';
import { notFound, errorHandler } from './middlewares/errorMiddleware.js';

dotenv.config();

// Connect to database
connectDB();
 // Uncomment when you have MongoDB URI in .env

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/rooms', roomRoutes);

// Error handlers
app.use(notFound);
app.use(errorHandler);

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
