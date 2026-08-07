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

  /*
   * L'évaluateur.
   *
   * Sonnet plutôt qu'Opus : à qualité de jauge égale, la proposition coûte
   * 2,56 $ les mille au lieu de 6,58 $ — le poste de dépense principal du jeu
   * divisé par deux et demi. Le banc d'essai (tests/compare-models.mjs) est
   * ce qui a tranché, sur huit paires de joueurs :
   *
   *   buffon/casillas    Opus 83   Sonnet 65   Haiku 0
   *   messi/ronaldo      Opus 72   Sonnet 60   Haiku 10
   *   gomis/gomes        Opus 55   Sonnet 10   Haiku 15
   *
   * Sonnet comprime un peu l'échelle mais garde l'ORDRE, et c'est l'ordre qui
   * fait la jauge : proche reste proche, loin reste loin. Il est même plus
   * juste qu'Opus sur les pièges orthographiques.
   *
   * Haiku, moins cher encore, a été écarté : il note zéro une proposition
   * quasi parfaite. La jauge annoncerait « glacial » à un joueur à un pas du
   * but — et six cas sur huit passant sous le seuil d'escalade, chaque
   * proposition paierait Haiku PUIS Opus. Moins cher à la ligne, plus cher au
   * total, et le jeu cassé au passage.
   */
  claude: {
    apiKey: process.env.ANTHROPIC_API_KEY || '',
    model: process.env.CLAUDE_MODEL || 'claude-sonnet-5',
    timeoutMs: Number(process.env.CLAUDE_TIMEOUT_MS || 20000),
    /*
     * Modèle de secours quand le petit modèle ne reconnait visiblement pas un
     * joueur. Cette échelle existait déjà mais dormait : les deux variables
     * pointaient sur le même modèle, et needsEscalation() rend la main tout
     * de suite dans ce cas. Elle s'allume maintenant qu'elles diffèrent.
     */
    escalationModel: process.env.CLAUDE_ESCALATION_MODEL || 'claude-opus-4-8',
    escalationBelow: Number(process.env.CLAUDE_ESCALATION_BELOW || 20),
  },

  databaseFile: path.isAbsolute(process.env.DATABASE_FILE || '')
    ? process.env.DATABASE_FILE
    : path.join(serverRoot, process.env.DATABASE_FILE || './data/footix.db'),

  /*
   * Règles de jeu.
   *
   * Il n'y a plus de forfait gratuit : jouer demande un abonnement. Le jeu
   * s'est ouvert gratuitement pendant des mois et le compte est sans appel —
   * 981 inscrits, zéro don, et une facture d'API à payer chaque mois. Chaque
   * proposition est un appel facturé à Claude : un jeu qui ne se vend pas
   * s'éteint, il ne devient pas rentable en attendant.
   *
   * Restent donc DEUX forfaits, et ce qui les sépare est le NOMBRE de
   * parties, jamais leur longueur : vingt chances pour tout le monde, en
   * solo comme en duel.
   *
   * Les anciens noms de variables (MAX_ATTEMPTS_FREE, MAX_DUELS_FREE) sont
   * encore lus en second recours : ils sont posés chez l'hébergeur et une
   * bascule tarifaire n'a pas à casser des réglages qui restent justes.
   */
  game: {
    guessesPerMinute: 10, // rate limit métier (cahier des charges §8)
    minGuessIntervalMs: 1000, // max 1 appel/sec par joueur (§5)

    /*
     * VINGT chances par partie, pour tout le monde.
     *
     * L'ancien forfait premium en donnait cinquante, le gratuit quinze. Ce
     * découpage n'est plus possible, et c'est le passage aux crédits qui
     * l'interdit : une partie facturée un crédit doit coûter à peu près la
     * même chose à servir, sinon le prix du crédit ne veut plus rien dire.
     * Une partie à cinquante essais coûte plus de trois fois une partie à
     * quinze — vendue au même crédit, elle transformait chaque gros joueur
     * en perte sèche.
     *
     * Vingt plutôt que quinze : quinze suffisent à jouer sa journée, mais
     * elles laissent trop de parties se terminer sur une frustration alors
     * que le joueur brûlait. Cinq essais de plus, c'est une partie que l'on
     * finit — et ce qu'on vend est du temps de jeu.
     *
     * Ce n'est pas gratuit : une partie au pire coûte un tiers de plus à
     * servir, et la marge plancher des deux forfaits descend d'environ 40 %
     * à un peu moins de 25 %. Elle reste positive dans TOUS les cas, y
     * compris si chaque abonné épuise ses vingt essais à chaque partie —
     * c'est la condition qu'on s'est fixée et elle tient toujours. Le calcul
     * complet est dans la section `credits`.
     *
     * Ce que le forfait supérieur achète reste le NOMBRE de parties, pas la
     * longueur de chacune. C'est plus honnête à expliquer, et accessoirement
     * plus juste : deux abonnés qui jouent la même journée jouent avec le
     * même nombre de balles.
     */
    maxAttempts: Number(process.env.MAX_ATTEMPTS || process.env.MAX_ATTEMPTS_FREE || 20),
    // Duel : vingt essais chacun, même chiffre qu'en solo et quel que soit
    // le forfait. C'est le seul nombre du jeu que l'argent ne change pas —
    // deux adversaires qui ne jouent pas avec le même nombre de balles ne
    // font pas un duel.
    maxAttemptsPvp: Number(process.env.MAX_ATTEMPTS_PVP || 20),
    turnMs: Number(process.env.TURN_MS || 15000), // duel : 15 s pour proposer
    maxMissedTurns: Number(process.env.MAX_MISSED_TURNS || 3), // 3 tours manqués = forfait

    /*
     * Il n'y a plus de quota journalier — ni de duels, ni de parties.
     *
     * Les crédits ont remplacé les deux. Un compteur par jour et un compteur
     * par mois qui disent la même chose (« tu as assez joué »), c'est un de
     * trop : le joueur ne sait plus lequel l'arrête, et le code doit garder
     * les deux d'accord. Voir la section `credits` plus bas.
     *
     * Ce qui reste, et qui n'est PAS une affaire d'argent : une seule partie
     * classée par jour. Celle-là est une règle de classement, pas de
     * facturation — voir scoring.js.
     */
    rankedPerDay: 1,
  },

  /*
   * Les crédits — ce qu'on joue EN PLUS du rendez-vous quotidien.
   *
   * L'abonnement donne d'abord le joueur mystère du jour, tous les jours,
   * sans rien décompter. C'est le cœur du jeu et son rendez-vous : le faire
   * payer à l'unité aurait mis un péage devant la seule chose qui fait
   * revenir quelqu'un chaque matin.
   *
   * Les crédits servent au RESTE — rejouer une journée d'archive, lancer un
   * duel. Ce sont les parties qu'on ajoute quand on en veut plus, et c'est
   * là que la dépense d'API décolle vraiment.
   *
   * ── Le calcul qui fixe ces chiffres ────────────────────────────────
   *
   * Une proposition coûte ~0,0024 € (Sonnet, 2,56 $ les mille). L'escalade
   * vers Opus sur les joueurs mal reconnus pousse la moyenne autour de
   * 0,004 €. Une partie va jusqu'à VINGT propositions : au pire ~0,08 €, et
   * plutôt 0,04 € au régime réel — une partie trouvée tourne autour de dix
   * propositions, pas vingt.
   *
   * Stripe prélève 1,5 % + 0,25 € par encaissement. Le mot du jour joué tous
   * les jours, c'est ~30 parties par mois qui s'ajoutent aux crédits.
   *
   *            net     parties/mois        régime réel        pire cas
   *   Accès    2,70 €  30 + 20  =  50      2,00 € → +0,70 €   4,00 € → −1,30 €
   *   Illimité 9,59 €  30 + 100 = 130      5,20 € → +4,39 €  10,40 € → −0,81 €
   *
   * ⚠ Il faut le dire franchement : le PIRE cas est désormais déficitaire.
   * Un abonné qui jouerait tous les jours ET brûlerait ses vingt essais à
   * chaque partie ET consommerait tous ses crédits coûterait plus qu'il ne
   * paie. Ce n'était plus tenable dès lors que le mot du jour est offert :
   * trente parties mensuelles gratuites mangent à elles seules 2,40 € au
   * pire, sur les 2,70 € que rapporte le forfait Accès.
   *
   * C'est un pari assumé sur le comportement réel, pas une garantie
   * arithmétique : au régime observé les deux forfaits gagnent de l'argent,
   * et personne ne joue au pire cas tous les jours d'un mois. Ce qui protège
   * la caisse n'est donc plus le calcul mais DAILY_API_BUDGET, le plafond
   * d'appels quotidiens — c'est lui qu'il faut surveiller, et le tableau de
   * bord admin affiche le rapport consommé/distribué pour ça.
   *
   * Si la moyenne réelle dépassait douze propositions par partie, il
   * faudrait revoir l'un des trois chiffres : le prix, le stock, ou le
   * nombre d'essais.
   *
   * Un duel coûte deux crédits à qui l'ouvre par invitation : il paie pour
   * lui et pour son invité, et deux joueurs, ce sont deux fois vingt
   * propositions. En file aléatoire, chacun paie le sien.
   */
  credits: {
    // Stock mensuel, par forfait. Rechargé à chaque échéance payée. Ce sont
    // des parties EN PLUS du mot du jour, qui n'est jamais décompté.
    perPlan: {
      access: Number(process.env.CREDITS_ACCESS || 20),
      unlimited: Number(process.env.CREDITS_UNLIMITED || 100),
    },
    /*
     * Ce que coûte chaque format de partie.
     *
     * Le mot du jour n'apparaît pas ici, et c'est le sujet : il est inclus,
     * il ne se tarife pas. Seules les parties qu'on ajoute se paient.
     */
    costArchive: Number(process.env.CREDIT_COST_ARCHIVE || 1),
    costDuel: Number(process.env.CREDIT_COST_DUEL || 1),

    /*
     * Les recharges — des parties achetées à l'unité, quand le stock du mois
     * est épuisé et qu'on ne veut pas attendre.
     *
     * Elles ne périment PAS, contrairement au stock mensuel : ce qui est
     * payé en plus est payé pour de bon. C'est la raison d'être de la
     * seconde poche (`credits_purchased`) — sans elle, la recharge mensuelle
     * écraserait le solde et effacerait ce qu'on vient de vendre. Facturer
     * puis effacer, c'est le litige assuré.
     *
     * Le prix à la partie est VOLONTAIREMENT plus élevé que dans
     * l'abonnement : 0,20 € l'unité pour dix, contre 0,10 € et moins au
     * forfait. Ce n'est pas une punition, c'est ce qu'un achat ponctuel
     * coûte vraiment à servir sans le lissage d'un abonnement — et
     * l'interface le dit en clair plutôt que de laisser quelqu'un empiler
     * les recharges là où passer à l'Illimité lui reviendrait moins cher.
     *
     * Les trois tailles restent bénéficiaires y compris au pire cas
     * (0,08 € la partie) : 10 parties coûtent au pire 0,80 € pour 1,71 €
     * nets encaissés. Ce sont elles qui compensent le pari pris sur le mot
     * du jour offert.
     */
    packs: [
      { key: 'p10', credits: 10, price: '1,99', cents: 199 },
      { key: 'p30', credits: 30, price: '4,99', cents: 499 },
      { key: 'p75', credits: 75, price: '9,99', cents: 999 },
    ],
    // Duel sur invitation : l'hôte règle l'addition entière, invité compris.
    costDuelInvite: Number(process.env.CREDIT_COST_DUEL_INVITE || 2),
    /*
     * Filet de sécurité : au-delà de ce délai sans recharge, on recharge
     * quand même un abonné actif. Sert aux comptes offerts à la main (qui
     * n'ont aucune échéance) et aux webhooks perdus. 32 jours et non 30 :
     * il ne doit jamais se déclencher AVANT le renouvellement normal, sinon
     * il distribuerait un second stock chaque mois.
     */
    rechargeAfterDays: Number(process.env.CREDIT_RECHARGE_DAYS || 32),
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

  /*
   * Plafond de dépense : nombre maximum d'appels Claude par jour (UTC).
   *
   * Au-delà, le jeu ne bascule plus sur un évaluateur de secours — il n'y en a
   * plus. Il REFUSE la proposition, sans consommer de chance et sans rien
   * enregistrer. L'ancien secours notait l'orthographe faute de savoir noter le
   * sens : il donnait 0 à « Platini » contre « Zidane » et 41 à « Gomis »
   * contre « Gomes », puis envoyait ces notes au classement.
   *
   * 7700 et non 3000 : le passage à Sonnet a divisé le coût par appel par 2,5.
   * À dépense quotidienne inchangée (~19,70 $ au plafond), le jeu encaisse deux
   * fois et demie plus de propositions avant de devoir dire non. C'est un
   * plafond, pas une facture : une journée calme ne coûte que ce qu'elle joue.
   */
  dailyApiBudget: Number(process.env.DAILY_API_BUDGET || 7700),

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
      access: process.env.PAYPAL_PLAN_ACCESS || '',
      unlimited: process.env.PAYPAL_PLAN_UNLIMITED || '',
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
      access: process.env.STRIPE_PRICE_ACCESS || '',
      unlimited: process.env.STRIPE_PRICE_UNLIMITED || '',
    },
  },

  /*
   * Tarifs affichés. Ils doivent correspondre aux prix créés chez Stripe et
   * aux plans PayPal ci-dessus : ce sont eux qui facturent, ces valeurs ne
   * servent qu'à l'affichage.
   *
   * Deux forfaits mensuels, et rien d'autre. L'annuel à 19,99 € a disparu :
   * avec un jeu devenu payant à l'entrée, un troisième prix sur la page
   * n'aidait pas à choisir, il faisait hésiter.
   */
  premium: {
    accessPrice: process.env.PREMIUM_PRICE_ACCESS || '2,99',
    unlimitedPrice: process.env.PREMIUM_PRICE_UNLIMITED || '9,99',
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
 * Le même pour tous depuis le passage aux crédits. La fonction est gardée
 * plutôt qu'inlinée partout : la règle a déjà changé une fois, elle
 * rechangera, et il vaut mieux qu'elle ait une adresse. L'argument `user`
 * n'est plus lu — il reste dans la signature pour que les vingt appels du
 * jeu n'aient pas à être touchés le jour où la règle redeviendra variable.
 */
/**
 * Cette adresse est-elle celle d'un administrateur ?
 *
 * La règle vit ici, dans le module qui porte déjà la liste, et non dans
 * `auth.js` qui se contente de l'appeler. Ce n'est pas un déplacement
 * gratuit : le grand livre des crédits a besoin de poser la même question,
 * et `credits.js` ne peut pas importer `auth.js` — celui-ci importe
 * `billing.js`, qui importe `credits.js`. Le cycle serait complet.
 *
 * `config.js` n'importe rien du jeu : c'est le seul endroit où cette règle
 * peut vivre sans être recopiée, et une règle d'accès recopiée est une
 * règle qui finit par diverger.
 */
export function isAdminEmail(email) {
  const adresse = String(email || '').trim().toLowerCase();
  return Boolean(adresse) && config.adminEmails.includes(adresse);
}

export function attemptsFor(_user) {
  return config.game.maxAttempts;
}

/** Stock mensuel de crédits d'un forfait. Formule inconnue = zéro crédit. */
export function creditsForPlan(planKey) {
  return config.credits.perPlan[planKey] || 0;
}
