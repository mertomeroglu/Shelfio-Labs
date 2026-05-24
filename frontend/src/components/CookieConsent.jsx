import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Cookie, Settings2, ShieldCheck } from 'lucide-react';
import {
  COOKIE_BANNER_TEXT,
  COOKIE_CATEGORY_TEXTS,
  COOKIE_POLICY_TEXT,
  COOKIE_PREFERENCES_INTRO,
} from '../content/cookiePolicyText.js';

export const COOKIE_CONSENT_STORAGE_KEY = 'shelfio.cookieConsent.v1';
export const COOKIE_PREFERENCES_EVENT = 'shelfio:open-cookie-preferences';
export const COOKIE_CONSENT_UPDATED_EVENT = 'shelfio:cookie-consent-updated';

export { COOKIE_CATEGORY_TEXTS, COOKIE_POLICY_TEXT };

const DEFAULT_PREFERENCES = {
  necessary: true,
  analytics: false,
  preferences: false,
  marketing: false,
};

const safeReadConsent = () => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(COOKIE_CONSENT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      ...DEFAULT_PREFERENCES,
      ...parsed.categories,
      necessary: true,
      savedAt: parsed.savedAt || '',
      version: parsed.version || 1,
    };
  } catch {
    return null;
  }
};

const persistConsent = (categories) => {
  if (typeof window === 'undefined') return;
  const payload = {
    version: 1,
    savedAt: new Date().toISOString(),
    categories: {
      ...DEFAULT_PREFERENCES,
      ...categories,
      necessary: true,
    },
  };
  window.localStorage.setItem(COOKIE_CONSENT_STORAGE_KEY, JSON.stringify(payload));
  window.dispatchEvent(new CustomEvent(COOKIE_CONSENT_UPDATED_EVENT, { detail: payload }));
};

export const openCookiePreferences = () => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(COOKIE_PREFERENCES_EVENT));
};

export const hasCookieConsent = (category) => {
  const stored = safeReadConsent();
  if (category === 'necessary') return true;
  return Boolean(stored?.[category]);
};

export default function CookieConsentProvider() {
  const [isReady, setIsReady] = useState(false);
  const [isBannerVisible, setIsBannerVisible] = useState(false);
  const [isPreferencesOpen, setIsPreferencesOpen] = useState(false);
  const [draft, setDraft] = useState(DEFAULT_PREFERENCES);

  useEffect(() => {
    const stored = safeReadConsent();
    if (stored) {
      setDraft({
        necessary: true,
        analytics: Boolean(stored.analytics),
        preferences: Boolean(stored.preferences),
        marketing: Boolean(stored.marketing),
      });
      setIsBannerVisible(false);
    } else {
      setDraft(DEFAULT_PREFERENCES);
      setIsBannerVisible(true);
    }
    setIsReady(true);
  }, []);

  useEffect(() => {
    const openPreferences = () => {
      const stored = safeReadConsent();
      setDraft(stored ? {
        necessary: true,
        analytics: Boolean(stored.analytics),
        preferences: Boolean(stored.preferences),
        marketing: Boolean(stored.marketing),
      } : DEFAULT_PREFERENCES);
      setIsPreferencesOpen(true);
      setIsBannerVisible(false);
    };
    window.addEventListener(COOKIE_PREFERENCES_EVENT, openPreferences);
    return () => window.removeEventListener(COOKIE_PREFERENCES_EVENT, openPreferences);
  }, []);

  const savePreferences = useCallback((nextPreferences) => {
    persistConsent(nextPreferences);
    setDraft({ ...DEFAULT_PREFERENCES, ...nextPreferences, necessary: true });
    setIsBannerVisible(false);
    setIsPreferencesOpen(false);
  }, []);

  const acceptAll = useCallback(() => {
    savePreferences({
      necessary: true,
      analytics: true,
      preferences: true,
      marketing: true,
    });
  }, [savePreferences]);

  const acceptNecessary = useCallback(() => {
    savePreferences(DEFAULT_PREFERENCES);
  }, [savePreferences]);

  const categoryEntries = useMemo(() => Object.entries(COOKIE_CATEGORY_TEXTS), []);

  if (!isReady || typeof document === 'undefined') return null;

  return createPortal(
    <>
      {isBannerVisible ? (
        <section className="cookie-consent-banner" role="region" aria-label="Çerez bilgilendirmesi">
          <div className="cookie-consent-icon" aria-hidden="true"><Cookie size={20} /></div>
          <div className="cookie-consent-copy">
            <h2>{COOKIE_BANNER_TEXT.title}</h2>
            <p>{COOKIE_BANNER_TEXT.description}</p>
          </div>
          <div className="cookie-consent-actions">
            <button type="button" className="ghost-button" onClick={() => setIsPreferencesOpen(true)}>
              Tercihleri Yönet
            </button>
            <button type="button" className="ghost-button" onClick={acceptNecessary}>
              Zorunlu Çerezlerle Devam Et
            </button>
            <button type="button" className="primary-button" onClick={acceptAll}>
              Tümünü Kabul Et
            </button>
          </div>
        </section>
      ) : null}

      {isPreferencesOpen ? (
        <div className="cookie-preferences-overlay" role="presentation" onClick={() => setIsPreferencesOpen(false)}>
          <section
            className="cookie-preferences-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="cookie-preferences-title"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="cookie-preferences-header">
              <div className="cookie-preferences-title-wrap">
                <span className="cookie-preferences-header-icon" aria-hidden="true"><ShieldCheck size={18} /></span>
                <div>
                  <h2 id="cookie-preferences-title">Çerez Tercihleri</h2>
                  <p>{COOKIE_PREFERENCES_INTRO}</p>
                </div>
              </div>
              <button type="button" className="icon-button modal-close-button" onClick={() => setIsPreferencesOpen(false)} aria-label="Çerez tercihlerini kapat">
                ×
              </button>
            </header>

            <div className="cookie-preferences-body">
              <p className="cookie-preferences-intro">
                {COOKIE_PREFERENCES_INTRO}
              </p>
              <div className="cookie-preferences-category-list">
                {categoryEntries.map(([key, item]) => (
                  <article key={key} className="cookie-preferences-category">
                    <div>
                      <h3>{item.title}</h3>
                      <p>{item.summary}</p>
                      <small>{item.detail}</small>
                    </div>
                    <label className={`cookie-switch ${item.required ? 'is-disabled' : ''}`}>
                      <input
                        type="checkbox"
                        checked={Boolean(draft[key])}
                        disabled={item.required}
                        onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.checked, necessary: true }))}
                      />
                      <span>{item.required ? 'Her zaman aktif' : draft[key] ? 'Aktif' : 'Kapalı'}</span>
                    </label>
                  </article>
                ))}
              </div>
              <div className="cookie-policy-text">
                {COOKIE_POLICY_TEXT}
              </div>
            </div>

            <footer className="cookie-preferences-actions">
              <button type="button" className="ghost-button" onClick={acceptNecessary}>
                Zorunlu Çerezlerle Devam Et
              </button>
              <button type="button" className="ghost-button" onClick={acceptAll}>
                Tümünü Kabul Et
              </button>
              <button type="button" className="primary-button" onClick={() => savePreferences(draft)}>
                <Settings2 size={15} /> Tercihleri Kaydet
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </>,
    document.body,
  );
}
