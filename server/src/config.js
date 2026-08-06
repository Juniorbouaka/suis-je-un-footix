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

  /*
   * Règles de jeu.
   *
   * Le nombre de chances est devenu la frontière entre le gratuit et
   * l'abonnement. Chaque proposition est un appel facturé à Claude : une
   * partie ouverte à cinquante essais pour tout le monde coûtait plus cher
   * que ce qu'elle rapportait. Quinze chances suffisent à jouer sa journée,
   * cinquante sont le confort qu'on achète.
   *
   * En duel, cette frontière disparaît : les quinze essais sont les mêmes
   * pour les deux adversaires. Ce que l'abonnement achète, c'est le nombre
   * de duels dans la journée — jamais un avantage à l'intérieur d'un duel.
   */
  game: {
    guessesPerMinute: 10, // rate limit métier (cahier des charges §8)
    minGuessIntervalMs: 1000, // max 1 appel/sec par joueur (§5)
    maxAttemptsFree: Number(process.env.MAX_ATTEMPTS_FREE || 15), // solo gratuit : au-delà, perdu
    maxAttemptsPremium: Number(process.env.MAX_ATTEMPTS_PREMIUM || 50), // solo abonné
    // Duel : quinze essais chacun, abonné comme gratuit. C'est le seul
    // chiffre du jeu que l'argent ne change pas — deux adversaires qui ne
    // jouent pas avec le même nombre de balles ne font pas un duel.
    maxAttemptsPvp: Number(process.env.MAX_ATTEMPTS_PVP || 15),
    turnMs: Number(process.env.TURN_MS || 15000), // duel : 15 s pour proposer
    maxMissedTurns: Number(process.env.MAX_MISSED_TURNS || 3), // 3 tours manqués = forfait

    /*
     * Duels par jour. Un duel, ce sont deux joueurs qui proposent jusqu'à
     * quinze mots chacun : c'est le format le plus cher du jeu, et le seul
     * qu'un visiteur pouvait enchaîner sans limite.
     *
     * Un duel par jour en gratuit : le rendez-vous quotidien, comme la
     * partie du jour. L'abonnement en donne cinq, et pas plus — le plafond
     * n'est pas une punition mais un garde-fou de dépense.
     */
    duelsPerDayFree: Number(process.env.MAX_DUELS_FREE || 1),
    duelsPerDayPremium: Number(process.env.MAX_DUELS_PREMIUM || 5),

    /*
     * Parties solo par jour, pour un abonné.
     *
     * Cinq, et pas une de plus : la partie du jour, plus quatre journées
     * d'archive rejouées. La première compte au classement, les quatre
     * autres non — ce sont des parties d'entraînement.
     *
     * Cette frontière n'est pas décorative, c'est la promesse du jeu : un
     * abonnement achète du temps de jeu, jamais des points. Le classement
     * doit rester comparable entre celui qui paie et celui qui ne paie pas,
     * sinon il ne classe plus rien.
     *
     * Le plafond est aussi un garde-fou de dépense : chaque proposition
     * part vers l'API Claude et se facture. Le rejeu était jusqu'ici sans
     * limite pour un abonné — soit, en théorie, autant de parties que de
     * journées archivées dans la même soirée.
     */
    gamesPerDayPremium: Number(process.env.MAX_GAMES_PREMIUM || 5),
  },

  // URL publique du site, utilisée dans les e-mails (lien de réinitialisation).
  publicUrl: (process.env.PUBLIC_URL || 'http://localhost:5173').replace(/\/$/, ''),

  /*
   * Tableau de bord d'administration.
   *
   * Liste blanche d'adresses e-mail, séparées par des virgules. C'est un
   * droit attaché au compte, pas un mot de passe partagé : rien de nouveau à
   * retenir, et retirer une adresse de la variable coupe l'accès au
   * redémarrage suivant sans toucher à la base.
   *
   * Vide = personne n'est administrateur et /api/admin répond 403 à tous.
   */
  adminEmails: (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),

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

  /*
   * Stripe — carte bancaire, Apple Pay, Google Pay.
   *
   * Contrairement à PayPal, il n'y a pas deux environnements séparés : c'est
   * la clé qui décide. « sk_test_… » ne touche à rien de réel, « sk_live_… »
   * encaisse pour de bon. Les identifiants de prix créés avec une clé de
   * test n'existent pas en production, et inversement.
   *
   * Création : cd server && railway run node scripts/stripe-setup.mjs
   */
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY || '',
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
    prices: {
      monthly: process.env.STRIPE_PRICE_MONTHLY || '',
      yearly: process.env.STRIPE_PRICE_YEARLY || '',
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

  /*
   * Publicité (Google AdSense).
   *
   * L'identifiant est lu à l'EXÉCUTION, pas à la compilation. C'est
   * délibéré : le front est compilé dans l'image Docker, donc une variable
   * VITE_* ne serait figée qu'au moment du build. En passant par le serveur,
   * activer ou couper la publicité ne demande qu'un changement de variable
   * et un redémarrage — aucune recompilation.
   *
   * Vide = aucune publicité, aucun script tiers chargé.
   */
  ads: {
    // Format « ca-pub-0000000000000000 », donné par AdSense.
    client: (process.env.ADS_CLIENT || '').trim(),
  },
};

export const isProd = process.env.NODE_ENV === 'production';

/**
 * Nombre de chances d'un joueur sur une partie solo.
 *
 * Accepte indifféremment une ligne de la base (`is_premium`) ou l'utilisateur
 * d'une socket (`isPremium`) : les deux mondes appellent cette fonction, et
 * une règle de facturation ne doit exister qu'à un seul endroit.
 */
export function attemptsFor(user) {
  const premium = Boolean(user?.is_premium ?? user?.isPremium);
  return premium ? config.game.maxAttemptsPremium : config.game.maxAttemptsFree;
}

/**
 * Nombre de parties d'ENTRAÎNEMENT auxquelles un joueur a droit par jour.
 *
 * L'entraînement, ce sont les journées d'archive rejouées : elles ne
 * rapportent ni point, ni médaille, ni place au classement. La partie du
 * jour, elle, est toujours offerte et n'est jamais comptée ici — d'où le
 * « − 1 » : cinq parties par jour dont une classée, donc quatre libres.
 *
 * Zéro pour un compte gratuit : la partie du jour reste son rendez-vous.
 */
export function trainingPerDay(user) {
  const premium = Boolean(user?.is_premium ?? user?.isPremium);
  if (!premium) return 0;
  return Math.max(0, config.game.gamesPerDayPremium - 1);
}
