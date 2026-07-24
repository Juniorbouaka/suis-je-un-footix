/**
 * Génère des secrets JWT solides.
 * Usage : npm run secrets
 *
 * Les valeurs livrées dans .env.example sont des placeholders : en ligne, elles
 * permettraient à quiconque les lit de fabriquer un jeton valide et de se
 * connecter sous n'importe quelle identité. À remplacer avant tout déploiement.
 */
import crypto from 'node:crypto';

const secret = () => crypto.randomBytes(48).toString('base64url');

console.log(`
Copie ces deux lignes dans les variables d'environnement de ton hébergeur
(ou dans server/.env en local). Ne les partage jamais, ne les committe jamais.

JWT_SECRET=${secret()}
JWT_REFRESH_SECRET=${secret()}
`);
