import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { KeyRound, TriangleAlert } from 'lucide-react';
import { useAuth } from '../../store/AuthProvider';
import { errorKey } from '../../lib/api';
import { Button } from '../../components/ui/Button';
import { PasswordInput } from '../../components/ui/Form';
import { PageHeader } from '../../components/ui/PageHeader';
import { Panel } from '../../components/ui/Panel';
import { useToast } from '../../components/ui/Toast';
import { ROLE_HOME } from '../../config/menu';

/**
 * Shared by every role (route: /<role>/change-password).
 * Also used as the forced first-login password change.
 */
export function ChangePasswordPage({ role }) {
  const { t } = useTranslation();
  const { changePassword, user, mustChangePassword } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const toast = useToast();

  const isFirstLogin = params.get('first') === '1' || mustChangePassword;

  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [loading, setLoading] = useState(false);

  const update = (key) => (event) => setForm((prev) => ({ ...prev, [key]: event.target.value }));

  const submit = async (event) => {
    event.preventDefault();
    if (loading) return;
    setErrors({});
    setFormError(null);

    const localErrors = {};
    if (!form.currentPassword) localErrors.currentPassword = t('validation.required');
    if (!form.newPassword || form.newPassword.length < 6) localErrors.newPassword = t('validation.passwordTooShort');
    if (form.newPassword !== form.confirmPassword) localErrors.confirmPassword = t('validation.passwordsDoNotMatch');
    if (Object.keys(localErrors).length) {
      setErrors(localErrors);
      return;
    }

    setLoading(true);
    try {
      await changePassword({ currentPassword: form.currentPassword, newPassword: form.newPassword });
      toast.success(t('auth.passwordChanged'));
      navigate(ROLE_HOME[role] || '/', { replace: true });
    } catch (err) {
      setFormError(t(errorKey(err)));
      if (err.fields) {
        setErrors({
          currentPassword: err.fields.currentPassword ? t(`validation.${err.fields.currentPassword}`) : null,
          newPassword: err.fields.newPassword ? t(`validation.${err.fields.newPassword}`) : null,
        });
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-[640px]">
      <PageHeader
        title={t('auth.mustChangeTitle')}
        subtitle={t('auth.mustChangeBody')}
      />

      {isFirstLogin && (
        <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-[color-mix(in_srgb,var(--color-warn)_40%,transparent)] bg-[color-mix(in_srgb,var(--color-warn)_10%,transparent)] p-3.5">
          <TriangleAlert size={16} className="mt-0.5 shrink-0 text-[var(--color-warn)]" />
          <p className="text-[12.5px] text-[var(--color-ink2)]">{t('auth.mustChangeBody')}</p>
        </div>
      )}

      <Panel>
        <form onSubmit={submit} className="flex flex-col gap-4">
          {formError && (
            <div className="rounded-xl border border-[color-mix(in_srgb,var(--color-danger)_45%,transparent)] bg-[color-mix(in_srgb,var(--color-danger)_12%,transparent)] p-3 text-[12.5px]">
              {formError}
            </div>
          )}

          <PasswordInput
            label={t('auth.currentPassword')}
            autoComplete="current-password"
            value={form.currentPassword}
            error={errors.currentPassword}
            onChange={update('currentPassword')}
            required
          />
          <PasswordInput
            label={t('auth.newPassword')}
            autoComplete="new-password"
            value={form.newPassword}
            error={errors.newPassword}
            hint="6 characters minimum"
            onChange={update('newPassword')}
            required
          />
          <PasswordInput
            label={t('auth.confirmPassword')}
            autoComplete="new-password"
            value={form.confirmPassword}
            error={errors.confirmPassword}
            onChange={update('confirmPassword')}
            required
          />

          <div className="mt-1 flex items-center justify-between gap-3">
            <p className="text-[11.5px] text-[var(--color-dim)]">
              {t('auth.signedInAs')}: <span className="text-[var(--color-muted)]">@{user?.username}</span>
            </p>
            <Button type="submit" variant="primary" icon={KeyRound} loading={loading}>
              {t('auth.changePassword')}
            </Button>
          </div>
        </form>
      </Panel>
    </div>
  );
}

export default ChangePasswordPage;