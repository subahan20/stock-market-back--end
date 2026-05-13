import { Server } from 'socket.io';
import { env } from '../config/env.js';
import { registerConnectionHandlers } from './handlers/connection.handler.js';
import { registerStockSocket } from './stock.socket.js';
import { startLiveMarketJob } from '../jobs/liveMarket.job.js';
import { setIO } from './io.registry.js';

export function initWebsocket(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: env.clientOrigin,
      methods: ['GET', 'POST'],
    },
  });

  registerConnectionHandlers(io);
  registerStockSocket(io);
  setIO(io);

  const stopBroadcast = startLiveMarketJob(io);
  return { io, shutdown: stopBroadcast };
}
