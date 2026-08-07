import { db } from './db.js';
import { config, creditsForPlan, isAdminEmail } from './config.js';

/**
 * Le grand livre des crédits.
 *
 * Ce que compte ce module, ce sont les parties EN PLUS du rendez-vous
 * quotidien. Le joueur mystère du jour est inclus dans l'abonnement et ne
 * décompte rien : c'est ce qui fait revenir quelqu'un chaque matin, on ne
 * met pas un péage devant. Rejouer une journée d'archive ou lancer un duel,
 * en revanche, se paie — ce sont les parties qu'on ajoute.
 *
 * Le solde vit dans DEUX poches, et la distinction est la seule complexité
 * du module :
 *
 *   `credits`           le stock du mois. Remplacé à chaque échéance : un
 *                       abonnement n'est pas une cagnotte, ce qui n'a pas
 *                       été joué est perdu.
 *   `credits_purchased` les parties achetées à l'unité. Ne périment jamais.
 *
 * On dépense la première d'abord — vider ce qui expire avant ce qui reste,
 * c'est ne rien gâcher.
 *
 * Quatre principes tiennent le reste :
 *
 *   1. On débite à l'OUVERTURE d'une partie, jamais à chaque proposition.
 *      Un joueur doit savoir ce qu'une partie va lui coûter avant de la
 *      commencer, pas le découvrir en cours de route.
 *
 *   2. Une partie commencée est payée une seule fois. Le débit est attaché à
 *      la partie (`ref`), et rejouer la même journée après une déconnexion ne
 *      redébite rien.
 *
 *   3. Ce qui n'a pas été servi est remboursé. Si l'évaluateur tombe en panne
 *      ou si le duel ne démarre jamais, le crédit revient. Facturer une
 *      partie qui n'a pas eu lieu, c'est le genre de détail qui fait résilier.
 *
 *   4. Ce qui a été acheté ne s'efface pas. Une recharge payée survit à
 *      toutes les échéances suivantes.
 *
 * Chaque mouvement laisse une ligne dans `credit_events`. C'est ce qui permet
 * de répondre à « j'ai perdu des crédits sans jouer » autrement que par une
 * supposition.
 */

/* ------------------------------------------------------------------ *
 *  Lecture
 * ------------------------------------------------------------------ */

/**
 * La ligne du compte, vue par le grand livre.
 *
 * L'administrateur est corrigé au passage, exactement comme le fait
 * `findUserById` pour le reste du jeu : abonné à l'Illimité, sans rien
 * écrire en base.
 *
 * Sans cette correction, il franchirait le mur de paiement — ses droits
 * sont injectés en mémoire ailleurs — mais buterait ici sur un solde à
 * zéro, parce que ce module lit la base et que la base, elle, ne sait rien
 * de son statut. Il aurait lu « Plus de crédits » sur son propre site, à sa
 * première proposition. Celui qui paie l'API du jeu doit pouvoir y jouer.
 *
 * L'e-mail est relu ici plutôt que passé par l'appelant : les vingt points
 * d'entrée du module reçoivent un identifiant, pas un utilisateur, et une
 * règle d'accès qui dépend de qui appelle est une règle qu'on oublie
 * d'appliquer quelque part.
 */
function row(userId) {
  const u = db
    .prepare(
      `SELECT id, email, credits, credits_purchased, credits_renewed_at,
              credits_period_end, subscription_plan, is_subscriber, is_premium,
              premium_until
         FROM users WHERE id = ?`
    )
    .get(userId);

  if (!u) return u;
  if (!isAdminEmail(u.email)) return u;

  return {
    ...u,
    is_subscriber: 1,
    is_premium: 1,
    // Une formule inconnue ne sert aucun crédit : sans cette valeur par
    // défaut, l'administrateur serait rechargé de zéro tous les mois.
    subscription_plan: u.subscription_plan || 'unlimited',
  };
}

function journal(userId, delta, reason, ref, balance) {
  db.prepare(
    'INSERT INTO credit_events (user_id, delta, reason, ref, balance) VALUES (?, ?, ?, ?, ?)'
  ).run(userId, delta, reason, ref || null, balance);
}

/* ------------------------------------------------------------------ *
 *  Recharge
 * ------------------------------------------------------------------ */

/**
 * Recharge le stock d'un compte, si l'heure est venue.
 *
 * Appelée paresseusement à chaque lecture du solde : comme pour l'expiration
 * du premium, il n'y a aucune tâche planifiée à maintenir, et une base
 * restaurée d'une sauvegarde se remet d'aplomb dès la première requête.
 *
 * Deux déclencheurs, dans cet ordre :
 *
 *   — `rechargeOnRenewal` (appelée par le webhook de paiement) : la voie
 *     normale. L'échéance a avancé, donc une période a été payée, donc on
 *     sert le stock. C'est exact au jour près et ça ne dépend d'aucune horloge.
 *
 *   — le filet de sécurité ci-dessous : 32 jours sans recharge alors que
 *     l'abonnement est actif. Il rattrape les webhooks perdus et sert les
 *     comptes offerts à la main, qui n'ont pas d'échéance du tout. Trente-deux
 *     et non trente : il ne doit JAMAIS tomber avant le renouvellement
 *     normal, sinon il distribuerait un second stock tous les mois.
 *
 * Le stock est REMPLACÉ, pas additionné. Les crédits non consommés ne se
 * cumulent donc pas d'un mois sur l'autre — c'est un abonnement, pas une
 * cagnotte, et un report sans plafond finirait par autoriser un mois de jeu
 * gratuit financé par les mois où l'on n'a pas joué.
 */
export function ensureRecharge(userId) {
  const u = row(userId);
  if (!u) return null;
  if (!u.is_subscriber && !u.is_premium) return u;

  const stock = creditsForPlan(u.subscription_plan);
  if (stock <= 0) return u;

  const dernier = u.credits_renewed_at ? Date.parse(u.credits_renewed_at) : 0;
  const age = Date.now() - dernier;
  const limite = config.credits.rechargeAfterDays * 86_400_000;

  if (dernier && age < limite) return u;

  return grantMonthly(userId, dernier ? 'recharge-filet' : 'premiere-recharge');
}

/**
 * Sert le stock mensuel du forfait en cours.
 *
 * Le solde est écrasé, pas incrémenté : deux appels de suite laissent le même
 * solde qu'un seul. C'est ce qui rend l'opération sûre à rejouer, et les
 * webhooks se rejouent — Stripe réessaie pendant trois jours.
 */
export function grantMonthly(userId, reason = 'recharge') {
  const u = row(userId);
  if (!u) return null;

  const stock = creditsForPlan(u.subscription_plan);
  const delta = stock - u.credits;

  /*
   * Seule la poche MENSUELLE est écrasée. Les parties achetées à part ne
   * sont pas touchées : elles ont été payées en plus, elles ne périment
   * pas, et une recharge qui les emporterait ferait de nous des voleurs
   * une fois par mois.
   */
  db.prepare(
    `UPDATE users
        SET credits = ?,
            credits_renewed_at = datetime('now'),
            credits_period_end = ?
      WHERE id = ?`
  ).run(stock, u.premium_until || null, userId);

  journal(userId, delta, reason, u.subscription_plan, balanceOf(userId));
  return row(userId);
}

/**
 * Crédite des parties achetées à l'unité.
 *
 * Additif, et dans l'autre poche : c'est ce qui les fait survivre à la
 * recharge mensuelle. `ref` porte l'identifiant de la session de paiement,
 * ce qui rend l'opération sûre à rejouer — Stripe renvoie le même événement
 * plusieurs fois, et créditer deux fois un seul paiement se remarquerait
 * tôt ou tard du mauvais côté du compte.
 *
 * @returns {{ok: boolean, balance: number, credited: number}}
 */
export function grantPack(userId, credits, ref, reason = 'recharge-achetee') {
  if (!(credits > 0)) return { ok: false, balance: balanceOf(userId), credited: 0 };

  const dejaVu = db
    .prepare('SELECT 1 FROM credit_events WHERE user_id = ? AND ref = ? LIMIT 1')
    .get(userId, ref);

  if (dejaVu) return { ok: true, balance: balanceOf(userId), credited: 0, alreadyCredited: true };

  db.prepare('UPDATE users SET credits_purchased = credits_purchased + ? WHERE id = ?').run(
    credits,
    userId
  );

  const balance = balanceOf(userId);
  journal(userId, credits, reason, ref, balance);
  return { ok: true, balance, credited: credits };
}

/**
 * Recharge à l'occasion d'un renouvellement payé.
 *
 * Le signal est l'AVANCÉE de l'échéance, et pas le simple fait de recevoir un
 * webhook : un même événement rejoué porte la même échéance et ne rechargera
 * donc rien. C'est ce qui empêche un abonné de collectionner les stocks en
 * rejouant l'appel, sans avoir à tenir une table d'événements déjà vus.
 *
 * `avant` est l'échéance telle qu'elle était AVANT l'écriture de l'abonnement.
 */
export function rechargeOnRenewal(userId, avant) {
  const u = row(userId);
  if (!u) return null;
  if (!u.is_subscriber && !u.is_premium) return u;

  const apres = u.premium_until ? Date.parse(u.premium_until) : 0;
  const precedent = avant ? Date.parse(avant) : 0;

  // Première activation (aucune échéance connue) ou échéance repoussée :
  // dans les deux cas, une période vient d'être payée.
  const periodePayee = !u.credits_renewed_at || (apres && apres > precedent);
  if (!periodePayee) return u;

  return grantMonthly(userId, u.credits_renewed_at ? 'renouvellement' : 'souscription');
}

/**
 * Change de forfait : on sert immédiatement le stock du nouveau.
 *
 * Sans cela, un joueur qui passe à l'Illimité en cours de mois paierait tout
 * de suite et attendrait l'échéance suivante pour en voir la couleur. Il
 * annulerait, et il aurait raison.
 */
export function grantOnPlanChange(userId, ancienPlan) {
  const u = row(userId);
  if (!u) return null;
  if (u.subscription_plan === ancienPlan) return u;
  return grantMonthly(userId, 'changement-de-formule');
}

/* ------------------------------------------------------------------ *
 *  Dépense
 * ------------------------------------------------------------------ */

/**
 * Débite un compte, si le solde le permet.
 *
 * La lecture du solde et l'écriture tiennent dans un seul UPDATE conditionnel
 * (`WHERE credits + credits_purchased >= ?`) : c'est SQLite qui garantit
 * qu'on ne peut pas passer sous zéro, pas notre enchaînement d'instructions.
 * Deux propositions envoyées à la même seconde depuis deux onglets ne peuvent
 * donc pas dépenser deux fois la dernière partie.
 *
 * On puise D'ABORD dans le stock mensuel, et seulement ensuite dans les
 * parties achetées. L'ordre n'est pas indifférent : le stock mensuel périme
 * à l'échéance, les parties achetées non. Vider la poche qui expire en
 * premier, c'est ne rien gâcher — l'inverse aurait consommé ce que le joueur
 * a payé en plus pour laisser expirer ce qu'il avait déjà.
 *
 * @returns {{ok: boolean, balance: number, cost: number}}
 */
export function spend(userId, cost, reason, ref = null) {
  if (cost <= 0) return { ok: true, balance: balanceOf(userId), cost: 0 };

  ensureRecharge(userId);

  const res = db
    .prepare(
      `UPDATE users
          SET credits = MAX(0, credits - ?),
              credits_purchased = credits_purchased - MAX(0, ? - credits)
        WHERE id = ? AND credits + credits_purchased >= ?`
    )
    .run(cost, cost, userId, cost);

  const balance = balanceOf(userId);
  if (res.changes === 0) return { ok: false, balance, cost };

  journal(userId, -cost, reason, ref, balance);
  return { ok: true, balance, cost };
}

/**
 * Rend des crédits.
 *
 * Utilisé quand la partie payée n'a pas eu lieu : panne de l'évaluateur,
 * duel qui ne démarre jamais, adversaire introuvable. Le motif est journalisé
 * pour que le relevé raconte l'aller ET le retour, plutôt qu'un débit
 * mystérieusement suivi d'un crédit.
 */
export function refund(userId, amount, reason, ref = null) {
  if (amount <= 0) return balanceOf(userId);

  /*
   * Le remboursement va dans la poche qui NE PÉRIME PAS.
   *
   * On ne sait pas laquelle des deux avait payé — `spend` vide la mensuelle
   * en premier, mais elle pouvait être à sec. Plutôt que de tenir un
   * registre pour trancher, on rend dans la meilleure des deux : le doute
   * profite au joueur, et il ne peut rien créer au passage puisqu'on ne
   * rembourse jamais que ce qui a été prélevé.
   *
   * L'inverse — rendre dans la poche mensuelle — aurait pu faire expirer à
   * la fin du mois une partie achetée qu'on avait débitée par erreur.
   */
  db.prepare('UPDATE users SET credits_purchased = credits_purchased + ? WHERE id = ?').run(
    amount,
    userId
  );
  const balance = balanceOf(userId);
  journal(userId, amount, reason, ref, balance);
  return balance;
}

/**
 * Cette partie a-t-elle déjà été payée ?
 *
 * On regarde le SOLDE de la référence, pas la présence d'un débit. La
 * différence compte : une partie débitée puis remboursée (panne de
 * l'évaluateur, duel avorté) laisse deux lignes qui s'annulent, et elle doit
 * redevenir payante. Chercher « un débit existe-t-il ? » l'aurait offerte.
 *
 * Le journal reste ainsi intact — on n'efface jamais un mouvement pour
 * corriger le suivant. Un relevé où les lignes disparaissent ne prouve plus
 * rien, et c'est précisément le jour où un joueur conteste qu'on en a besoin.
 */
export function alreadyPaid(userId, ref) {
  const net = db
    .prepare('SELECT COALESCE(SUM(delta), 0) AS net FROM credit_events WHERE user_id = ? AND ref = ?')
    .get(userId, ref).net;
  return net < 0;
}

/**
 * Débite une partie UNE SEULE FOIS, quoi qu'il arrive ensuite.
 *
 * `ref` identifie la partie (« solo:2026-08-07 », « archive:2026-07-02 »,
 * « duel:<salon> »). Si elle est déjà payée, la fonction rend la main sans
 * rien prélever.
 *
 * C'est ce qui permet de recharger la page, de perdre la connexion, ou de
 * reprendre une partie entamée hier sans repayer. Le contrôle vit ici et non
 * dans chaque route : c'est la même règle pour tous les formats de partie.
 */
export function spendOnce(userId, cost, reason, ref) {
  if (alreadyPaid(userId, ref)) {
    return { ok: true, balance: balanceOf(userId), cost: 0, alreadyPaid: true };
  }
  return spend(userId, cost, reason, ref);
}

/** Le solde total : stock du mois + parties achetées. */
export function balanceOf(userId) {
  const u = db
    .prepare('SELECT credits, credits_purchased FROM users WHERE id = ?')
    .get(userId);
  return (u?.credits ?? 0) + (u?.credits_purchased ?? 0);
}

/* ------------------------------------------------------------------ *
 *  Ce que le client affiche
 * ------------------------------------------------------------------ */

/**
 * Résumé du portefeuille, pour l'interface.
 *
 * La recharge est vérifiée au passage : le joueur qui ouvre le jeu le jour de
 * son renouvellement voit son stock plein sans avoir à jouer d'abord pour le
 * déclencher.
 */
export function creditSummary(userId) {
  const u = ensureRecharge(userId);
  if (!u) return null;

  return {
    balance: u.credits + u.credits_purchased,
    // Le détail des deux poches : l'une périme à l'échéance, l'autre non, et
    // le relevé doit pouvoir le dire plutôt que de laisser croire que tout
    // disparaîtra le 1er du mois.
    fromPlan: u.credits,
    purchased: u.credits_purchased,
    monthly: creditsForPlan(u.subscription_plan),
    plan: u.subscription_plan || null,
    /*
     * Ce que coûte chaque format, pour que l'interface annonce le prix avant
     * le clic plutôt que d'ouvrir une partie qui sera refusée.
     *
     * Le mot du jour n'y figure pas : il est inclus dans l'abonnement et ne
     * décompte rien. C'est la promesse principale de l'offre, elle a sa
     * propre clé pour que l'écran puisse l'annoncer sans la déduire d'une
     * absence.
     */
    dailyIncluded: true,
    costs: {
      archive: config.credits.costArchive,
      duel: config.credits.costDuel,
      duelInvite: config.credits.costDuelInvite,
    },
    // Date de la prochaine recharge. Nulle pour un compte offert à la main :
    // il n'a pas d'échéance, son filet de sécurité tombe tous les 32 jours.
    nextRecharge: u.credits_period_end || null,
    renewedAt: u.credits_renewed_at || null,
  };
}

/** Les derniers mouvements, pour le profil. */
export function creditHistory(userId, limit = 30) {
  return db
    .prepare(
      `SELECT delta, reason, ref, balance, created_at AS createdAt
         FROM credit_events WHERE user_id = ? ORDER BY id DESC LIMIT ?`
    )
    .all(userId, limit);
}
