import { io } from 'socket.io-client';
import { readSession } from './api.js';

let socket = null;

export function getSocket() {
  const session = readSession();
  if (!session?.accessToken) return null;

  if (socket && socket.auth?.token !== session.accessToken) {
    socket.disconnect();
    socket = null;
  }

  if (!socket) {
    socket = io({
      path: '/socket.io',
      auth: { token: session.accessToken },
      transports: ['websocket', 'polling'],
      autoConnect: true,
    });
  }

  return socket;
}

export function closeSocket() {
  socket?.disconnect();
  socket = null;
}
