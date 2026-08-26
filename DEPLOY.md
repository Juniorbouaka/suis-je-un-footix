# Mettre « Suis-je un footix ? » en ligne

Guide pas à pas. Compte 30 à 45 minutes la première fois.

> **Rien à installer pour la base de données.** SQLite est intégré à Node.js 22.5+
> (module `node:sqlite`). La base est un simple fichier créé automatiquement.
> Ne télécharge rien depuis sqlite.org.

---

## 1. Générer les secrets

```bash
cd server
npm run secrets
```

Garde les deux lignes affichées sous la main : elles vont dans les variables
d'environnement de l'hébergeur à l'étape 4.

Le serveur **refuse de démarrer** en production avec les secrets de la démo — c'est
volontaire : avec eux, n'importe qui pourrait forger un jeton et se connecter sous
l'identité d'un autre joueur.

---

## 2. Vérifier que tout est vert en local

```bash
# depuis la racine du projet
npm run check:bank        # la base de joueurs est valide
npm run build             # le front compile
npm start                 # le serveur sert l'API ET le front
```

Ouvre http://localhost:4000 : tu dois avoir le jeu complet sur une seule URL,
sans lancer Vite. C'est exactement ce qui tournera en ligne.

---

## 3. Pousser le code sur GitHub

```bash
git init
git add .
git commit -m "Suis-je un footix ?"
git branch -M main
git remote add origin https://github.com/<toi>/suis-je-un-footix.git
git push -u origin main
```

Le `.gitignore` exclut déjà `.env`, `node_modules/` et `server/data/` : ni ta clé
API ni ta base ne partent sur GitHub. Vérifie-le avant de pousser :

```bash
git status --short | grep -E "\.env$|footix\.db"   # ne doit rien afficher
```

---

## 4. Déployer sur Railway

1. **railway.app** → *New Project* → *Deploy from GitHub repo* → choisis ton dépôt.
   Railway détecte le `Dockerfile` et construit tout seul.

2. **Créer le volume** — c'est l'étape à ne pas rater.
   Onglet *Variables* du service → *+ New Volume* :
   - Mount path : `/data`
   - Taille : 1 Go suffit largement

   Sans volume, la base est effacée à chaque redéploiement : comptes, scores,
   séries et cache repartent de zéro.

3. **Renseigner les variables** (onglet *Variables*), en reprenant
   `server/.env.production.example` :

   | Variable | Valeur |
   |---|---|
   | `NODE_ENV` | `production` |
   | `JWT_SECRET` | celui généré à l'étape 1 |
   | `JWT_REFRESH_SECRET` | celui généré à l'étape 1 |
   | `ANTHROPIC_API_KEY` | ta clé `sk-ant-…` |
   | `CLAUDE_MODEL` | `claude-opus-4-8` |
   | `DAILY_API_BUDGET` | `3000` |
   | `DATABASE_FILE` | `/data/footix.db` |
   | `CLIENT_ORIGIN` | *(vide)* |
   | `PUBLIC_URL` | `https://ton-domaine.up.railway.app` |
   | `RESEND_API_KEY` | ta clé Resend (voir ci-dessous) |
   | `ADMIN_EMAILS` | ton adresse : ouvre `/admin` **et** donne l'accès complet, sans abonnement |
   | `MAX_ATTEMPTS` | `20` |
   | `MAX_ATTEMPTS_PVP` | `20` |
   | `CREDITS_ACCESS` | `20` |
   | `CREDITS_UNLIMITED` | `100` |
   | `TRIAL_GUESSES` | `8` — l'essai gratuit, en chances offertes sur le joueur du jour |
   | `TRIAL_DUELS` | `1` — le duel offert, en parties entières, une fois par compte |
   | `SALES_EMAIL` | *(vide)* — où arrivent les alertes de vente ; vide = `ADMIN_EMAILS` |

   Ne touche pas à `PORT` : Railway l'injecte.

   ⚠️ **Le jeu est passé à l'abonnement obligatoire, et les variables ont changé avec lui.**
   Une variable déjà posée sur Railway **écrase** la valeur du code : celles d'avant doivent
   être supprimées, sinon elles continuent de s'appliquer. À retirer —
   `MAX_ATTEMPTS_FREE`, `MAX_ATTEMPTS_PREMIUM`, `MAX_DUELS_FREE`, `MAX_DUELS_PREMIUM`,
   `MAX_GAMES_PREMIUM` : les quotas journaliers n'existent plus, les crédits les remplacent.
   (`MAX_ATTEMPTS_FREE` est encore relue en second recours par `MAX_ATTEMPTS`, donc une valeur
   traînante y reste sans danger — les quatre autres n'ont plus aucun effet.)

   `TRIAL_GUESSES` ouvre le jeu à qui n'a pas encore payé : **huit chances**, une fois par
   compte, sur le joueur du jour uniquement — les archives se paient en crédits. C'est ce qui
   remplace le mur payant sec, devant lequel on demandait 2,99 € à quelqu'un qui n'avait jamais
   vu la jauge répondre. `0` referme le jeu comme avant. Le coût est borné : au pire ~0,032 €
   par compte créé, une seule fois, et plafonné par `DAILY_API_BUDGET`.

   `TRIAL_DUELS` fait la même chose pour le duel : **une partie entière**, une fois par compte.
   Entière et non tronquée, parce qu'on ne coupe pas une partie à deux au milieu sans priver
   l'adversaire de la sienne, qu'il a payée. C'est le mode qui fait revenir — on s'abonne parce
   qu'un ami vous a mis une raclée — et c'était le seul qu'on vendait sans jamais le laisser
   voir. Il paie **le siège de son joueur** : la file aléatoire, jamais une invitation, qui en
   coûte deux puisqu'elle offre la partie d'un tiers. Coût borné à ~0,08 € par compte créé,
   plafonné lui aussi par `DAILY_API_BUDGET`. `0` referme les duels aux abonnés comme avant.

   Les deux compteurs sont **indépendants** : celui qui a brûlé ses huit chances garde son duel.
   Et comme tous les essais du monde, ils sont attachés au compte — un compte est gratuit, rien
   n'empêche de se réinscrire. C'est `DAILY_API_BUDGET` qui protège la caisse, pas eux.

   ⚠️ **`RESEND_API_KEY` n'est plus seulement pour les mots de passe oubliés.** C'est elle qui
   fait partir l'**alerte de vente** — un e-mail à chaque abonnement, renouvellement, changement
   de formule, recharge et don. Sans elle, l'alerte n'est écrite que dans les logs de Railway,
   et l'on continue de ne pas savoir qu'on a vendu.

   `CREDITS_ACCESS` et `CREDITS_UNLIMITED` sont les parties **supplémentaires** servies chaque
   mois. Le joueur du jour, lui, est compris dans les deux formules et ne décompte rien : ce
   sont les archives rejouées et les duels qui coûtent une partie (une invitation en coûte deux
   à celui qui l'envoie, puisqu'il offre celle de son invité). Le stock est **remplacé** à
   chaque échéance payée, jamais additionné — sauf les parties achetées à l'unité, qui vivent
   dans une seconde colonne et ne périment jamais.

   ⚠️ Ces deux chiffres décident de la marge, et depuis que le mot du jour est offert le pire
   cas est déficitaire : un abonné qui jouerait tous les jours en brûlant ses vingt essais
   coûterait plus qu'il ne paie. C'est un pari assumé sur le comportement réel — voir le calcul
   complet dans le README. Les augmenter sans toucher aux prix creuse directement ce pari, et
   c'est `DAILY_API_BUDGET` qui sert de vrai garde-fou. La valeur affichée sur la page d'offre
   suit automatiquement.

4. **Générer le domaine** — onglet *Settings* → *Networking* → *Generate Domain*.
   Tu obtiens une URL en `.up.railway.app`.

5. **Vérifier** — ouvre `https://ton-domaine/api/health` :

   ```json
   { "ok": true, "engine": "claude", "model": "claude-opus-4-8", "budget": { "used": 0 } }
   ```

   Si `engine` vaut `fallback`, la clé API n'est pas passée.

---

### Les e-mails

Sans fournisseur, **personne ne peut récupérer son mot de passe** : le lien
part uniquement dans les logs du serveur. Crée un compte sur **resend.com**
(gratuit jusqu'à 3000 e-mails par mois), génère une clé API, renseigne
`RESEND_API_KEY`.

Tant que tu n'as pas de domaine à toi, laisse `MAIL_FROM` sur l'adresse de test
`onboarding@resend.dev`. Avec ton propre domaine, vérifie-le chez Resend puis
utilise une adresse de ce domaine, sinon tes e-mails finiront en indésirables.

`PUBLIC_URL` est indispensable : c'est elle qui compose le lien du message.
Mal renseignée, les joueurs recevront un lien vers `localhost`.

---

## Alternative : Fly.io

```bash
fly launch --no-deploy          # reprend le fly.toml du dépôt
fly volumes create footix_data --size 1
fly secrets set JWT_SECRET=… JWT_REFRESH_SECRET=… ANTHROPIC_API_KEY=…
fly deploy
```

---

## 5. Après le lancement

**Les sauvegardes sont automatiques.** Le serveur écrit une copie cohérente de
la base (via `VACUUM INTO`, sûr même sous charge) au démarrage puis toutes les
24 h, dans `<volume>/backups`. Les 7 dernières sont conservées, réglable avec
`BACKUP_KEEP`.

Elles vivent sur le même volume que la base : elles te protègent d'une erreur
de manipulation ou d'une corruption, pas d'une perte du volume. Pour une vraie
sécurité, récupère-en une de temps en temps :

```bash
railway run cat /data/backups/footix-2026-07-24T12-00-00.db > sauvegarde.db
```

Sauvegarde manuelle immédiate : `npm run backup`.

**Surveiller la dépense.** Le tableau de bord Anthropic donne la consommation
réelle. En complément, `/api/health` expose le compteur du jour :

```json
"budget": { "used": 412, "limit": 3000, "remaining": 2588, "exhausted": false }
```

**Un seul conteneur.** Le matchmaking et l'état des duels vivent en mémoire.
Passer à plusieurs instances casserait les parties en cours : il faudrait
d'abord brancher l'adaptateur Redis de Socket.io. `numReplicas = 1` est donc
volontaire dans `railway.toml`.

---

## Ce qui reste à faire de ton côté

| Sujet | Pourquoi ce n'est pas fait |
|---|---|
| **CMP de consentement** | Diffuser de la pub personnalisée en Europe exige une CMP certifiée IAB TCF v2.2 (Google, Axeptio, Didomi, Sirdata). Mon bandeau est une structure d'accueil, pas un outil conforme. |
| **Mentions légales et politique de confidentialité** | Obligatoires dès la collecte d'e-mails. Contenu juridique propre à ton statut. |
| **Clés Stripe** | Le code est branché (abonnement, dons, webhook), mais tant que `STRIPE_SECRET_KEY` est vide il reste muet : ni carte, ni Apple Pay, ni Google Pay. Voir ci-dessous. |
| **Nom de domaine** | Optionnel. Railway et Fly.io fournissent une URL utilisable telle quelle. |
| **Vérification d'e-mail à l'inscription** | Les adresses ne sont pas validées : quelqu'un peut s'inscrire avec une adresse inventée. Petit ajout une fois Resend en place. |

---

## Paiement rapide : Apple Pay et Google Pay

Ils passent par **Stripe Checkout**, pour l'abonnement comme pour les dons. Rien à héberger ni à
déclarer : la page de paiement est celle de Stripe, donc le domaine Apple Pay est le sien. Les
portefeuilles s'affichent en boutons express, tout en haut, dès que le téléphone les propose —
deux secondes et une empreinte digitale, là où saisir seize chiffres au pouce est l'endroit exact
où l'on renonce.

```bash
cd server
# 1. Poser STRIPE_SECRET_KEY (sk_test_… pour essayer, sk_live_… pour encaisser)
#    PUBLIC_URL doit deja pointer sur le domaine HTTPS : le script y declare le webhook.
railway run npm run stripe:setup   # produit, deux prix, webhook — affiche tout
# 2. Recopier STRIPE_PRICE_ACCESS, STRIPE_PRICE_UNLIMITED et STRIPE_WEBHOOK_SECRET
```

Le secret du webhook n'est visible **qu'à sa création**. S'il est perdu, supprime le point de
terminaison dans le tableau de bord Stripe et relance le script.

| Variable | Rôle |
|---|---|
| `STRIPE_SECRET_KEY` | vide = aucun paiement par carte ni portefeuille ; PayPal reprend la place du bouton principal |
| `STRIPE_PRICE_ACCESS` · `STRIPE_PRICE_UNLIMITED` | les deux forfaits ; les dons n'en ont pas besoin |
| `STRIPE_WEBHOOK_SECRET` | sans lui, **tous** les webhooks sont refusés — un webhook non vérifié laisserait n'importe qui s'offrir un abonnement |

⚠️ Les anciens prix (`STRIPE_PRICE_MONTHLY`, `STRIPE_PRICE_YEARLY`) ne sont plus lus. Tant que
les deux nouveaux ne sont pas posés, l'offre s'affiche « indisponible » côté carte et seul
PayPal — s'il est configuré — peut encore vendre. **Le jeu étant fermé aux non-abonnés, une
offre indisponible ferme le jeu à tout le monde :** c'est la première chose à vérifier après
le déploiement.

Il n'y a pas deux environnements séparés comme chez PayPal : c'est la clé qui décide.
`sk_test_…` ne touche à rien de réel, `sk_live_…` encaisse. Les identifiants de prix créés avec
une clé de test n'existent pas en production, donc le script est à rejouer au passage en live.

Vérifier que les portefeuilles sont bien actifs : *Settings → Payments → Payment methods* dans le
tableau de bord Stripe. Apple Pay et Google Pay y sont activés par défaut.

---

## Dépannage

| Symptôme | Cause probable |
|---|---|
| Le serveur refuse de démarrer, message sur les secrets | `JWT_SECRET` / `JWT_REFRESH_SECRET` absents ou encore ceux de la démo |
| `engine: "fallback"` dans `/api/health` | `ANTHROPIC_API_KEY` non renseignée côté hébergeur |
| Comptes perdus après un déploiement | Volume non monté, ou `DATABASE_FILE` ne pointe pas dessus |
| Le duel ne démarre jamais | WebSockets bloqués par l'hébergeur, ou plusieurs instances lancées |
| Page blanche, API qui répond | Front non compilé : `npm run build` avant le démarrage (le Dockerfile le fait) |
| `node:sqlite` introuvable | Node < 22.5 sur l'hôte — l'image Docker fournie est en Node 22 |
| Aucun e-mail de réinitialisation reçu | `RESEND_API_KEY` absente : le lien n'est écrit que dans les logs |
| Le lien de l'e-mail pointe vers localhost | `PUBLIC_URL` non renseignée |
