import { db } from './db.js';
import { config } from './config.js';

/**
 * L'essai gratuit.
 *
 * Le jeu est payant à l'entrée depuis la bascule tarifaire, et ce mur pose
 * un problème que le chiffre d'affaires ne montre pas : personne ne devient
 * accro à un jeu qu'il n'a jamais joué. On demandait 2,99 € pour une chose
 * dont le visiteur ne pouvait rien savoir — ni si la jauge est juste, ni si
 * chercher un joueur par mots-clés l'amuse. C'est beaucoup demander à
 * quelqu'un qui vient de cliquer sur un lien.
 *
 * L'essai ouvre donc HUIT CHANCES, une fois, sur le joueur mystère du jour.
 * Après quoi le mur se referme et l'abonnement est proposé.
 *
 * ── Pourquoi huit, et pourquoi des chances et non des parties ──────────
 *
 * Huit propositions, c'est la moitié d'une partie type (une partie trouvée
 * en tourne autour de dix). Assez pour que la jauge se soit exprimée
 * plusieurs fois, pour comprendre la mécanique et pour voir le score
 * monter ; pas assez pour finir. On s'arrête donc au moment précis où le
 * joueur veut continuer — c'est là qu'on vend, pas après une partie
 * terminée qui a déjà refermé la boucle.
 *
 * Des chances plutôt que des parties, parce qu'une partie entière offerte
 * coûte jusqu'à 0,08 € d'API et se termine sur une réponse : le visiteur
 * repart en sachant qui était le joueur du jour, satisfait, sans rien
 * devoir. Huit chances coûtent au pire 0,032 € et laissent la question
 * ouverte.
 *
 * ── Ce que l'essai NE donne PAS ────────────────────────────────────────
 *
 * Ni archives, ni duels : ce sont les parties qui se paient en crédits, et
 * les ouvrir gratuitement ferait deux portes dérobées dans la caisse. Un
 * duel coûte en plus deux fois vingt propositions et occupe un adversaire
 * abonné, qui n'a pas à servir de démonstration.
 *
 * ── Sa limite, dite franchement ────────────────────────────────────────
 *
 * Le compteur est attaché au COMPTE, et un compte est gratuit : rien
 * n'empêche de se réinscrire pour huit chances de plus. C'est vrai de tous
 * les essais du monde et ça se contrôlerait au prix d'une empreinte
 * d'appareil ou d'une vérification d'e-mail — deux frictions posées à
 * l'inscription, c'est-à-dire à l'endroit exact où l'on perd les gens. Le
 * plafond de dépense quotidien (DAILY_API_BUDGET) protège déjà la caisse
 * contre l'abus en volume ; c'est lui qui tient, pas ce compteur.
 */

/** Le nombre de chances offertes, l'essai n'ayant qu'un seul réglage. */
export function trialTotal() {
  return Math.max(0, config.game.trialGuesses);
}

/**
 * Où en est l'essai de ce compte ?
 *
 * Lu depuis l'utilisateur déjà chargé, sans requête : toute route
 * authentifiée dispose de `req.user`, et l'essai est consulté à chaque
 * proposition.
 *
 * `active` distingue « l'essai court » de « il n'a plus lieu d'être » : un
 * abonné a un compteur d'essai comme tout le monde — il en a peut-être
 * consommé avant de payer — mais l'écran ne doit plus en parler. Les deux
 * questions ne se posent pas au même moment et méritent deux clés.
 */
export function trialState(user) {
  const total = trialTotal();
  const used = Math.min(total, Math.max(0, user?.trial_guesses_used ?? 0));
  const remaining = Math.max(0, total - used);
  const paye = Boolean(user?.is_subscriber || user?.is_premium);

  return {
    total,
    used,
    remaining,
    // L'essai est en cours : il reste des chances ET rien n'a été payé.
    active: !paye && remaining > 0,
    // L'essai est allé jusqu'au bout : c'est le moment de vendre.
    exhausted: !paye && remaining <= 0,
  };
}

/**
 * Ce compte a-t-il le droit de jouer la partie du jour ?
 *
 * L'abonnement OU l'essai. C'est la seule question que posent les trois
 * routes du mot du jour, et elle ne doit avoir qu'une réponse : deux tests
 * séparés (« est-il abonné ? » ici, « lui reste-t-il un essai ? » là)
 * finissent toujours par diverger sur une route ajoutée plus tard.
 */
export function canPlayDaily(user) {
  return Boolean(user?.is_subscriber || user?.is_premium) || trialState(user).remaining > 0;
}

/**
 * Consomme une chance d'essai, et rend l'état qui suit.
 *
 * Appelée APRÈS l'évaluation, jamais avant : une proposition que
 * l'évaluateur a refusé de noter n'a rien montré au visiteur, elle n'a donc
 * pas à lui coûter une de ses huit chances. C'est le même principe que le
 * non-débit des crédits sur panne, et c'est le seul ordre défendable — on
 * ne facture pas un service qu'on n'a pas rendu, fût-il gratuit.
 *
 * Le plafond vit dans le `WHERE` : deux propositions envoyées à la même
 * seconde depuis deux onglets ne peuvent pas franchir la huitième. C'est
 * SQLite qui garantit le compte, pas notre enchaînement d'instructions.
 *
 * Aucun filtre sur `is_subscriber` ici, délibérément : l'administrateur a
 * ses droits injectés en mémoire par `findUserById` et la base, elle, le
 * voit toujours comme non-abonné. Un garde-fou lu en base lui grignoterait
 * un compteur d'essai qu'il n'utilise pas. C'est l'appelant qui sait s'il
 * a affaire à un compte payant — et il ne nous appelle que sinon.
 */
export function consumeTrial(userId) {
  db.prepare(
    `UPDATE users
        SET trial_guesses_used = trial_guesses_used + 1
      WHERE id = ? AND trial_guesses_used < ?`
  ).run(userId, trialTotal());

  const row = db
    .prepare('SELECT trial_guesses_used, is_subscriber, is_premium FROM users WHERE id = ?')
    .get(userId);

  return trialState(row);
}
