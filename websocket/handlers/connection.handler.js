import { EVENTS } from '../events.js';
import { isUserRoom } from '../rooms.js';
import { getMarketSnapshot } from '../../services/realtimeStock.engine.js';

function emitInitialSnapshotToSocket(socket) {
  const snapshot = getMarketSnapshot();
  if (!snapshot) return;

  socket.emit(EVENTS.MARKET_UPDATE, {
    success: true,
    message: 'Initial market snapshot',
    data: {
      nifty: snapshot.nifty,
      sensex: snapshot.sensex,
      marketCards: snapshot.marketCards,
      asOf: snapshot.asOf,
      source: snapshot.source,
    },
  });

  socket.emit(EVENTS.STOCK_UPDATE, {
    success: true,
    message: 'Initial stock map snapshot',
    data: {
      bySymbol: snapshot.bySymbol || {},
      asOf: snapshot.asOf,
      partial: false,
    },
  });

  socket.emit(EVENTS.GAINERS_UPDATE, {
    success: true,
    message: 'Initial top gainers snapshot',
    data: snapshot.topGainers || [],
  });

  socket.emit(EVENTS.LOSERS_UPDATE, {
    success: true,
    message: 'Initial top losers snapshot',
    data: snapshot.topLosers || [],
  });
}

export function registerConnectionHandlers(io) {
  io.on('connection', (socket) => {
    socket.emit(EVENTS.SERVER_HELLO, {
      success: true,
      message: 'Connected',
      data: { socketId: socket.id },
    });

    // Push the current healthy market memory immediately on load
    emitInitialSnapshotToSocket(socket);

    socket.on('join', (room) => {
      if (isUserRoom(room)) socket.join(room);
    });

    socket.on('disconnect', (_reason) => {
      socket.removeAllListeners('join');
    });
  });
}
