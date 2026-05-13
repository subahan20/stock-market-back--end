/** Avoid circular imports — Socket.io instance registered at startup. */
let ioInstance = null;

export function setIO(io) {
  ioInstance = io;
}

export function getIO() {
  return ioInstance;
}
