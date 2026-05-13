import { EVENTS } from '../events.js';
import { isUserRoom } from '../rooms.js';

export function registerConnectionHandlers(io) {
  io.on('connection', (socket) => {
    socket.emit(EVENTS.SERVER_HELLO, {
      success: true,
      message: 'Connected',
      data: { socketId: socket.id },
    });

    socket.on('join', (room) => {
      if (isUserRoom(room)) socket.join(room);
    });

    socket.on('disconnect', (_reason) => {
      socket.removeAllListeners('join');
    });
  });
}
