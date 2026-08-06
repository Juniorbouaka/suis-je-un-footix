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

## Tableau de bord d'administration

`/admin` réunit ce que la base sait déjà : inscriptions, connexions, joueurs actifs, fidélité,
abonnements, dons et appels Claude du jour. Aucun traceur tiers, aucune donnée envoyée ailleurs.

L'accès se règle par la variable `ADMIN_EMAILS` (adresses séparées par des virgules). C'est un
droit attaché au compte du jeu, pas un mot de passe supplémentaire : le serveur répond `404` à
qui n'y figure pas, et retirer une adresse suffit à couper l'accès.

**Un administrateur a aussi l'accès premium complet**, sans abonnement et sans écriture en base
(`findUserById`) : 50 chances, 5 duels, archives, statistiques et thèmes. Celui qui paie l'API
du jeu n'a pas à s'abonner à son propre jeu, et il doit pouvoir vérifier ce que voient ses
abonnés. Retirer l'adresse de `ADMIN_EMAILS` retire les deux droits d'un coup, sans rien laisser
à nettoyer dans la base.

Deux dates suivent chaque compte, parce qu'elles ne disent pas la même chose : `last_login_at`
(dernière saisie du mot de passe) et `last_seen_at` (dernière requête authentifiée, écrite au
plus toutes les 5 minutes). Le journal `login_events` ne garde que l'identifiant et l'heure —
ni adresse IP, ni agent utilisateur.

L'historique des inscriptions remonte à la création du site ; celui des connexions démarre à la
mise en service de cette version.

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
  src/billing.js         état de l'abonnement, expiration paresseuse des droits
  src/paypal.js          client REST PayPal (fetch natif, aucune dépendance)
  src/themes.js          catalogue des décors de terrain
  src/routes/            auth · jeu · archives · classement · facturation
  scripts/paypal-setup   crée le produit et les plans d'abonnement chez PayPal
  tests/duel.e2e.mjs     test bout-en-bout du duel
  tests/bank.check.mjs   validation de la base de joueurs

client/                  React 18 + Vite
  src/components/        PitchBackground, Gauge, GuessList, Icon, AuthModal, Confetti, Layout
                         PremiumBadge, SubscriptionCard, ThemePicker, DetailedStats, Ads
  src/pages/             Landing · Solo · Matchmaking · Arena · Leaderboard · Profile
                         Archive · ArchiveGame · Premium · PremiumThanks · Legal
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
| `GET` | `/api/leaderboard?scope=month\|all\|hall` | top 100 du mois, général, palmarès |
| `GET` | `/api/stats/global` | compteurs d'accueil (dont `online` et `bankSize`) |
| `POST` | `/api/presence` | ping de présence |
| `GET` | `/api/archive` · `/archive/:date` | journées passées (3 jours libres, puis premium) |
| `POST` | `/api/archive/:date/guess` · `/surrender` | **rejouer** une journée passée |
| `DELETE` | `/api/archive/:date/replay` | effacer un rejeu et recommencer |
| `GET` | `/api/me/stats/detailed` | statistiques détaillées (premium) |
| `GET` | `/api/themes` · `PUT /api/me/theme` | décors de terrain |
| `GET` | `/api/billing/offer` · `/status` | l'offre premium, l'abonnement en cours |
| `POST` | `/api/billing/subscribe` · `/confirm` · `/cancel` | souscrire, confirmer, résilier |
| `POST` | `/api/billing/webhook` | notifications PayPal (signature vérifiée) |
| `GET` | `/api/admin/stats?days=` | tableau de bord : comptes, connexions, revenus |
| `GET` | `/api/admin/users?q=` | annuaire des comptes (administrateur) |

### WebSocket (`/socket.io`)

`join-matchmaking` · `cancel-matchmaking` · `create-invite` · `join-invite` · `set-secret` ·
`guess` · `surrender` · `chat` · `rematch` · `leave-room` · `resume`

Émis par le serveur : `match-found` · `game-start` · `guess-result` · `state` · `game-over` ·
`descriptions` · `chat` · `rematch-vote` · `error-message`.

---

## Règles et scoring

**Solo** — **15 chances par jour** en gratuit (`MAX_ATTEMPTS_FREE`), **50 pour les abonnés**
(`MAX_ATTEMPTS_PREMIUM`), réinitialisation à minuit UTC. Au-delà, la partie est perdue : le joueur
est révélé avec sa fiche, score nul, et une fenêtre propose l'abonnement.
`score = 1000 − 50 × (tentatives − 1) + (3600 − secondes) / 10`, plancher à 100.

Un joueur qui s'abonne après avoir épuisé ses quinze chances retrouve sa partie du jour ouverte
(`reopenIfUpgraded`) : on ne vend pas cinquante chances pour en livrer zéro.

**Duel** — les deux cherchent le même joueur mystère, les tours alternent, le premier qui donne le
nom exact gagne. **15 essais chacun** (`MAX_ATTEMPTS_PVP`) — le même nombre pour l'abonné et le
gratuit : l'argent achète des duels, jamais un avantage à l'intérieur d'un duel. Quand les deux
sont à sec sans avoir trouvé, c'est **match nul** : ni victoire ni défaite au compteur, la série
de victoires est gelée sans être cassée. `score = 200 + bonus de rapidité + bonus d'efficacité +
50 × série`. Nul : 100 points. Défaite : 50 points de participation.

L'abandon, le forfait (trois tours manqués) et la déconnexion restent des défaites : l'un des
deux a quitté la partie, l'autre l'a tenue jusqu'au bout.

**1 duel par jour** en gratuit (`MAX_DUELS_FREE`), **5 pour les abonnés**
(`MAX_DUELS_PREMIUM`) : un duel, ce sont deux joueurs et jusqu'à trente propositions évaluées.
Le compte se lit dans `multiplay_games` — abandons et déconnexions inclus, ils ont coûté leurs
appels comme les autres — et le refus est prononcé par la socket avant la dépense, à l'entrée en
matchmaking, à la création ou l'acceptation d'une invitation, et **à la revanche** (sans quoi le
quota se contournerait en enchaînant les revanches).

**Classement** — trois lectures : **le mois** en cours (remise à zéro le 1er), le **général**
(cumul de toujours) et le **palmarès**, qui garde le vainqueur de chaque mois terminé. Un mois est
scellé dans `monthly_champions` à la première consultation qui suit sa fin — pas de tâche
planifiée, et un titre acquis ne se recalcule plus.

**Jauge** — 0-15 rouge, 16-40 orange, 41-70 jaune, 71-85 vert clair, 86-100 vert.

---

---

## Le modèle économique

Le jeu coûte de l'argent à chaque partie : chaque proposition part vers l'API Claude. Deux
recettes le financent — l'abonnement et la publicité — et une troisième, les dons, complète.

### L'abonnement premium

| | |
|---|---|
| Encaisseur | PayPal Subscriptions |
| Tarifs | 2,99 €/mois · 19,99 €/an |
| Ce que ça débloque | **50 chances par jour au lieu de 15** · sans publicité · archives complètes · **rejeu des journées passées** · statistiques détaillées · quatre décors de terrain · badge au classement |

**Le nombre de chances est le cœur de l'offre.** Chaque proposition est un appel facturé à
Claude : une partie ouverte à cinquante essais pour tout le monde coûte plus cher qu'elle ne
rapporte. Quinze chances suffisent à jouer sa journée, cinquante sont le confort qu'on achète.

**Ce que l'abonnement ne donne toujours pas :** d'indice, de point offert, ni d'accès à un
meilleur évaluateur. Le score baisse de 50 points à chaque chance utilisée, pour tout le monde :
un abonné qui trouve au 40ᵉ essai marque moins qu'un joueur gratuit qui trouve au 3ᵉ. Le rejeu des
archives se déroule dans des tables séparées (`archive_guesses` / `archive_results`) : il ne
touche ni `daily_results`, ni les statistiques, ni les médailles.

Accorder le premium à la main (compte de test, geste commercial) :

```bash
cd server
npm run premium -- adresse@exemple.com            # sans échéance, ne s'éteint jamais tout seul
npm run premium -- adresse@exemple.com --retirer
# en production, la base vit dans le volume de l'hébergeur :
railway run npm run premium -- adresse@exemple.com
```

#### Mise en route

```bash
cd server
# 1. Renseigner PAYPAL_CLIENT_ID et PAYPAL_CLIENT_SECRET dans .env
npm run paypal:setup      # cree le produit et les deux plans, affiche les identifiants
# 2. Recopier PAYPAL_PLAN_MONTHLY et PAYPAL_PLAN_YEARLY dans .env
# 3. Declarer le webhook indique par le script, recopier PAYPAL_WEBHOOK_ID
```

Les environnements **sandbox** et **live** de PayPal sont étanches : un plan créé dans l'un
n'existe pas dans l'autre. Le script est donc à rejouer au passage en production.

Sans `PAYPAL_WEBHOOK_ID`, tous les webhooks sont refusés — c'est voulu : un webhook non vérifié
laisserait n'importe qui s'offrir le premium en appelant la route. Mais tant qu'il manque, les
renouvellements et les résiliations ne sont jamais pris en compte.

#### Comment les droits s'ouvrent et se ferment

`premium_until` porte la fin des droits, `is_premium` le drapeau effectif. Une résiliation ne
coupe rien sur le champ : la période payée va à son terme. L'expiration se fait paresseusement,
dans `findUserById`, à la première requête suivant l'échéance — il n'y a donc aucune tâche
planifiée à maintenir. Un thème premium redevient automatiquement le thème libre quand
l'abonnement s'éteint, sans effacer le choix : il est retrouvé tel quel en cas de réabonnement.

Deux chemins mettent l'abonnement à jour, volontairement redondants : le retour de PayPal
(`/api/billing/confirm`, qui interroge PayPal côté serveur — le client ne décide de rien) et le
webhook, qui fait foi. Le premier ouvre les droits tout de suite, le second les maintient dans
la durée.

### La publicité

Le composant `client/src/components/Ads.jsx` est prêt mais dormant : il ne s'active qu'une fois
`VITE_ADS_CLIENT` renseigné. Trois choses sont nécessaires avant qu'AdSense accepte le site :

1. **Un nom de domaine à toi** — un sous-domaine d'hébergeur ne suffit pas.
2. **Les pages légales** — mentions, confidentialité, cookies. Elles existent
   (`client/src/pages/Legal.jsx`) mais contiennent des champs **à compléter**, surlignés en
   jaune sur la page tant qu'ils ne le sont pas. Le site n'est pas publiable en l'état.
3. **Une CMP certifiée IAB TCF v2.2** — obligatoire pour le trafic européen depuis 2024. Le
   code s'appuie sur **Google Funding Choices**, qui s'installe via le même script qu'AdSense :
   il suffit d'activer un message de consentement dans le back-office. Le bandeau maison ne sert
   que de repli tant que ce n'est pas fait, et s'efface dès que la CMP répond.

### Les dons

`DONATE_URL` ajoute un lien dans le pied de page (ex. `https://paypal.me/tonpseudo`). Ne jamais
y mettre une adresse e-mail : une adresse en clair sur une page publique est aspirée par les
robots en quelques jours.

### Garde-fou de dépense

`DAILY_API_BUDGET` reste le seul rempart contre une facture Anthropic surprise en cas de pic de
trafic. À relire avant toute campagne de visibilité.

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
