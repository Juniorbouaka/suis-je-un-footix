import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { config, isProd } from './config.js';
import './db.js';
import { authRouter } from './routes/auth.routes.js';
import { gameRouter } from './routes/game.routes.js';
import { leaderboardRouter } from './routes/leaderboard.routes.js';
import { billingRouter, billingWebhook } from './routes/billing.routes.js';
import { archiveRouter } from './routes/archive.routes.js';
import { donateRouter } from './routes/donate.routes.js';
import { stripeRouter, stripeWebhook } from './routes/stripe.routes.js';
import { attachRealtime, onlineCount } from './realtime.js';
import { getDailyWord, todayUtc } from './words.js';
import { claudeEnabled } from './claude.js';
import { budgetStatus } from './budget.js';
import { scheduleBackups } from './backup.js';
import { scheduleReconcile } from './reconcile.js';

console.log(
  `[demarrage] node ${process.version} | NODE_ENV=${process.env.NODE_ENV} | ` +
    `PORT=${process.env.PORT} | DATABASE_FILE=${process.env.DATABASE_FILE} | ` +
    `cle Claude=${process.env.ANTHROPIC_API_KEY ? 'oui' : 'non'}`
);

const here = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.set('trust proxy', 1);
app.disable('x-powered-by');

/*
 * Le webhook PayPal est monté avant express.json() : la vérification de
 * signature se fait sur le corps BRUT de la requête. Un JSON déjà analysé
 * puis re-sérialisé ne redonne pas les mêmes octets, et la signature
 * échouerait systématiquement.
 */
app.post(
  '/api/billing/webhook',
  express.raw({ type: 'application/json', limit: '256kb' }),
  billingWebhook
);
app.post(
  '/api/stripe/webhook',
  express.raw({ type: 'application/json', limit: '256kb' }),
  stripeWebhook
);

app.use(express.json({ limit: '64kb' }));

// CORS uniquement si le front est servi depuis une autre origine (mode dev).
// En production le front est servi par ce même serveur : aucune requête
// cross-origin, donc pas de CORS à ouvrir.
if (config.clientOrigin.length) {
  app.use(cors({ origin: config.clientOrigin, credentials: true }));
}

// Garde-fou global
app.use(
  '/api',
  rateLimit({
    windowMs: 60 * 1000,
    limit: 300,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
  })
);

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    engine: claudeEnabled ? 'claude' : 'fallback',
    model: config.claude.model,
    date: todayUtc(),
    online: onlineCount(io),
    budget: budgetStatus(),
    uptime: Math.round(process.uptime()),
  });
});

/*
 * Configuration publique, lue a l'execution par le front.
 *
 * L'identifiant AdSense passe par ici plutot que par une variable VITE_*,
 * qui serait figee au moment de la compilation du bundle — or le front est
 * compile dans l'image Docker. Activer ou couper la publicite ne demande
 * donc qu'un changement de variable, sans recompiler.
 */
app.get('/api/config', (req, res) => {
  res.set('Cache-Control', 'public, max-age=300');
  res.json({ adsClient: config.ads.client || null });
});

app.use('/api/auth', authRouter);
app.use('/api/billing', billingRouter);
app.use('/api/donate', donateRouter);
app.use('/api/stripe', stripeRouter);
app.use('/api', archiveRouter);
app.use('/api', gameRouter);
app.use('/api', leaderboardRouter);

app.use('/api', (req, res) => res.status(404).json({ error: 'Route introuvable.' }));

/* ------------------------------------------------------------------ *
 *  Front en production : ce serveur sert aussi les fichiers statiques.
 *  Une seule origine, donc plus aucune question de CORS.
 * ------------------------------------------------------------------ */

const CLIENT_DIST = process.env.CLIENT_DIST
  ? path.resolve(process.env.CLIENT_DIST)
  : path.resolve(here, '../../client/dist');

const hasBuild = fs.existsSync(path.join(CLIENT_DIST, 'index.html'));

/*
 * ads.txt — obligatoire pour AdSense.
 *
 * Sans ce fichier a la racine du domaine, Google considere l'inventaire
 * comme non autorise et limite fortement la diffusion. Il doit etre servi
 * AVANT le repli SPA, sinon la route attrape-tout renverrait index.html et
 * AdSense signalerait « ads.txt introuvable ».
 */
app.get('/ads.txt', (req, res) => {
  if (!config.ads.client) return res.status(404).type('text/plain').send('');
  const pub = config.ads.client.replace(/^ca-/, '');
  res
    .type('text/plain')
    .set('Cache-Control', 'public, max-age=3600')
    .send(`google.com, ${pub}, DIRECT, f08c47fec0942fa0
`);
});

if (hasBuild) {
  // Les assets portent un hash dans leur nom : cache long sans risque.
  app.use(
    express.static(CLIENT_DIST, {
      index: false,
      maxAge: '365d',
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache');
      },
    })
  );

  // Application monopage : toute autre route renvoie index.html.
  app.get('*', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(CLIENT_DIST, 'index.html'));
  });
} else if (isProd) {
  console.warn(
    `\n  ⚠ Aucun build du front trouvé dans ${CLIENT_DIST}\n` +
      `    Lance « npm run build » dans client/ avant de démarrer en production.\n`
  );
}

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[api]', err);
  res.status(500).json({ error: 'Erreur interne du serveur.' });
});

const server = http.createServer(app);
const io = attachRealtime(server);

// Prépare le joueur du jour au démarrage (jamais exposé).
getDailyWord();

// Sauvegarde au démarrage puis toutes les 24 h.
scheduleBackups();

/*
 * Filet de securite des abonnements.
 *
 * Le webhook fait foi, mais s'il se perd, un client peut etre preleve tout
 * en perdant ses acces : l'echeance passe sans etre prolongee. Ce controle
 * periodique recharge les abonnements dont l'echeance approche.
 */
scheduleReconcile();

/* ------------------------------------------------------------------ *
 *  Garde-fous de démarrage : mieux vaut refuser de démarrer que de
 *  tourner en production avec les secrets de la démo.
 * ------------------------------------------------------------------ */

const DEMO_SECRETS = ['change-me-access-secret', 'change-me-refresh-secret'];
const usesDemoSecrets =
  DEMO_SECRETS.includes(config.jwt.accessSecret) ||
  DEMO_SECRETS.includes(config.jwt.refreshSecret) ||
  config.jwt.accessSecret.startsWith('dev-') ||
  config.jwt.refreshSecret.startsWith('dev-');

if (isProd && usesDemoSecrets) {
  console.error(
    `\n  ⨯ REFUS DE DÉMARRER : les secrets JWT sont ceux de la démo.\n` +
      `    Génère-les avec « npm run secrets » puis renseigne JWT_SECRET\n` +
      `    et JWT_REFRESH_SECRET dans les variables d'environnement.\n`
  );
  process.exit(1);
}

server.listen(config.port, '0.0.0.0', () => {
  console.log(`\n  Suis-je un footix ? — serveur prêt`);
  console.log(`  → http://localhost:${config.port}`);
  console.log(`  → front : ${hasBuild ? 'servi depuis ' + CLIENT_DIST : 'non servi (mode dev : lance Vite)'}`);
  console.log(
    `  → évaluation : ${claudeEnabled ? 'Claude (' + config.claude.model + ')' : 'secours local (aucune clé ANTHROPIC_API_KEY)'}`
  );
  console.log(`  → base : ${config.databaseFile}`);
  if (!isProd && usesDemoSecrets) {
    console.log(`  → ⚠ secrets JWT de démo : à remplacer avant toute mise en ligne`);
  }
  console.log(`  → joueur du jour : ${todayUtc()} (secret côté serveur)\n`);
});

process.on('uncaughtException', (err) => {
  console.error('[fatal] exception non rattrapée :', err);
  process.exit(1);
});
process.on('unhandledRejection', (err) => {
  console.error('[fatal] promesse rejetée :', err);
});

/* Arrêt propre : l'hébergeur envoie SIGTERM à chaque redéploiement. */
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    console.log(`\n  ${signal} reçu — arrêt en cours…`);
    io.close();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000);
  });
}
