import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useAuth } from '../lib/auth.jsx';

/**
 * Publicité et consentement.
 *
 * Le consentement est délégué à Google Funding Choices (« Privacy & messaging »
 * dans le back-office AdSense), qui est une CMP certifiée IAB TCF v2.2. C'est
 * une obligation, pas un confort : depuis 2024, Google cesse de diffuser des
 * annonces sur le trafic européen d'un site dépourvu de CMP certifiée. Écrire
 * son propre bandeau ne suffit donc pas, aussi soigné soit-il.
 *
 * Funding Choices est chargé par le même script que AdSense : il suffit
 * d'activer un message de consentement dans le back-office, rien à installer
 * de plus ici. Le bandeau de repli ci-dessous ne sert qu'au cas où la CMP
 * n'a pas encore été configurée.
 *
 * Activation : ADS_CLIENT=ca-pub-XXXX dans les variables du SERVEUR.
 */

const KEY = 'footix.consent';
const ConsentContext = createContext(null);

/*
 * L'identifiant AdSense est lu à l'EXÉCUTION, auprès du serveur.
 *
 * Une variable VITE_* serait figée au moment de la compilation du bundle,
 * or le front est compilé dans l'image Docker : la poser côté hébergeur
 * n'aurait aucun effet. En passant par /api/config, activer ou couper la
 * publicité ne demande qu'un changement de variable et un redémarrage.
 */
let adsClient = null;
let configPromise = null;

function chargerConfig() {
  configPromise ??= fetch('/api/config')
    .then((r) => (r.ok ? r.json() : null))
    .then((c) => {
      adsClient = c?.adsClient || null;
      return adsClient;
    })
    .catch(() => null);
  return configPromise;
}

/* ------------------------------------------------------------------ *
 *  Chargement du script AdSense — une seule fois pour toute la page
 * ------------------------------------------------------------------ */

let scriptPromise = null;

function loadAdSense() {
  if (!adsClient) return Promise.resolve(false);
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise((resolve) => {
    if (document.querySelector('script[data-adsense]')) return resolve(true);

    const s = document.createElement('script');
    s.async = true;
    s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${adsClient}`;
    s.crossOrigin = 'anonymous';
    s.dataset.adsense = 'true';
    s.onload = () => resolve(true);
    // Bloqueur de pub, réseau coupé : on n'insiste pas, le jeu passe avant.
    s.onerror = () => resolve(false);
    document.head.appendChild(s);
  });

  return scriptPromise;
}

/* ------------------------------------------------------------------ *
 *  Contexte de consentement
 * ------------------------------------------------------------------ */

export function ConsentProvider({ children }) {
  const [consent, setConsent] = useState(() => localStorage.getItem(KEY));
  const [cmpActive, setCmpActive] = useState(false);

  const decide = useCallback((value) => {
    localStorage.setItem(KEY, value);
    setConsent(value);
  }, []);

  // La CMP de Google s'installe elle-même via le script AdSense et expose
  // __tcfapi. Si elle répond, c'est elle qui gère le consentement et notre
  // bandeau de repli doit s'effacer.
  const [pret, setPret] = useState(false);

  // La configuration décide de tout : sans identifiant, aucun script tiers
  // n'est chargé et le bandeau ne s'affiche jamais.
  useEffect(() => {
    chargerConfig().then(() => setPret(true));
  }, []);

  useEffect(() => {
    if (!pret || !adsClient) return;
    let annule = false;

    loadAdSense().then((ok) => {
      if (!ok || annule) return;

      const detecte = () => {
        if (annule) return;
        if (typeof window.__tcfapi !== 'function') return false;

        setCmpActive(true);
        window.__tcfapi('addEventListener', 2, (tcData, success) => {
          if (!success || annule) return;
          // « useractioncomplete » : le joueur vient de répondre.
          // « tcloaded » : un choix antérieur est rechargé.
          if (tcData.eventStatus === 'useractioncomplete' || tcData.eventStatus === 'tcloaded') {
            decide(tcData.gdprApplies === false || tcData.purpose?.consents?.[1] ? 'accepted' : 'refused');
          }
        });
        return true;
      };

      if (detecte()) return;
      // La CMP s'enregistre peu après le script : on retente brièvement.
      const id = setInterval(() => detecte() && clearInterval(id), 400);
      setTimeout(() => clearInterval(id), 8000);
    });

    return () => {
      annule = true;
    };
  }, [decide, pret]);

  return (
    <ConsentContext.Provider value={{ consent, decide, cmpActive, adsClient: pret ? adsClient : null }}>
      {children}
    </ConsentContext.Provider>
  );
}

export function useConsent() {
  return useContext(ConsentContext) || { consent: null, decide: () => {}, cmpActive: false, adsClient: null };
}

/**
 * Bandeau de repli.
 *
 * Ne s'affiche que si la publicité est branchée ET que la CMP certifiée n'a
 * pas répondu — typiquement le temps de la configurer dans AdSense. Dès que
 * Funding Choices prend la main, ce bandeau disparaît de lui-même.
 */
export function ConsentBanner() {
  const { consent, decide, cmpActive, adsClient: client } = useConsent();

  if (consent || cmpActive || !client) return null;

  return (
    <div className="consent">
      <div className="container container-wide consent-inner">
        <p className="small">
          On utilise des cookies pour financer le jeu par la publicité. Tu peux refuser : le jeu
          reste identique, seules les pubs seront non personnalisées.
        </p>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => decide('refused')}>
            Refuser
          </button>
          <button className="btn btn-sm" onClick={() => decide('accepted')}>
            Accepter
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Emplacement publicitaire.
 *
 * Muet pour les abonnés, tant qu'aucun consentement n'est donné, et tant
 * qu'aucun identifiant AdSense n'est configuré.
 */
export default function AdSlot({ slot, format = 'auto', label = 'Publicité' }) {
  const { consent, adsClient: client } = useConsent();
  const { isPremium } = useAuth();
  const ins = useRef(null);
  // Tant que Google n'a pas rempli l'emplacement, on ne montre rien.
  const [rempli, setRempli] = useState(false);

  const affichable = Boolean(client) && consent === 'accepted' && !isPremium;

  useEffect(() => {
    if (!affichable) return undefined;
    let observateur;

    loadAdSense().then((ok) => {
      if (!ok) return;
      try {
        (window.adsbygoogle = window.adsbygoogle || []).push({});
      } catch {
        /* le bloqueur de pub a gagné, tant pis */
      }

      /*
       * AdSense renseigne « data-ad-status » sur le <ins> : « filled »
       * quand une annonce est servie, « unfilled » sinon — le cas tant que
       * le site n'est pas validé, ou quand aucune annonce ne correspond.
       *
       * Sans ce contrôle, le joueur voit un cadre vide étiqueté
       * « Publicité », ce qui donne l'impression d'un site cassé.
       */
      if (!ins.current) return;
      observateur = new MutationObserver(() => {
        const statut = ins.current?.getAttribute('data-ad-status');
        if (statut === 'filled') setRempli(true);
        else if (statut === 'unfilled') setRempli(false);
      });
      observateur.observe(ins.current, { attributes: true, attributeFilter: ['data-ad-status'] });
    });

    return () => observateur?.disconnect();
  }, [affichable]);

  if (!affichable) return null;

  return (
    <div className={`ad-slot${rempli ? '' : ' vide'}`} aria-label={label}>
      {rempli && <span className="ad-label">{label}</span>}
      <ins
        ref={ins}
        className="adsbygoogle"
        style={{ display: 'block' }}
        data-ad-client={client}
        data-ad-slot={slot}
        data-ad-format={format}
        data-full-width-responsive="true"
      />
    </div>
  );
}
