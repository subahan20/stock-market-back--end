import express from 'express';
import cors from 'cors';
import { env } from './config/env.js';
import routes from './routes/index.js';
import { errorMiddleware } from './middleware/error.middleware.js';

const app = express();

app.use(
  cors({
    origin: env.clientOrigin,
    credentials: true,
  })
);
app.use(express.json({ limit: '256kb' }));

app.get('/', (_req, res) => {
  res.json({ ok: true, message: 'Stock dashboard API — use /api/* (stocks, user, ai, auth)', socket: true });
});

app.use('/api', routes);
app.use(errorMiddleware);

export default app;
