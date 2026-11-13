import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { SearchX, ArrowLeft } from 'lucide-react';
import { Panel } from '../../components/ui/Panel';
import { PageHeader } from '../../components/ui/PageHeader';
import { MENUS } from '../../config/menu';
import { Button } from '../../components/ui/Button';

/**
 * Catch-all inside a workspace.
 *
 * Every module in the sidebar now has a real route, so reaching this screen
 * means the address simply does not exist for the signed-in role - it offers a
 * way back rather than promising a future phase.
 */
export function ComingSoon({ role }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const home = MENUS[role]?.home || '/';

  return (
    <>
      <PageHeader title={t('notFound.title')} subtitle={t('notFound.subtitle')} />

      <Panel className="flex flex-col items-center justify-center gap-4 py-20 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-[var(--color-line)] bg-[var(--glass-2)] text-[var(--color-dim)]">
          <SearchX size={22} />
        </div>
        <div>
          <p className="text-[15px] font-medium text-[var(--color-ink)]">{t('notFound.body')}</p>
          <p className="mt-1.5 max-w-md text-[13px] leading-relaxed text-[var(--color-muted)]">
            {t('notFound.hint')}
          </p>
        </div>
        <Button icon={ArrowLeft} onClick={() => navigate(home)}>
          {t('common.back')}
        </Button>
      </Panel>
    </>
  );
}

export default ComingSoon;
