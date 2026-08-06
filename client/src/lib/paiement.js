import { api } from './api.js';

/**
 * Paiement rapide : Apple Pay, Google Pay, carte.
 *
 * Deux encaisseurs, deux chemins, une seule fonction ici pour que les pages
 * n'aient pas à connaître la différence.
 *
 *   — Stripe ouvre une page de paiement qui affiche Apple Pay ou Google Pay
 *     EN HAUT dès que le téléphone les propose. C'est le chemin le plus
 *     court : deux secondes, une empreinte, aucun clavier. Sur téléphone,
 *     saisir seize chiffres de carte est l'endroit exact où l'on abandonne.
 *   — PayPal reste proposé pour ceux qui ont un compte et n'ont rien à
 *     ressaisir non plus.
 *
 * Aucune donnée bancaire ne transite par le jeu : on quitte le site vers la
 * page de l'encaisseur, et le retour est vérifié côté serveur.
 */

/**
 * Quel portefeuille ce téléphone propose-t-il, probablement ?
 *
 * « Probablement », parce qu'aucune détection n'est certaine sans charger
 * le SDK de Stripe — ce qu'on évite : c'est un script tiers de plusieurs
 * centaines de kilo-octets sur toutes les pages, pour habiller un bouton.
 * La conséquence d'une erreur est minuscule : un libellé un peu générique.
 * Le paiement, lui, fonctionne dans tous les cas.
 */
export function portefeuille() {
  if (typeof window === 'undefined') return null;

  try {
    // Apple ne ment pas : l'objet n'existe que là où Apple Pay existe.
    if (window.ApplePaySession?.canMakePayments?.()) return 'apple';
  } catch {
    /* contexte non sécurisé ou iframe : on retombe sur l'agent utilisateur */
  }

  const ua = navigator.userAgent || '';
  if (/iPhone|iPad|iPod/.test(ua)) return 'apple';
  if (/Android/.test(ua)) return 'google';
  return null;
}

/** Le libellé du bouton principal, selon le téléphone qu'on tient. */
export function libellePaiement(kind = portefeuille()) {
  if (kind === 'apple') return 'Payer avec Apple Pay';
  if (kind === 'google') return 'Payer avec Google Pay';
  return 'Payer par carte';
}

/** La ligne d'explication sous le bouton : elle dit tout ce qui est accepté. */
export function detailPaiement(kind = portefeuille()) {
  if (kind === 'apple') return 'Apple Pay, carte bancaire — sans créer de compte';
  if (kind === 'google') return 'Google Pay, carte bancaire — sans créer de compte';
  return 'Carte bancaire, Apple Pay et Google Pay — sans créer de compte';
}

/**
 * Ouvre le paiement d'un don et quitte le site.
 *
 * Ne renvoie rien en cas de succès : la page est déjà partie. Les erreurs
 * remontent à l'appelant, qui sait comment les afficher.
 */
export async function ouvrirDon(montant, moyen = 'stripe') {
  if (moyen === 'paypal') {
    const { data } = await api.post('/donate', { amount: montant });
    window.location.href = data.approveUrl;
    return;
  }

  const { data } = await api.post('/stripe/donate', { amount: montant });
  window.location.href = data.url;
}
