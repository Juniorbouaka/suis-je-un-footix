import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useAuth } from '../lib/auth.jsx';

/**
 * Publicité et consentement.
 *
 * ATTENTION — ce bandeau est une STRUCTURE de départ, pas une CMP certifiée.
 * Pour diffuser de la publicité personnalisée dans l'UE avec AdSense, il faut
 * une CMP enregistrée IAB TCF v2.2 (Google propose la sienne, ou Axeptio,
 * Didomi, Sirdata…). Ce composant gère le stockage du choix et le blocage
 * du script tant que le consentement n'est pas donné : branche ta vraie CMP
 * ici en remplaçant `ConsentBanner`.
 *
 * Activation : mettre VITE_ADS_CLIENT=ca-pub-XXXX dans client/.env
 */

const KEY = 'footix.consent';
const ConsentContext = createContext(null);

export function ConsentProvider({ children }) {
  const [consent, setConsent] = useState(() => localStorage.getItem(KEY));

  const decide = useCallback((value) => {
    localStorage.setItem(KEY, value);
    setConsent(value);
  }, []);

  return (
    <ConsentContext.Provider value={{ consent, decide }}>{children}</ConsentContext.Provider>
  );
}

export function useConsent() {
  return useContext(ConsentContext) || { consent: null, decide: () => {} };
}

export function ConsentBanner() {
  const { consent, decide } = useConsent();
  const adsClient = import.meta.env.VITE_ADS_CLIENT;

  if (consent || !adsClient) return null;

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
 * Emplacement publicitaire. N'affiche rien pour les comptes premium,
 * ni tant que le consentement n'a pas été donné, ni si aucun identifiant
 * AdSense n'est configuré.
 */
export default function AdSlot({ slot, format = 'auto', label = 'Publicité' }) {
  const { consent } = useConsent();
  const { profile } = useAuth();
  const adsClient = import.meta.env.VITE_ADS_CLIENT;
  const isPremium = profile?.user?.isPremium;

  useEffect(() => {
    if (!adsClient || consent !== 'accepted' || isPremium) return;
    if (!document.querySelector('script[data-adsense]')) {
      const s = document.createElement('script');
      s.async = true;
      s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${adsClient}`;
      s.crossOrigin = 'anonymous';
      s.dataset.adsense = 'true';
      document.head.appendChild(s);
    }
    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    } catch {
      /* le bloqueur de pub a gagné, tant pis */
    }
  }, [adsClient, consent, isPremium]);

  if (isPremium || !adsClient || consent !== 'accepted') return null;

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
