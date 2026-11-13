import { useMemo } from 'react';
import { NavLink } from 'react-router-dom';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { GraduationCap, LogOut, KeyRound } from 'lucide-react';
import { MENUS } from '../../config/menu';

const QUICK_TILES = {
  admin: ['/admin/attendance', '/admin/fees', '/admin/backup'],
  office: ['/office/fees', '/office/salary', '/office/reports'],
  teacher: ['/teacher/attendance', '/teacher/marks', '/teacher/timetable'],
  student: ['/student/results', '/student/fees', '/student/timetable'],
};

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

export function Sidebar({ role, user, onSignOut }) {
  const { t } = useTranslation();
  const config = MENUS[role];
  const quickLinks = useMemo(() => QUICK_TILES[role] || [], [role]);

  if (!config) return null;

  const allItems = config.groups.flatMap((g) => g.items);
  const quickItems = quickLinks
    .map((to) => allItems.find((item) => item.to === to))
    .filter(Boolean);

  return (
    <aside className="flex h-full w-[264px] shrink-0 flex-col border-e border-[var(--color-line)] bg-[var(--color-surface)]/70 backdrop-blur-xl">
      {/* Brand */}
      <div className="flex items-center gap-3 px-5 py-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-b from-[var(--accent-2)] to-[var(--accent)] text-white shadow-[0_8px_18px_-8px_var(--accent)]">
          <GraduationCap size={18} strokeWidth={2.4} />
        </div>
        <div className="min-w-0">
          <p className="truncate text-[13.5px] font-semibold leading-tight text-[var(--color-ink)]">
            {user?.schoolName || t('app.name')}
          </p>
          <p className="truncate text-[11px] text-[var(--color-dim)]">{t(`roles.${role}`)}</p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        {config.groups.map((group) => (
          <div key={group.labelKey} className="mb-4">
            <p className="eyebrow px-3 pb-2">{t(group.labelKey)}</p>
            <div className="flex flex-col gap-0.5">
              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) => clsx('nav-item', isActive && 'nav-item-active')}
                >
                  <item.icon size={16} strokeWidth={2.1} className="nav-icon shrink-0 text-[var(--color-dim)]" />
                  <span className="flex-1 truncate">{t(item.labelKey)}</span>
                  {item.phase > 1 && !item.done && (
                    <span className="no-urdu chip h-[18px] px-1.5 text-[10px] text-[var(--color-dim)]">
                      P{item.phase}
                    </span>
                  )}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* Quick access */}
      {quickItems.length > 0 && (
        <div className="px-3 pb-4">
          <p className="eyebrow px-3 pb-2">{t('dash.quickAccess')}</p>
          <div className="grid grid-cols-3 gap-2 px-1">
            {quickItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                title={t(item.labelKey)}
                className="flex h-[58px] flex-col items-center justify-center gap-1.5 rounded-xl border border-[var(--color-line)] bg-[var(--glass)] text-[var(--color-muted)] transition hover:border-[var(--color-line2)] hover:text-[var(--color-ink)]"
              >
                <item.icon size={17} strokeWidth={2} />
                <span className="w-full truncate px-1 text-center text-[10px]">{t(item.labelKey)}</span>
              </NavLink>
            ))}
          </div>
        </div>
      )}

      {/* User card */}
      <div className="border-t border-[var(--color-line)] p-3">
        <div className="flex items-center gap-2.5 rounded-xl px-2 py-2">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[var(--color-line2)] bg-[var(--glass-2)] text-[12px] font-semibold text-[var(--color-ink)]">
            {initials(user?.displayName || user?.username)}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12.5px] font-medium text-[var(--color-ink)]">{user?.displayName}</p>
            <p className="truncate text-[11px] text-[var(--color-dim)]" dir="ltr">
              @{user?.username}
            </p>
          </div>
          <NavLink
            to={role === 'admin' ? '/admin/change-password' : `/${role}/change-password`}
            title={t('topbar.changePassword')}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--color-dim)] transition hover:bg-[var(--glass-2)] hover:text-[var(--color-ink)]"
          >
            <KeyRound size={15} />
          </NavLink>
          <button
            type="button"
            onClick={onSignOut}
            title={t('topbar.signOut')}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--color-dim)] transition hover:bg-[color-mix(in_srgb,var(--color-danger)_18%,transparent)] hover:text-[var(--color-danger)]"
          >
            <LogOut size={15} />
          </button>
        </div>
      </div>
    </aside>
  );
}

export default Sidebar;