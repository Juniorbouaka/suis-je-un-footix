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

    /*
     * Le mur de paiement se dresse dès la poignée de main : le serveur
     * refuse la connexion à un compte sans abonnement, plutôt qu'événement
     * par événement.
     *
     * Sans ce relais, l'écran de duel resterait indéfiniment sur « recherche
     * d'un adversaire » — la connexion échoue en silence, et rien à l'écran
     * ne dit pourquoi. On prévient l'application, qui relit le profil et
     * renvoie vers l'offre.
     */
    socket.on('connect_error', (err) => {
      if (err?.data?.needsSubscription) {
        window.dispatchEvent(new Event('footix:needs-subscription'));
      }
    });
  }

  return socket;
}

export function closeSocket() {
  socket?.disconnect();
  socket = null;
}
