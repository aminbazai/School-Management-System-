import { useCallback } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { useAuth } from '../../store/AuthProvider';
import { MENUS } from '../../config/menu';

/**
 * Shared shell for every role. The four role layouts only differ by their
 * menu + accent colour, so they stay a few lines each.
 */
export function AppShell({ role }) {
  const { user, settings, logout } = useAuth();
  const navigate = useNavigate();

  const handleSignOut = useCallback(async () => {
    await logout();
    navigate('/login', { replace: true });
  }, [logout, navigate]);

  const shellUser = { ...user, schoolName: settings?.school_name };

  return (
    <div className="app-bg flex h-screen w-screen overflow-hidden text-[var(--color-ink)]" data-accent={MENUS[role]?.accent || 'admin'}>
      <Sidebar role={role} user={shellUser} onSignOut={handleSignOut} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar role={role} />
        <main className="min-h-0 flex-1 overflow-y-auto px-7 py-6">
          <div className="mx-auto w-full max-w-[1400px]">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}

export default AppShell;