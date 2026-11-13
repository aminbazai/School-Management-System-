import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';
import en from './en.json';
import ur from './ur.json';

export const LANGUAGES = [
  { code: 'en', label: 'English', short: 'EN', rtl: false },
  { code: 'ur', label: 'اردو', short: 'اردو', rtl: true },
];

export const DEFAULT_LANGUAGE = 'en';

export function isRtl(lang) {
  return lang === 'ur';
}

/** Keeps <html lang/dir> and the Urdu font in sync with the active language. */
export function applyDocumentLanguage(lang) {
  const code = LANGUAGES.some((l) => l.code === lang) ? lang : DEFAULT_LANGUAGE;
  const root = document.documentElement;
  root.lang = code;
  root.dir = isRtl(code) ? 'rtl' : 'ltr';
}

i18n.use(LanguageDetector).use(initReactI18next).init({
  resources: {
    en: { translation: en },
    ur: { translation: ur },
  },
  fallbackLng: DEFAULT_LANGUAGE,
  supportedLngs: LANGUAGES.map((l) => l.code),
  nonExplicitSupportedLngs: true,
  interpolation: { escapeValue: false },
  detection: {
    order: ['localStorage', 'navigator'],
    lookupLocalStorage: 'sms.language',
    caches: ['localStorage'],
  },
  // A missing key must never reach the screen as "errors.SOME_CODE".
  // The raw key is logged and a readable sentence is shown instead.
  parseMissingKeyHandler: (key) => {
    console.warn(`[i18n] missing translation key: ${key}`);
    const leaf = key.split('.').pop() || key;
    return leaf
      .replace(/_/g, ' ')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/^\w/, (c) => c.toUpperCase());
  },
});

applyDocumentLanguage(i18n.resolvedLanguage || DEFAULT_LANGUAGE);

export default i18n;