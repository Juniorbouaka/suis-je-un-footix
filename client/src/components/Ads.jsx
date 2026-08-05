import { createContext, useCallback, useContext, useEffect, useState } from 'react';
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
 * Activation : VITE_ADS_CLIENT=ca-pub-XXXX dans client/.env
 */

const KEY = 'footix.consent';
const ConsentContext = createContext(null);

/** L'identifiant AdSense, ou null tant que la publicité n'est pas branchée. */
export const adsClient = import.meta.env.VITE_ADS_CLIENT || null;

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
  useEffect(() => {
    if (!adsClient) return;
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
  }, [decide]);

  return (
    <ConsentContext.Provider value={{ consent, decide, cmpActive }}>
      {children}
    </ConsentContext.Provider>
  );
}

export function useConsent() {
  return useContext(ConsentContext) || { consent: null, decide: () => {}, cmpActive: false };
}

/**
 * Bandeau de repli.
 *
 * Ne s'affiche que si la publicité est branchée ET que la CMP certifiée n'a
 * pas répondu — typiquement le temps de la configurer dans AdSense. Dès que
 * Funding Choices prend la main, ce bandeau disparaît de lui-même.
 */
export function ConsentBanner() {
  const { consent, decide, cmpActive } = useConsent();

  if (consent || cmpActive || !adsClient) return null;

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
  const { consent } = useConsent();
  const { isPremium } = useAuth();
  const affichable = Boolean(adsClient) && consent === 'accepted' && !isPremium;

  useEffect(() => {
    if (!affichable) return;
    loadAdSense().then((ok) => {
      if (!ok) return;
      try {
        (window.adsbygoogle = window.adsbygoogle || []).push({});
      } catch {
        /* le bloqueur de pub a gagné, tant pis */
      }
    });
  }, [affichable]);

  if (!affichable) return null;

  return (
    <div className="ad-slot" aria-label={label}>
      <span className="ad-label">{label}</span>
      <ins
        className="adsbygoogle"
        style={{ display: 'block' }}
        data-ad-client={adsClient}
        data-ad-slot={slot}
        data-ad-format={format}
        data-full-width-responsive="true"
      />
    </div>
  );
}
