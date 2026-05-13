const USER_ROOM = /^user:[a-z0-9-]+$/i;

export function isUserRoom(room) {
  return typeof room === 'string' && USER_ROOM.test(room);
}
