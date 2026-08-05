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

  /*
   * Abonnement premium, encaissé par PayPal.
   *
   * Les identifiants « sandbox » et « live » sont deux mondes séparés :
   * les plans créés dans l'un n'existent pas dans l'autre. Tant que
   * PAYPAL_CLIENT_ID est vide, tout le module premium reste inactif et
   * le jeu fonctionne normalement (personne ne peut s'abonner).
   *
   * Création des plans : cd server && npm run paypal:setup
   */
  paypal: {
    clientId: process.env.PAYPAL_CLIENT_ID || '',
    clientSecret: process.env.PAYPAL_CLIENT_SECRET || '',
    environment: process.env.PAYPAL_ENV === 'live' ? 'live' : 'sandbox',
    // Identifiant du webhook, donné par PayPal à la création de l'abonnement
    // aux notifications. Sans lui, aucun webhook n'est accepté.
    webhookId: process.env.PAYPAL_WEBHOOK_ID || '',
    plans: {
      monthly: process.env.PAYPAL_PLAN_MONTHLY || '',
      yearly: process.env.PAYPAL_PLAN_YEARLY || '',
    },
  },

  // Tarifs affichés. Ils doivent correspondre aux plans PayPal ci-dessus :
  // c'est PayPal qui facture, ces valeurs ne servent qu'à l'affichage.
  premium: {
    monthlyPrice: process.env.PREMIUM_PRICE_MONTHLY || '2,99',
    yearlyPrice: process.env.PREMIUM_PRICE_YEARLY || '19,99',
    currency: 'EUR',
  },

  /*
   * Dons.
   *
   * Encaissés par l'API PayPal avec les mêmes identifiants que l'abonnement :
   * l'argent va au compte propriétaire de l'application. Aucune adresse
   * e-mail n'apparaît donc côté client — une adresse en clair sur une page
   * publique est aspirée par les robots en quelques jours.
   *
   * Les montants proposés sont bornés côté serveur : le client ne décide
   * jamais seul de ce qui est facturé.
   */
  donations: {
    amounts: (process.env.DONATION_AMOUNTS || '2,5,10,20')
      .split(',')
      .map((n) => Number(n.trim()))
      .filter((n) => Number.isFinite(n) && n > 0),
    min: Number(process.env.DONATION_MIN || 1),
    max: Number(process.env.DONATION_MAX || 500),
  },

  // Lien de don externe, si tu préfères une page tierce (Ko-fi, PayPal.me).
  // Vide = on utilise la page de soutien intégrée.
  donateUrl: process.env.DONATE_URL || '',
};

export const isProd = process.env.NODE_ENV === 'production';
