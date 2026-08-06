import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { db } from '../db.js';
import { config } from '../config.js';
import { verifyAccessToken } from '../auth.js';
import { mur, validerNom } from '../supporters.js';
import {
  captureOrder,
  createDonationOrder,
  getOrder,
  paypalEnabled,
} from '../paypal.js';
import { stripeUsable } from '../stripe.js';

export const donateRouter = Router();

/**
 * Les dons.
 *
 * Aucun compte n'est nécessaire : un visiteur de passage doit pouvoir
 * soutenir le jeu sans s'inscrire. Si le donateur se trouve connecté, on
 * rattache le don à son compte, mais ce n'est jamais exigé.
 *
 * Le montant est décidé et vérifié ICI. Le client propose, le serveur
 * dispose : sans cette borne, n'importe qui pourrait forger une commande
 * à 0,01 € — ou à 10 000 €.
 */

const limiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 12,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
});

/** Normalise un montant en chaîne à deux décimales, ou renvoie null. */
function montantValide(brut) {
  const n = Number(brut);
  if (!Number.isFinite(n)) return null;
  const arrondi = Math.round(n * 100) / 100;
  if (arrondi < config.donations.min || arrondi > config.donations.max) return null;
  return arrondi.toFixed(2);
}

/** Identifie le donateur s'il se trouve connecté. Jamais obligatoire. */
function donateurEventuel(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return null;
  const payload = verifyAccessToken(header.slice(7));
  return payload?.sub || null;
}

/* -------------------------------------------------------------- *
 *  GET /api/donate/options — les montants proposés
 * -------------------------------------------------------------- */

donateRouter.get('/options', (req, res) => {
  res.json({
    // Vrai dès qu'UN encaisseur sait prendre l'argent : le client n'a pas
    // à connaître le détail pour décider s'il affiche la page.
    enabled: paypalEnabled || stripeUsable(),
    providers: {
      paypal: paypalEnabled,
      /*
       * Stripe porte le paiement rapide : Apple Pay, Google Pay et carte.
       * `stripeUsable` et non `stripeEnabled` : une clé refusée retire le
       * bouton au lieu de mener à une erreur rouge. Mieux vaut un moyen de
       * paiement en moins qu'un moyen de paiement qui échoue.
       */
      stripe: stripeUsable(),
    },
    currency: 'EUR',
    amounts: config.donations.amounts,
    min: config.donations.min,
    max: config.donations.max,
    externalUrl: config.donateUrl || null,
  });
});

/* -------------------------------------------------------------- *
 *  POST /api/donate — ouvre une commande PayPal
 * -------------------------------------------------------------- */

donateRouter.post('/', limiter, async (req, res) => {
  if (!paypalEnabled) {
    return res.status(503).json({ error: 'Les dons ne sont pas encore ouverts.' });
  }

  const amount = montantValide(req.body?.amount);
  if (!amount) {
    return res.status(400).json({
      error: `Montant invalide : entre ${config.donations.min} et ${config.donations.max} €.`,
    });
  }

  try {
    const { id, approveUrl } = await createDonationOrder({
      amount,
      returnUrl: `${config.publicUrl}/soutenir/merci`,
      cancelUrl: `${config.publicUrl}/soutenir?annule=1`,
    });

    db.prepare(
      'INSERT INTO donations (order_id, user_id, amount, status) VALUES (?, ?, ?, ?)'
    ).run(id, donateurEventuel(req), amount, 'CREATED');

    res.json({ orderId: id, approveUrl });
  } catch (err) {
    console.error('[dons] création de commande :', err.message);
    res.status(502).json({ error: "PayPal n'a pas pu ouvrir le paiement. Réessaie." });
  }
});

/* -------------------------------------------------------------- *
 *  POST /api/donate/capture — encaisse au retour de PayPal
 * -------------------------------------------------------------- */

donateRouter.post('/capture', limiter, async (req, res) => {
  const orderId = String(req.body?.orderId || '').trim();
  if (!orderId) return res.status(400).json({ error: 'Commande manquante.' });

  const connu = db.prepare('SELECT * FROM donations WHERE order_id = ?').get(orderId);
  if (!connu) {
    // La commande doit venir de chez nous : on refuse d'encaisser une
    // référence arbitraire fournie par le client.
    return res.status(404).json({ error: 'Commande inconnue.' });
  }

  // Rechargement de la page de retour : on ne rejoue pas l'encaissement.
  if (connu.status === 'COMPLETED') {
    return res.json({ status: 'COMPLETED', amount: connu.amount, currency: connu.currency });
  }

  try {
    const resultat = await captureOrder(orderId);

    db.prepare(
      "UPDATE donations SET status = ?, captured_at = datetime('now') WHERE order_id = ?"
    ).run(resultat.status, orderId);

    res.json({ status: resultat.status, amount: connu.amount, currency: connu.currency });
  } catch (err) {
    // PayPal refuse la capture d'une commande déjà encaissée : on relit son
    // état réel plutôt que de renvoyer une erreur au donateur.
    try {
      const reel = await getOrder(orderId);
      if (reel.status === 'COMPLETED') {
        db.prepare(
          "UPDATE donations SET status = 'COMPLETED', captured_at = datetime('now') WHERE order_id = ?"
        ).run(orderId);
        return res.json({ status: 'COMPLETED', amount: connu.amount, currency: connu.currency });
      }
    } catch {
      /* on retombe sur l'erreur ci-dessous */
    }

    console.error('[dons] encaissement :', err.message);
    res.status(502).json({ error: "Le paiement n'a pas pu être finalisé." });
  }
});

/* -------------------------------------------------------------- *
 *  GET /api/donate/stats — compteur public de soutiens
 * -------------------------------------------------------------- */

donateRouter.get('/stats', (req, res) => {
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM donations WHERE status = 'COMPLETED'")
    .get();
  // On publie le nombre de soutiens, jamais les montants ni les donateurs.
  res.json({ supporters: row.n });
});

/* -------------------------------------------------------------- *
 *  GET /api/donate/wall — le mur des soutiens
 * -------------------------------------------------------------- */

donateRouter.get('/wall', (req, res) => {
  res.json({ names: mur() });
});

/* -------------------------------------------------------------- *
 *  POST /api/donate/:orderId/name — signer le mur
 *
 *  L'identifiant de commande fait office de preuve : seul celui qui
 *  revient de PayPal le connaît. Le nom ne peut être posé qu'une fois,
 *  pour qu'on ne puisse pas réécrire le mur indéfiniment.
 * -------------------------------------------------------------- */

donateRouter.post('/:orderId/name', limiter, (req, res) => {
  const orderId = String(req.params.orderId || '').trim();
  const don = db.prepare('SELECT * FROM donations WHERE order_id = ?').get(orderId);

  if (!don) return res.status(404).json({ error: 'Don introuvable.' });
  if (don.status !== 'COMPLETED') {
    return res.status(409).json({ error: "Ce don n'est pas encore encaissé." });
  }
  if (don.display_name) {
    return res.status(409).json({ error: 'Ce don a déjà signé le mur.' });
  }

  // Publication expressément demandée : par défaut, un don reste anonyme.
  const public_ = req.body?.public === true;
  if (!public_) {
    db.prepare('UPDATE donations SET is_public = 0 WHERE order_id = ?').run(orderId);
    return res.json({ ok: true, published: false });
  }

  const check = validerNom(req.body?.name);
  if (!check.ok) return res.status(400).json({ error: check.error });

  db.prepare('UPDATE donations SET display_name = ?, is_public = 1 WHERE order_id = ?').run(
    check.nom,
    orderId
  );

  res.json({ ok: true, published: true, name: check.nom });
});
