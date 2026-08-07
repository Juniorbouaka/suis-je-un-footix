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
| `CLAUDE_MODEL` | `claude-sonnet-5` | modèle principal |
| `CLAUDE_ESCALATION_MODEL` | `claude-opus-4-8` | reprend la main quand le petit modèle se trompe |
| `CLAUDE_ESCALATION_BELOW` | `20` | seuil de déclenchement de l'escalade |
| `DAILY_API_BUDGET` | `7700` | plafond d'appels par jour ; au-delà, la proposition est **refusée** |

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

Coût constaté, par tranche de 1000 propositions : Haiku ~1,06 $, Sonnet 5 ~2,56 $, Opus 4.8 ~6,58 $.
Le script `node tests/compare-models.mjs` rejoue la comparaison sur des paires connues.
⚠️ Le tarif Sonnet est un prix de lancement jusqu'au 31 août 2026 ; ensuite ~3,84 $.

**Haiku a été essayé et écarté** : il note 0 une proposition quasi parfaite (Casillas contre Buffon
vaut 83 chez Opus, 65 chez Sonnet, 0 chez Haiku). Moins cher à la ligne, mais la jauge ne veut plus
rien dire — et six cas de test sur huit passant sous le seuil d'escalade, chaque proposition aurait
payé Haiku *puis* Opus.

### Quand l'évaluateur ne peut pas répondre

Clé absente, plafond atteint, panne ou dépassement de délai : le jeu **refuse la proposition** et le
dit. Il ne consomme pas de chance, n'écrit rien en base, et rien ne part au classement. En duel, le
chrono du tour est relancé et c'est toujours au même joueur de jouer. Une proposition déjà évaluée
reste servie depuis le cache : elle ne coûte rien.

Il y avait avant un « évaluateur de secours » qui comparait les lettres faute de savoir comparer le
sens. Il a été supprimé, parce qu'il ne rendait pas des scores approximatifs mais **inversés** :

| Proposition / secret | Attendu | Ancien secours |
|---|---|---|
| platini / zidane | haut | 0 |
| buffon / casillas | haut | 0 |
| gomis / gomes | **bas** | **41** |
| ronaldo / ronaldinho | **bas** | **57** |

Toutes les bonnes propositions à zéro, et les pièges orthographiques — ce que le jeu est fait pour
punir — en tête. Ces notes partaient dans `daily_results` : une panne de vingt minutes salissait des
journées de classement pour toujours. Un refus honnête vaut mieux qu'un score faux.

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

**Un administrateur a aussi tous les droits du jeu**, sans abonnement et sans écriture en base
(`findUserById`) : `is_subscriber` **et** `is_premium`. Oublier le premier l'enfermerait dehors —
il verrait le mur de paiement sur son propre site. Celui qui paie l'API du jeu n'a pas à
s'abonner à son propre jeu, et il doit pouvoir vérifier ce que voient ses abonnés. Retirer
l'adresse de `ADMIN_EMAILS` retire les droits d'un coup, sans rien laisser à nettoyer dans la
base.

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
  src/credits.js         le grand livre : débits, remboursements, recharges, relevé
  src/paypal.js          client REST PayPal (fetch natif, aucune dépendance)
  src/themes.js          catalogue des décors de terrain
  src/routes/            auth · jeu · archives · classement · facturation
  scripts/paypal-setup   crée le produit et les plans d'abonnement chez PayPal
  tests/duel.e2e.mjs     test bout-en-bout du duel
  tests/bank.check.mjs   validation de la base de joueurs

client/                  React 18 + Vite
  src/components/        PitchBackground, Gauge, GuessList, Icon, AuthModal, Confetti, Layout
                         PremiumBadge, SubscriptionCard, ThemePicker, DetailedStats, Ads
                         CreditBadge (en-tête), CreditWallet (profil)
  src/pages/             Landing · Solo · Matchmaking · Arena · Leaderboard · Profile
                         Archive · ArchiveGame · Premium · PremiumThanks · Legal
  src/lib/               api, auth, socket, crédits, thème, présence
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
| `GET` | `/api/archive` · `/archive/:date` | journées passées (abonnés ; consulter est gratuit) |
| `POST` | `/api/archive/:date/guess` · `/surrender` | **rejouer** une journée passée (1 crédit) |
| `DELETE` | `/api/archive/:date/replay` | effacer un rejeu et recommencer (1 crédit) |
| `GET` | `/api/me/stats/detailed` | statistiques détaillées (Illimité) |
| `GET` | `/api/themes` · `PUT /api/me/theme` | décors de terrain |
| `GET` | `/api/billing/offer` · `/status` | les deux forfaits, l'abonnement en cours |
| `GET` | `/api/billing/credits` | le portefeuille et son relevé |
| `POST` | `/api/billing/subscribe` · `/confirm` · `/cancel` | souscrire ou changer de formule, confirmer, résilier |
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

**Jouer demande un abonnement.** Toutes les routes qui appellent l'API Claude passent par
`requirePaidAccess`, et la socket refuse la poignée de main à un compte sans abonnement — un
seul point de passage, aucun événement ajouté demain ne peut lui échapper par oubli. Le refus
répond **402** et non 403 : le client sait alors qu'il ne manque pas un droit mais un
abonnement, et renvoie vers l'offre.

**Solo** — **20 chances par partie**, pour tout le monde, quelle que soit la formule
(`MAX_ATTEMPTS`). Au-delà, la partie est perdue : le joueur est révélé avec sa fiche, score nul.
`score = 1000 − 50 × (tentatives − 1) + (3600 − secondes) / 10`, plancher à 100.

Ce que le forfait supérieur achète, c'est le **nombre de parties**, jamais leur longueur : une
partie à cinquante essais coûte plus de trois fois une partie à vingt, et vendue au même crédit
elle transformerait chaque gros joueur en perte sèche. Deux abonnés qui jouent la même journée
jouent donc avec le même nombre de balles.

**Une seule partie classée par jour** — la première, et c'est `scoring.js` qui l'impose, au seul
endroit qui écrit les statistiques solo. Les suivantes se jouent hors classement : ni point, ni
série, ni médaille. C'est la garantie qui tient le classement debout maintenant qu'on vend des
crédits ; sans elle, le tableau classerait les porte-monnaie.

### Les crédits

**Le joueur du jour est compris dans les deux formules**, tous les jours, sans rien décompter.
C'est le rendez-vous du jeu : mettre un compteur devant, c'est faire hésiter quelqu'un avant de
faire la seule chose qu'on veut le voir faire.

Les crédits servent au **reste** : rejouer une journée d'archive ou lancer un duel coûtent une
partie. Une invitation en coûte deux à celui qui l'envoie — il paie pour lui et pour son invité,
qui n'a besoin de rien pour répondre. Le forfait sert un stock chaque mois (`CREDITS_ACCESS`,
`CREDITS_UNLIMITED`).

Le solde vit dans **deux poches**, et c'est la seule complexité du module :

| | |
|---|---|
| `credits` | le stock du mois. **Remplacé** à chaque échéance : un abonnement n'est pas une cagnotte, ce qui n'a pas été joué est perdu. |
| `credits_purchased` | les parties **achetées à l'unité**. Ne périment jamais. |

On dépense la première d'abord — vider ce qui expire avant ce qui reste, c'est ne rien gâcher —
et l'UPDATE fait les deux en une seule instruction conditionnelle, donc atomiquement. Les
additionner dans une seule colonne aurait fait disparaître les parties achetées à la première
recharge mensuelle : encaisser puis effacer, ce serait un litige mérité.

### Les recharges

Quand la réserve est vide, on peut acheter des parties à l'unité — 10 pour 1,99 €, 30 pour
4,99 €, 75 pour 9,99 € (`config.credits.packs`). Un paiement **ponctuel** par Stripe, sans
engagement, réservé aux abonnés : vendre des parties à quelqu'un qui ne peut pas entrer serait
lui vendre l'inutilisable.

Le prix à la partie y est volontairement plus élevé qu'au forfait (0,20 € contre 0,10 € et
moins), et **l'écran le dit** plutôt que de laisser quelqu'un empiler les recharges là où passer
à l'Illimité lui reviendrait moins cher.

Le crédit se fait par deux chemins volontairement redondants — le retour du navigateur et le
webhook — qui appellent le même `grantPack`. Celui-ci porte l'identifiant de session Stripe en
référence : le second arrivé ne crédite rien. C'est la redondance qu'on veut pour de l'argent
déjà encaissé, le joueur voyant ses parties tout de suite et le webhook rattrapant l'onglet
fermé trop tôt.

Trois principes tiennent `credits.js` :

1. **On débite à l'ouverture**, jamais à chaque proposition. Le prix d'une partie s'annonce
   avant de la commencer.
2. **Une partie commencée est payée une seule fois.** Le débit porte la référence de la partie
   (`solo:2026-08-07`, `archive:2026-07-02`, `duel:<salon>`) : recharger la page, perdre la
   connexion ou reprendre le lendemain ne redébite rien.
3. **Ce qui n'a pas été servi est remboursé.** Panne de l'évaluateur sur la première
   proposition, duel qui ne démarre jamais, adversaire introuvable : le crédit revient.

Deux garde-fous méritent d'être connus. L'abandon sec d'une partie jamais entamée est facturé —
sinon la porte de sortie deviendrait la porte d'entrée : ouvrir, abandonner, lire la réponse,
recommencer demain. Et « recommencer » une journée d'archive débite immédiatement, parce qu'une
journée déjà payée le reste : sans ce débit, effacer ses propositions puis rejouer aurait rendu
la journée gratuite indéfiniment.

Chaque mouvement laisse une ligne dans `credit_events`, lisible par le joueur depuis son profil.
`alreadyPaid` lit le **solde** de la référence et non la présence d'un débit : une partie
débitée puis remboursée laisse deux lignes qui s'annulent et redevient payante, sans qu'on ait
jamais à effacer un mouvement. Un relevé où les lignes disparaissent ne prouve plus rien, et
c'est précisément le jour où quelqu'un conteste qu'on en a besoin.

La recharge est **paresseuse**, comme l'expiration du premium : aucune tâche planifiée, et une
base restaurée d'une sauvegarde se remet d'aplomb à la première requête. Le signal normal est
l'**avancée de l'échéance** (`rechargeOnRenewal`) — un webhook rejoué porte la même échéance et
ne recharge donc rien, sans qu'on ait à tenir une table d'événements vus. Un filet de sécurité
à 32 jours (`CREDIT_RECHARGE_DAYS`) rattrape les webhooks perdus et sert les comptes offerts à
la main, qui n'ont aucune échéance ; 32 et non 30, pour qu'il ne tombe jamais avant le
renouvellement normal.

**Duel** — les deux cherchent le même joueur mystère, les tours alternent, le premier qui donne le
nom exact gagne. **15 essais chacun** (`MAX_ATTEMPTS_PVP`) — le même nombre quel que soit le
forfait : l'argent achète des duels, jamais un avantage à l'intérieur d'un duel. Quand les deux
sont à sec sans avoir trouvé, c'est **match nul** : ni victoire ni défaite au compteur, la série
de victoires est gelée sans être cassée. `score = 200 + bonus de rapidité + bonus d'efficacité +
50 × série`. Nul : 100 points. Défaite : 50 points de participation.

L'abandon, le forfait (trois tours manqués) et la déconnexion restent des défaites : l'un des
deux a quitté la partie, l'autre l'a tenue jusqu'au bout.

**Un duel coûte un crédit** — deux joueurs, jusqu'à trente propositions évaluées. En file
aléatoire chacun paie le sien ; sur invitation l'hôte règle l'addition entière, invité compris.
C'est le seul chemin par lequel on peut jouer sans dépenser, et il est payé par quelqu'un.

Le débit tombe à la **formation du salon**, jamais avant : attendre dix minutes dans la file ne
coûte rien. Si le second débit échoue, le premier est remboursé — un salon à moitié payé
n'existe pas. La revanche se paie comme un duel de plus, y compris pour celui qui avait été
invité gratuitement : l'invitation offre une partie, pas une soirée. Sans quoi le portefeuille
se contournerait en enchaînant les revanches.

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

### L'abonnement

Le jeu s'est ouvert gratuitement pendant des mois, et le compte est sans appel : 981 inscrits,
zéro don, une facture d'API tous les mois. Un jeu qui ne se vend pas s'éteint — il ne devient pas
rentable en attendant. Il n'y a donc plus de forfait gratuit.

| | |
|---|---|
| Encaisseurs | Stripe Checkout (carte, **Apple Pay**, **Google Pay**) · PayPal Subscriptions |
| **Accès** — 2,99 €/mois | le joueur du jour tous les jours · **+20 parties par mois** · duels · archives complètes et rejeu |
| **Illimité** — 9,99 €/mois | le joueur du jour tous les jours · **+100 parties par mois** · sans publicité · statistiques détaillées · quatre décors de terrain · badge au classement |
| **Recharges** — 1,99 à 9,99 € | 10, 30 ou 75 parties à l'unité, sans engagement, qui ne périment pas |

L'annuel à 19,99 € a disparu : avec un jeu payant à l'entrée, un troisième prix sur la page
n'aidait pas à choisir, il faisait hésiter.

**Le calcul.** Une proposition coûte ~0,0024 € (Sonnet), l'escalade vers Opus sur les joueurs mal
reconnus pousse la moyenne autour de 0,004 € ; une partie va jusqu'à vingt propositions, soit
~0,08 € au pire et plutôt 0,04 € au régime réel. Stripe prélève 1,5 % + 0,25 €. Le joueur du jour
étant compris, il faut compter ~30 parties mensuelles en plus des crédits.

| Forfait | Net | Parties/mois | Régime réel | Pire cas |
|---|---|---|---|---|
| Accès | 2,70 € | 30 + 20 = 50 | 2,00 € → **+0,70 €** | 4,00 € → **−1,30 €** |
| Illimité | 9,59 € | 30 + 100 = 130 | 5,20 € → **+4,39 €** | 10,40 € → **−0,81 €** |

⚠️ **Le pire cas est déficitaire, et c'est assumé.** Un abonné qui jouerait tous les jours *et*
brûlerait ses vingt essais à chaque partie *et* consommerait tous ses crédits coûterait plus
qu'il ne paie — les trente parties mensuelles offertes mangent à elles seules 2,40 € au pire, sur
les 2,70 € que rapporte le forfait Accès. C'est un pari sur le comportement réel, pas une
garantie arithmétique : au régime observé les deux forfaits gagnent de l'argent, et personne ne
joue au pire cas tous les jours d'un mois.

Ce qui protège la caisse n'est donc plus le calcul mais **`DAILY_API_BUDGET`**, le plafond
d'appels quotidiens — c'est lui qu'il faut surveiller, et le tableau de bord admin affiche le
rapport consommé/distribué pour ça. Les recharges, elles, restent bénéficiaires même au pire cas
(10 parties coûtent au pire 0,80 € pour 1,71 € nets) : ce sont elles qui compensent le pari.

Si la moyenne réelle dépassait douze propositions par partie, il faudrait revoir l'un des trois
chiffres : le prix, le stock, ou le nombre d'essais.

**Le changement de formule modifie l'abonnement en cours**, il n'en ouvre pas un second — chez
Stripe par un changement de prix au prorata (`changeSubscriptionPrice`), chez PayPal par une
révision approuvée par le payeur (`reviseSubscription`). Une seconde page de paiement aurait
laissé courir le premier abonnement : deux prélèvements mensuels, découverts des semaines plus
tard sur un relevé bancaire. Le nouveau stock est servi immédiatement (`grantOnPlanChange`) :
qui paie l'Illimité en cours de mois joue à l'Illimité le soir même.

**Ce que l'abonnement ne donne pas :** d'indice, de point offert, ni d'accès à un meilleur
évaluateur — et pas une chance de plus par partie. Le score baisse de 50 points à chaque chance
utilisée, pour tout le monde. Le rejeu des archives se déroule dans des tables séparées
(`archive_guesses` / `archive_results`) : il ne touche ni `daily_results`, ni les statistiques,
ni les médailles.

Accorder un accès à la main (compte de test, geste commercial) — le script pose l'Illimité,
sans échéance, et sert le stock de crédits :

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
# 2. Recopier PAYPAL_PLAN_ACCESS et PAYPAL_PLAN_UNLIMITED dans .env
# 3. Declarer le webhook indique par le script, recopier PAYPAL_WEBHOOK_ID
```

Les environnements **sandbox** et **live** de PayPal sont étanches : un plan créé dans l'un
n'existe pas dans l'autre. Le script est donc à rejouer au passage en production.

Sans `PAYPAL_WEBHOOK_ID`, tous les webhooks sont refusés — c'est voulu : un webhook non vérifié
laisserait n'importe qui s'offrir le premium en appelant la route. Mais tant qu'il manque, les
renouvellements et les résiliations ne sont jamais pris en compte.

#### Comment les droits s'ouvrent et se ferment

`premium_until` porte la fin des droits — de **tous** les droits, quel que soit le forfait. Deux
drapeaux répondent à deux questions distinctes : `is_subscriber` (a-t-il le droit de jouer ?) et
`is_premium` (a-t-il le forfait Illimité ?). Un seul ne suffisait plus le jour où le jeu est
devenu payant : `is_premium` répondait « a-t-il payé ? » **et** « a-t-il tout payé ? », deux
questions qui n'ont plus la même réponse depuis qu'il existe un forfait d'entrée.

Les deux tombent ensemble à l'expiration : ne retirer que `is_premium` laisserait la porte du jeu
ouverte à un abonnement expiré depuis six mois. Une résiliation, elle, ne coupe rien sur le
champ : la période payée va à son terme. L'expiration se fait paresseusement, dans
`findUserById`, à la première requête suivant l'échéance — aucune tâche planifiée à maintenir.
Un thème premium redevient automatiquement le thème libre quand le forfait s'éteint, sans
effacer le choix : il est retrouvé tel quel en cas de réabonnement.

**Reprise des comptes d'avant la bascule** (`db.js`, rejouée à chaque démarrage parce qu'elle
énonce des invariants) : tout compte `is_premium` devient `is_subscriber` — un abonné mis à la
porte le jour où l'on commence à vendre serait la pire manière de lancer l'offre — et les
anciennes clés de formule (`monthly`, `yearly`) deviennent `unlimited`, sans quoi le premier
webhook de renouvellement rétrograderait au forfait Accès un joueur qui n'a rien demandé.

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

Page `/soutenir`, sans compte : un visiteur de passage doit pouvoir donner sans s'inscrire. Les
montants proposés (`DONATION_AMOUNTS`) et les bornes (`DONATION_MIN` / `DONATION_MAX`) sont
vérifiés **côté serveur** — le client propose, le serveur dispose.

**Paiement rapide.** Le bouton principal ouvre Stripe Checkout, qui affiche **Apple Pay** ou
**Google Pay** en tête de page dès que le téléphone les propose : deux secondes et une empreinte,
sans saisir seize chiffres. C'est l'endroit exact où l'on renonce sur mobile, et c'est la raison
pour laquelle ce bouton passe avant PayPal. Rien à héberger ni à déclarer de notre côté — la page
de paiement est celle de Stripe, donc le domaine Apple Pay aussi. Il suffit que les portefeuilles
soient activés dans le tableau de bord Stripe (ils le sont par défaut) ; sans
`STRIPE_SECRET_KEY`, le bouton disparaît et PayPal reprend la place principale.

La page d'accueil propose en plus trois montants **cliquables** (2 / 5 / 10 €) qui ouvrent
directement le paiement, sans page intermédiaire : chaque écran traversé fait perdre la moitié
des gens.

Le retour est vérifié côté serveur dans les deux cas — `POST /api/donate/capture` pour PayPal,
`POST /api/stripe/donate/confirm` pour Stripe — et l'on n'entérine jamais une référence de
commande fournie par le navigateur.

`DONATE_URL` ajoute un lien vers une page tierce (ex. `https://paypal.me/tonpseudo`). Ne jamais
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
