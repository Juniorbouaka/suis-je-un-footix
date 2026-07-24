# Suis-je un footix ?

Jeu web de proximité sémantique sur le football : un **footballeur mystère** chaque jour.
Tu proposes des noms, l'IA note à quel point tu es proche (poste, époque, club, style de jeu).
Mode solo et mode duel temps réel.

---

## Démarrage rapide

Prérequis : **Node.js 22.5+** (le serveur utilise le module natif `node:sqlite`, aucune base à installer).

```bash
# 1. Serveur API + WebSocket
cd server
npm install
cp .env.example .env        # puis renseigner ANTHROPIC_API_KEY (voir plus bas)
npm start                   # http://localhost:4000

# 2. Client (second terminal)
cd client
npm install
npm run dev                 # http://localhost:5173
```

Une seule URL à ouvrir : **http://localhost:5173** (le front proxifie `/api` et `/socket.io`).

---

## Le moteur d'évaluation

| Réglage (`server/.env`) | Valeur | Rôle |
|---|---|---|
| `CLAUDE_MODEL` | `claude-haiku-4-5` | modèle principal, le moins cher |
| `CLAUDE_ESCALATION_MODEL` | `claude-opus-4-8` | reprend la main quand le petit modèle se trompe |
| `CLAUDE_ESCALATION_BELOW` | `20` | seuil de déclenchement de l'escalade |
| `DAILY_API_BUDGET` | `3000` | plafond d'appels par jour, puis bascule en mode secours |

Trois mécanismes se combinent pour tenir la qualité au prix du petit modèle :

**1. La fiche d'identité du joueur secret.** Les noms de famille sont ambigus — « Foster » désigne
plusieurs joueurs. Avant la première évaluation de la journée, le serveur demande à Claude une fiche
du joueur du jour, la met en cache, puis la joint à chaque évaluation. Coût : un appel par jour.
Effet mesuré sur Haiku : `casillas` contre `foster` passe de 22 à 72.

**2. L'escalade automatique.** Quand le petit modèle rend un score inférieur au seuil alors que les
deux noms figurent dans la banque — donc sont bel et bien des footballeurs — c'est le signe qu'il
n'a pas reconnu un joueur. L'évaluation est refaite avec le gros modèle. Ne concerne qu'une fraction
des appels ; un nom qui n'est pas un joueur (« pizza ») n'escalade jamais.

**3. Le cache versionné.** Chaque couple évalué est stocké. La clé embarque `PROMPT_VERSION` :
modifier le prompt d'évaluation invalide automatiquement les anciens scores, sans purge manuelle.

Coût constaté, par tranche de 1000 propositions : Haiku ~1,01 $, Sonnet 5 ~2,20 $, Opus 4.8 ~5,71 $.
Le script `node tests/compare-models.mjs` rejoue la comparaison sur des paires connues.

Sans `ANTHROPIC_API_KEY`, le jeu bascule sur un évaluateur local qui compare les lettres : jouable,
mais sans intérêt. Un bandeau « mode secours » le signale dans l'interface.

## La base de joueurs

**1551 footballeurs**, uniquement des noms de famille, avec trois règles strictes appliquées
automatiquement au chargement :

- un seul mot (aucun nom composé : pas de « Zaïre-Emery », « van Dijk », « De Bruyne ») ;
- sans accent (ASCII pur) ;
- entre 3 et 20 lettres.

Tout ce qui ne respecte pas ces règles est **rejeté et signalé**, jamais silencieusement inclus.

```bash
cd server
npm run check:bank
```

Le script affiche le total, la répartition par difficulté et la liste des entrées rejetées :
c'est l'outil pour corriger la base sans rien casser.

### Où éditer

| Fichier | Contenu |
|---|---|
| `src/words/legends.js` | légendes (Pelé, Maradona, Cruyff…) |
| `src/words/players-world.js` | stars actuelles |
| `src/words/players-france.js` | Ligue 1 et joueurs français |
| `src/words/players-premier.js` | Premier League |
| `src/words/players-liga-seriea.js` | Liga et Serie A |
| `src/words/players-international.js` | Bundesliga, Amérique du Sud, Afrique, Asie |
| `src/words/players-more.js` · `players-final.js` | compléments |

Chaque fichier range les noms par difficulté (1 = connu de tous → 4 = pour les connaisseurs).
Ajouter un joueur = ajouter une chaîne dans le bon tableau, puis relancer `npm run check:bank`.

### Tirage du joueur du jour

Pas d'IA ici : une **permutation déterministe par année**. `SHA-256("footix::2026")` mélange la
base, et le jour N de l'année prend la Nième entrée. Résultat : tout le monde a le même joueur le
même jour, aucun joueur ne sort deux fois dans la même année, et c'est reproductible. Le nom est
figé dans la table `daily_words` et **ne quitte jamais le serveur** — le client ne reçoit que le
type, la longueur et la difficulté.

### Où Claude travaille

1. **La note de proximité** — à chaque proposition, le couple *(joueur proposé, joueur mystère)*
   part vers Claude qui renvoie `{score 0-100, explanation}`. Résultat mis en cache : un couple
   n'est facturé qu'une fois.
2. **La fiche du joueur** — à la révélation, Claude rédige deux phrases : identité complète, poste,
   nationalité, période, clubs marquants, fait mémorable. Mise en cache par joueur.

---

## Compteur de présence

La page d'accueil affiche le nombre de personnes **actuellement sur le site** (connectées ou non)
et un compte à rebours jusqu'au prochain joueur mystère (minuit UTC). Chaque visiteur envoie un
ping toutes les 15 s (`POST /api/presence`) ; une entrée expire après 40 s sans signe de vie.

---

## Architecture

```
server/                  Node.js + Express + Socket.io
  src/config.js          configuration (.env)
  src/db.js              schéma SQLite (node:sqlite)
  src/words.js           assemblage, validation, tirage du jour
  src/words/             les 8 modules de joueurs
  src/claude.js          proximité, fiches joueurs, cache, modération, secours
  src/presence.js        compteur de visiteurs en direct
  src/auth.js            JWT access/refresh, bcrypt, middlewares
  src/scoring.js         scores, stats, rangs
  src/achievements.js    médailles
  src/realtime.js        matchmaking, duel, chat, revanche
  src/routes/            auth · jeu · classement
  tests/duel.e2e.mjs     test bout-en-bout du duel
  tests/bank.check.mjs   validation de la base de joueurs

client/                  React 18 + Vite
  src/components/        PitchBackground, Gauge, GuessList, Icon, AuthModal, Confetti, Layout
  src/pages/             Landing · Solo · Matchmaking · Arena · Leaderboard · Profile
  src/lib/               api, auth, socket, thème, présence
  src/styles.css         design system (verre dépoli, cartes flottantes, décor de stade)
```

### API HTTP

| Méthode | Route | Description |
|---|---|---|
| `POST` | `/api/auth/signup` · `/login` · `/refresh` · `/logout` | authentification |
| `POST` | `/api/auth/forgot-password` · `/reset-password` | mot de passe oublié (jeton haché, 1 h) |
| `DELETE` | `/api/auth/me` | suppression du compte et de toutes ses données |
| `GET` | `/api/auth/me` | profil, stats, rang, médailles |
| `GET` | `/api/daily-word` | indices du jour + progression (jamais la réponse) |
| `POST` | `/api/guess` | propose un joueur, renvoie la proximité |
| `POST` | `/api/surrender` | abandonne et révèle le joueur + sa fiche |
| `GET` | `/api/history?date=` | tentatives d'une journée |
| `GET` | `/api/leaderboard?scope=all\|today` | top 100 |
| `GET` | `/api/stats/global` | compteurs d'accueil (dont `online` et `bankSize`) |
| `POST` | `/api/presence` | ping de présence |
| `GET` | `/api/archive` · `/archive/:date` | journées passées (3 jours libres, puis premium) |
| `POST` | `/api/demo/guess` | échauffement sans compte |

### WebSocket (`/socket.io`)

`join-matchmaking` · `cancel-matchmaking` · `create-invite` · `join-invite` · `set-secret` ·
`guess` · `surrender` · `chat` · `rematch` · `leave-room` · `resume`

Émis par le serveur : `match-found` · `game-start` · `guess-result` · `state` · `game-over` ·
`descriptions` · `chat` · `rematch-vote` · `error-message`.

---

## Règles et scoring

**Solo** — **50 tentatives maximum** (`MAX_ATTEMPTS`), réinitialisation à minuit UTC. Au-delà, la
partie est perdue : le joueur est révélé avec sa fiche, score nul.
`score = 1000 − 50 × (tentatives − 1) + (3600 − secondes) / 10`, plancher à 100.

**Duel** — chacun choisit un joueur secret, les tours alternent, le premier qui atteint une
proximité ≥ 90 (ou le nom exact) gagne. **25 tentatives chacun** (`MAX_ATTEMPTS_PVP`) : quand les
deux sont à sec, c'est **match nul** et chacun marque 100 points. `score = 200 + bonus de rapidité + bonus d'efficacité +
50 × série`. Défaite : 50 points de participation.

**Jauge** — 0-15 rouge, 16-40 orange, 41-70 jaune, 71-85 vert clair, 86-100 vert.

---

## Sécurité

- Mots de passe hachés (bcrypt) ; JWT access court + refresh token révocable en base.
- Le joueur du jour et les joueurs secrets des duels ne sont jamais envoyés au client avant la fin.
- Joueurs secrets des duels stockés hachés (SHA-256) dans l'historique.
- Requêtes SQL exclusivement paramétrées.
- Limitation de débit : 10 propositions/minute et 1 par seconde par joueur, 300 requêtes/minute
  globales, 30 tentatives d'authentification par quart d'heure.
- Validation et modération des noms proposés côté serveur.
- CORS restreint à l'origine du client.

---

## Tests

```bash
cd server
npm run check:bank    # valide la base de joueurs, liste les entrées rejetées
npm run test:duel     # partie complète en duel : 2 comptes, 2 sockets, victoire, points
```

Le serveur doit tourner pour `test:duel`.

---

## Croissance et monétisation

**Partage du résultat** — bouton en fin de partie. Le texte copié ne révèle jamais le joueur : il
montre la progression des meilleurs scores sous forme de barres. C'est le levier de croissance
principal sur ce format de jeu quotidien.

**Publicité** — `client/src/components/Ads.jsx` fournit `AdSlot` et un bandeau de consentement.
Rien ne s'affiche tant que `VITE_ADS_CLIENT` (identifiant AdSense) n'est pas défini dans
`client/.env`, ni tant que le consentement n'est pas donné, ni pour les comptes premium.

⚠️ Le bandeau fourni est une **structure de départ, pas une CMP certifiée**. Diffuser de la
publicité personnalisée dans l'UE exige une CMP enregistrée IAB TCF v2.2 (Google, Axeptio, Didomi,
Sirdata…), plus mentions légales et politique de confidentialité. Branche ta CMP à la place de
`ConsentBanner`.

**Premium** — la colonne `users.is_premium` existe et masque la publicité. L'intégration du paiement
(Stripe ou autre) reste à faire : c'est une étape qui touche à la facturation, à réaliser toi-même.

**Ordre de grandeur** : à 200 joueurs par jour, compte ~70 €/mois de revenus publicitaires face à
~25-35 €/mois de coûts (Haiku + hébergement). La publicité ne devient réellement intéressante qu'à
plusieurs milliers de visiteurs quotidiens, où les régies premium (Ezoic, Mediavine, Raptive) paient
5 à 10 fois mieux qu'AdSense.
