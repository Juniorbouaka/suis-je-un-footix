import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(here, '..');

/*
 * Le .env est cherché à côté du dossier server/, quel que soit le répertoire
 * depuis lequel on lance le serveur (racine du projet, server/, conteneur…).
 * Les variables déjà présentes dans l'environnement ne sont jamais écrasées :
 * en production, celles de l'hébergeur ont toujours le dernier mot.
 */
dotenv.config({ path: path.join(serverRoot, '.env'), quiet: true });
dotenv.config({ quiet: true }); // .env du répertoire courant, en complément

const isProduction = process.env.NODE_ENV === 'production';

export const config = {
  port: Number(process.env.PORT || 4000),
  // En production le front est servi par ce serveur : aucune origine tierce
  // à autoriser par défaut. En développement, Vite tourne sur le port 5173.
  clientOrigin: (process.env.CLIENT_ORIGIN ?? (isProduction ? '' : 'http://localhost:5173'))
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),

  jwt: {
    accessSecret: process.env.JWT_SECRET || 'dev-access-secret-change-me',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret-change-me',
    accessTtl: process.env.JWT_ACCESS_TTL || '15m',
    refreshTtl: process.env.JWT_REFRESH_TTL || '30d',
  },

  claude: {
    apiKey: process.env.ANTHROPIC_API_KEY || '',
    model: process.env.CLAUDE_MODEL || 'claude-opus-4-8',
    timeoutMs: Number(process.env.CLAUDE_TIMEOUT_MS || 20000),
    // Modèle de secours quand le petit modèle ne reconnait visiblement pas un joueur
    escalationModel: process.env.CLAUDE_ESCALATION_MODEL || 'claude-opus-4-8',
    escalationBelow: Number(process.env.CLAUDE_ESCALATION_BELOW || 20),
  },

  databaseFile: path.isAbsolute(process.env.DATABASE_FILE || '')
    ? process.env.DATABASE_FILE
    : path.join(serverRoot, process.env.DATABASE_FILE || './data/footix.db'),

  // Règles de jeu
  game: {
    guessesPerMinute: 10, // rate limit métier (cahier des charges §8)
    minGuessIntervalMs: 1000, // max 1 appel/sec par joueur (§5)
    maxAttempts: Number(process.env.MAX_ATTEMPTS || 50), // solo : au-delà, perdu
    maxAttemptsPvp: Number(process.env.MAX_ATTEMPTS_PVP || 25), // duel : les deux à sec => nul
    turnMs: Number(process.env.TURN_MS || 15000), // duel : 15 s pour proposer
    maxMissedTurns: Number(process.env.MAX_MISSED_TURNS || 3), // 3 tours manqués = forfait
  },

  // URL publique du site, utilisée dans les e-mails (lien de réinitialisation).
  publicUrl: (process.env.PUBLIC_URL || 'http://localhost:5173').replace(/\/$/, ''),

  mail: {
    apiKey: process.env.RESEND_API_KEY || '',
    from: process.env.MAIL_FROM || 'Suis-je un footix ? <onboarding@resend.dev>',
  },

  // Plafond de dépense : nombre maximum d'appels Claude par jour (UTC).
  // Au-delà, le jeu bascule tout seul sur l'évaluateur de secours.
  dailyApiBudget: Number(process.env.DAILY_API_BUDGET || 3000),
};

export const isProd = process.env.NODE_ENV === 'production';
