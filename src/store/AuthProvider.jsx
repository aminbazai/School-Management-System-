import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import api from '../lib/api';
import { applyDocumentLanguage } from '../i18n';

/**
 * Application session store.
 *
 * Truth lives in the main process; this store mirrors it so the UI can react.
 * A heartbeat keeps the main-process idle watchdog alive while the user works.
 */

const AuthContext = createContext(null);

const HEARTBEAT_MS = 60 * 1000;

export function AuthProvider({ children }) {
  const { i18n } = useTranslation();
  const [user, setUser] = useState(null);
  const [settings, setSettings] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | authed | anonymous
  const [sessionExpired, setSessionExpired] = useState(false);
  const [sessionEndReason, setSessionEndReason] = useState(null);
  const heartbeatRef = useRef(null);

  const language = i18n.resolvedLanguage || 'en';

  // Apply language + document direction on every change.
  useEffect(() => {
    if (i18n.language !== language) i18n.changeLanguage(language);
    applyDocumentLanguage(language);
  }, [i18n, language]);

  // Apply the theme coming from the server settings.
  useEffect(() => {
    if (!settings?.theme) return;
    document.documentElement.dataset.theme = settings.theme;
  }, [settings?.theme]);

  const bootstrap = useCallback(async () => {
    try {
      const data = await api.auth.session();
      setSettings(data.settings);
      if (data.user) {
        setUser(data.user);
        setStatus('authed');
      } else {
        setUser(null);
        setStatus('anonymous');
      }
    } catch {
      setUser(null);
      setStatus('anonymous');
    }
  }, []);

  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  // Main process tells us when the idle watchdog killed the session.
  useEffect(() => {
    const off = api.auth.on('session:expired', () => {
      setUser(null);
      setStatus('anonymous');
      setSessionExpired(true);
      setSessionEndReason('expired');
    });
    // The session also ends when an administrator wipes the data.
    const offReset = api.auth.on('session:reset', (payload) => {
      setUser(null);
      setStatus('anonymous');
      setSessionExpired(true);
      setSessionEndReason(payload?.reason || 'reset');
    });
    return () => {
      off();
      offReset();
    };
  }, []);

  // Keep-alive ping (also resets the "last activity" timestamp in main).
  useEffect(() => {
    if (status !== 'authed') {
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      return undefined;
    }
    heartbeatRef.current = setInterval(() => {
      api.auth.heartbeat().catch(() => {});
    }, HEARTBEAT_MS);
    return () => clearInterval(heartbeatRef.current);
  }, [status]);

  // User activity resets the inactivity clock in main.
  useEffect(() => {
    if (status !== 'authed') return undefined;
    const events = ['pointerdown', 'keydown', 'wheel', 'focus'];
    let last = 0;
    const onActivity = () => {
      const now = Date.now();
      if (now - last < 10 * 1000) return;
      last = now;
      api.auth.heartbeat().catch(() => {});
    };
    events.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
    return () => events.forEach((e) => window.removeEventListener(e, onActivity));
  }, [status]);

  const login = useCallback(async (username, password) => {
    const data = await api.auth.login(username, password);
    setSettings(data.settings);
    setUser(data.user);
    setSessionExpired(false);
    setStatus('authed');
    return data;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.auth.logout();
    } finally {
      setUser(null);
      setStatus('anonymous');
      setSessionExpired(false);
    }
  }, []);

  const changePassword = useCallback(async (payload) => {
    const result = await api.auth.changePassword(payload);
    setUser((prev) => (prev ? { ...prev, mustChangePassword: false } : prev));
    return result;
  }, []);

  const refreshSettings = useCallback(async () => {
    const next = await api.settings.get();
    setSettings(next);
    return next;
  }, []);

  const updateSettings = useCallback(
    async (payload) => {
      const next = await api.settings.update(payload);
      setSettings(next);
      if (next.language && next.language !== i18n.language) {
        await i18n.changeLanguage(next.language);
      }
      return next;
    },
    [i18n],
  );

  const setLanguage = useCallback(
    async (lang) => {
      await i18n.changeLanguage(lang);
      applyDocumentLanguage(lang);
    },
    [i18n],
  );

  const clearSessionExpired = useCallback(() => {
    setSessionExpired(false);
    setSessionEndReason(null);
  }, []);

  const value = useMemo(
    () => ({
      user,
      settings,
      status,
      sessionExpired,
      sessionEndReason,
      language,
      login,
      logout,
      changePassword,
      refreshSettings,
      updateSettings,
      setLanguage,
      clearSessionExpired,
      isAdmin: user?.role === 'admin',
      isOffice: user?.role === 'office',
      isTeacher: user?.role === 'teacher',
      isStudent: user?.role === 'student',
      mustChangePassword: !!user?.mustChangePassword,
    }),
    [
      user,
      settings,
      status,
      sessionExpired,
      sessionEndReason,
      language,
      login,
      logout,
      changePassword,
      refreshSettings,
      updateSettings,
      setLanguage,
      clearSessionExpired,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

export default AuthContext;