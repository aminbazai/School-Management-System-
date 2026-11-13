import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { Bell, ChevronDown, KeyRound, LogOut, Moon, Sun } from 'lucide-react';
import { LANGUAGES } from '../../i18n';
import { useAuth } from '../../store/AuthProvider';
import { MENUS } from '../../config/menu';

function initials(name = '') {
  return (
    name
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase())
      .join('') || '?'
  );
}

function useOutsideClick(handler) {
  const ref = useRef(null);
  useEffect(() => {
    const listener = (event) => {
      if (ref.current && !ref.current.contains(event.target)) handler();
    };
    document.addEventListener('mousedown', listener);
    return () => document.removeEventListener('mousedown', listener);
  }, [handler]);
  return ref;
}

export function TopBar({ role }) {
  const { t, i18n } = useTranslation();
  const { user, settings, setLanguage, logout, updateSettings } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const closeRef = useOutsideClick(() => setMenuOpen(false));

  // Longest match wins, so /office/staff-attendance does not resolve to /office/staff
  const config = MENUS[role];
  const current = config?.groups
    .flatMap((g) => g.items)
    .filter((item) => location.pathname === item.to || location.pathname.startsWith(`${item.to}/`))
    .sort((a, b) => b.to.length - a.to.length)[0];
  const title = current ? t(current.labelKey) : t('topbar.dashboard');

  const changePasswordPath = role === 'admin' ? '/admin/change-password' : `/${role}/change-password`;
  const isDark = (settings?.theme || 'dark') !== 'light';

  const toggleTheme = () => {
    const theme = isDark ? 'light' : 'dark';
    updateSettings({ theme }).catch(() => {});
  };

  const handleSignOut = async () => {
    setMenuOpen(false);
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <header className="flex h-[68px] shrink-0 items-center gap-4 border-b border-[var(--color-line)] bg-[var(--color-surface)]/55 px-6 backdrop-blur-xl">
      <div className="min-w-0 flex-1">
        <p className="eyebrow">{t('app.name')}</p>
        <h1 className="truncate text-[15px] font-semibold tracking-tight text-[var(--color-ink)]">{title}</h1>
      </div>

      {/* Language switch (pill segment, like the reference design) */}
      <div className="segment" role="group" aria-label={t('topbar.language')}>
        {LANGUAGES.map((lang) => (
          <button
            key={lang.code}
            type="button"
            onClick={() => setLanguage(lang.code)}
            className={clsx('segment-item', i18n.language === lang.code && 'segment-item-active')}
          >
            {lang.short}
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={toggleTheme}
        title={isDark ? t('settings.light') : t('settings.dark')}
        className="flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--color-line)] bg-[var(--glass)] text-[var(--color-muted)] transition hover:text-[var(--color-ink)]"
      >
        {isDark ? <Sun size={16} /> : <Moon size={16} />}
      </button>

      <button
        type="button"
        title={t('topbar.notifications')}
        className="relative flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--color-line)] bg-[var(--glass)] text-[var(--color-muted)] transition hover:text-[var(--color-ink)]"
      >
        <Bell size={16} />
        <span className="absolute end-2 top-2 h-1.5 w-1.5 rounded-full bg-[var(--color-danger)]" />
      </button>

      {/* Account menu */}
      <div className="relative" ref={closeRef}>
        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          className="flex h-10 items-center gap-2 rounded-xl border border-[var(--color-line)] bg-[var(--glass)] ps-1 pe-2.5 transition hover:border-[var(--color-line2)]"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-b from-[var(--accent-2)] to-[var(--accent)] text-[11.5px] font-semibold text-white">
            {initials(user?.displayName || user?.username)}
          </span>
          <span className="hidden text-start lg:block">
            <span className="block max-w-[130px] truncate text-[12.5px] font-medium leading-tight text-[var(--color-ink)]">
              {user?.displayName}
            </span>
            <span className="block text-[10.5px] leading-tight text-[var(--color-dim)]">{t(`roles.${role}`)}</span>
          </span>
          <ChevronDown size={14} className="text-[var(--color-dim)]" />
        </button>

        {menuOpen && (
          <div className="panel-solid animate-in absolute end-0 top-12 w-56 overflow-hidden p-1.5">
            <div className="px-2.5 py-2">
              <p className="truncate text-[12.5px] font-medium">{user?.displayName}</p>
              <p className="truncate text-[11px] text-[var(--color-dim)]" dir="ltr">
                {user?.username}
              </p>
            </div>
            <div className="my-1 h-px bg-[var(--color-line)]" />
            <Link
              to={changePasswordPath}
              onClick={() => setMenuOpen(false)}
              className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[12.5px] text-[var(--color-ink2)] transition hover:bg-[var(--glass-2)]"
            >
              <KeyRound size={14} />
              {t('topbar.changePassword')}
            </Link>
            <button
              type="button"
              onClick={handleSignOut}
              className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[12.5px] text-[var(--color-danger)] transition hover:bg-[color-mix(in_srgb,var(--color-danger)_14%,transparent)]"
            >
              <LogOut size={14} />
              {t('topbar.signOut')}
            </button>
          </div>
        )}
      </div>
    </header>
  );
}

export default TopBar;