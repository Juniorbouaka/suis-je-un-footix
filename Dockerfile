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

# Dépendances serveur uniquement (pas les devDependencies)
COPY server/package*.json ./server/
RUN cd server && npm ci --omit=dev

COPY server/ ./server/

# Le build du front, servi directement par Express
COPY --from=client /build/dist ./client/dist

# La base vit sur un volume monté ici (voir railway.toml / fly.toml)
ENV DATABASE_FILE=/data/footix.db
RUN mkdir -p /data && chown -R node:node /data /app

USER node
EXPOSE 4000

# Vérification de santé : l'hébergeur redémarre le conteneur si elle échoue
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/src/index.js"]
