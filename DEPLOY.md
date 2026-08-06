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
   | `ADMIN_EMAILS` | ton adresse : ouvre `/admin` **et** donne l'accès premium complet |
   | `MAX_ATTEMPTS_FREE` | `15` |
   | `MAX_ATTEMPTS_PREMIUM` | `50` |
   | `MAX_ATTEMPTS_PVP` | `15` |
   | `MAX_DUELS_FREE` | `1` |
   | `MAX_DUELS_PREMIUM` | `5` |

   Ne touche pas à `PORT` : Railway l'injecte.

   ⚠️ Ces trois dernières ont changé de valeur (duel : `20` → `15` essais, `2` → `1` duel gratuit,
   `20` → `5` duels pour un abonné). Une variable déjà posée sur Railway **écrase** la valeur du
   code : si elle traîne avec l'ancien chiffre, corrige-la ou supprime-la — le code retombera sur
   la bonne valeur par défaut. Idem pour l'ancienne `MAX_ATTEMPTS`, qui n'a plus cours.

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
| **Paiement du premium** | La colonne `is_premium` existe et masque la pub. Brancher Stripe touche à la facturation : à faire toi-même. |
| **Nom de domaine** | Optionnel. Railway et Fly.io fournissent une URL utilisable telle quelle. |
| **Vérification d'e-mail à l'inscription** | Les adresses ne sont pas validées : quelqu'un peut s'inscrire avec une adresse inventée. Petit ajout une fois Resend en place. |

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
