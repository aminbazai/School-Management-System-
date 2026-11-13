import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Panel } from '../../components/ui/Panel';
import { Button } from '../../components/ui/Button';
import { useAuth } from '../../store/AuthProvider';

export function NotFound() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAuth();

  return (
    <div className="flex h-screen w-screen items-center justify-center app-bg" data-accent="admin">
      <Panel className="w-[420px] text-center">
        <p className="text-[46px] font-semibold leading-none tracking-tight">404</p>
        <p className="mt-3 text-[14px] text-[var(--color-muted)]">{t('common.noData')}</p>
        <Button
          className="mt-5"
          variant="primary"
          onClick={() => navigate(user ? `/${user.role}/dashboard` : '/login')}
        >
          {t('common.back')}
        </Button>
      </Panel>
    </div>
  );
}

export default NotFound;