# ---------- étape 1 : build du front ----------
FROM node:22-alpine AS client
WORKDIR /build

COPY client/package*.json ./
RUN npm ci

COPY client/ ./
RUN npm run build


# ---------- étape 2 : image finale ----------
FROM node:22-alpine
WORKDIR /app

ENV NODE_ENV=production

# su-exec permet d'abandonner les privilèges root au dernier moment,
# une fois le volume rendu accessible (voir docker-entrypoint.sh).
RUN apk add --no-cache su-exec

# Dépendances serveur uniquement (pas les devDependencies)
COPY server/package*.json ./server/
RUN cd server && npm ci --omit=dev

COPY server/ ./server/

# Le build du front, servi directement par Express
COPY --from=client /build/dist ./client/dist

COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh && chown -R node:node /app

# La base vit sur un volume monté ici (voir railway.toml / fly.toml)
ENV DATABASE_FILE=/data/footix.db

EXPOSE 4000

# On démarre root pour pouvoir donner les droits sur le volume, puis
# l'entrypoint bascule sur l'utilisateur « node » avant de lancer le serveur.
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "server/src/index.js"]
