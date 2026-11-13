import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { GraduationCap, LogIn, ShieldCheck, TriangleAlert, CheckCircle2 } from 'lucide-react';
import { useAuth } from '../../store/AuthProvider';
import api, { errorKey } from '../../lib/api';
import { Button } from '../../components/ui/Button';
import { PasswordInput, Input } from '../../components/ui/Form';
import { LANGUAGES } from '../../i18n';
import { ROLE_HOME } from '../../config/menu';

export function LoginPage() {
  const { t, i18n } = useTranslation();
  const { login, status, sessionExpired, sessionEndReason, setLanguage, settings, user } = useAuth();
  const navigate = useNavigate();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [appInfo, setAppInfo] = useState(null);

  useEffect(() => {
    document.documentElement.dataset.accent = 'admin';
  }, []);

  // The school name and the version are shown before anybody signs in.
  useEffect(() => {
    let active = true;
    api.app
      .getInfo()
      .then((info) => active && setAppInfo(info))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  if (status === 'authed' && user) return <Navigate to={ROLE_HOME[user.role] || '/login'} replace />;

  const submit = async (event) => {
    event.preventDefault();
    if (loading) return;
    setError(null);
    setFieldErrors({});
    setLoading(true);

    try {
      const result = await login(username.trim(), password);
      const nextUser = result.user;
      navigate(ROLE_HOME[nextUser.role] || '/login', { replace: true });
    } catch (err) {
      setError(err);
      if (err.fields) {
        setFieldErrors({
          username: err.fields.username ? `validation.${err.fields.username}` : null,
          password: err.fields.password ? `validation.${err.fields.password}` : null,
        });
      }
    } finally {
      setLoading(false);
    }
  };

  const errorMessage = error ? t(errorKey(error)) : null;

  return (
    <div className="app-bg flex h-screen w-screen items-center justify-center overflow-hidden px-6" data-accent="admin">
      {/* ambient glows */}
      <div className="pointer-events-none absolute -top-40 end-[-10%] h-[560px] w-[560px] rounded-full bg-[color-mix(in_srgb,var(--accent)_22%,transparent)] blur-[120px]" />
      <div className="pointer-events-none absolute bottom-[-20%] start-[-8%] h-[420px] w-[420px] rounded-full bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] blur-[110px]" />

      <div className="relative w-full max-w-[920px] overflow-hidden rounded-3xl border border-[var(--color-line)] bg-[var(--color-surface)]/70 shadow-[0_40px_120px_-40px_rgba(0,0,0,0.9)] backdrop-blur-2xl">
        <div className="grid md:grid-cols-[1.05fr_1fr]">
          {/* Brand side */}
          <div className="relative hidden flex-col justify-center gap-10 border-e border-[var(--color-line)] bg-[var(--glass)] p-9 md:flex">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-b from-[var(--accent-2)] to-[var(--accent)] text-white shadow-[0_10px_24px_-10px_var(--accent)]">
                <GraduationCap size={22} strokeWidth={2.2} />
              </div>
              <div>
                <p className="text-[15px] font-semibold tracking-tight">
                  {appInfo?.settings?.school_name || settings?.school_name || t('app.name')}
                </p>
                <p className="text-[11.5px] text-[var(--color-dim)]">{t('app.tagline')}</p>
              </div>
            </div>

            <div>
              <h2 className="text-[26px] font-semibold leading-tight tracking-tight">{t('app.tagline')}</h2>
              <ul className="mt-6 flex flex-col gap-2.5">
                {['point1', 'point2', 'point3'].map((point) => (
                  <li key={point} className="flex items-start gap-2.5 text-[12.5px] leading-relaxed text-[var(--color-muted)]">
                    <CheckCircle2 size={14} className="mt-[3px] shrink-0 text-[var(--accent)]" />
                    {t(`auth.${point}`)}
                  </li>
                ))}
              </ul>
              <div className="mt-6 flex items-center gap-2 text-[11.5px] text-[var(--color-dim)]">
                <ShieldCheck size={14} className="text-[var(--color-ok)]" />
                {t('auth.securityNote')}
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {['admin', 'office', 'teacher', 'student'].map((role) => (
                <span key={role} className="chip">
                  {t(`roles.${role}`)}
                </span>
              ))}
              {appInfo?.version && (
                <span className="no-urdu ms-auto self-center text-[11px] text-[var(--color-dim)]">
                  v{appInfo.version}
                </span>
              )}
            </div>
          </div>

          {/* Form side */}
          <div className="p-8 sm:p-10">
            <div className="mb-6 flex items-center justify-between">
              <div className="md:hidden">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-b from-[var(--accent-2)] to-[var(--accent)] text-white">
                  <GraduationCap size={19} />
                </div>
              </div>
              <div className="segment ms-auto">
                {LANGUAGES.map((lang) => (
                  <button
                    key={lang.code}
                    type="button"
                    onClick={() => setLanguage(lang.code)}
                    className={`segment-item ${i18n.language === lang.code ? 'segment-item-active' : ''}`}
                  >
                    {lang.short}
                  </button>
                ))}
              </div>
            </div>

            <h1 className="text-[24px] font-semibold tracking-tight">{t('auth.title')}</h1>
            <p className="mt-1.5 text-[13px] text-[var(--color-muted)]">{t('auth.subtitle')}</p>

            {sessionExpired && (
              <div className="mt-5 flex items-start gap-2.5 rounded-xl border border-[color-mix(in_srgb,var(--color-warn)_40%,transparent)] bg-[color-mix(in_srgb,var(--color-warn)_10%,transparent)] p-3">
                <TriangleAlert size={16} className="mt-0.5 shrink-0 text-[var(--color-warn)]" />
                <div>
                  <p className="text-[12.5px] font-medium text-[var(--color-ink)]">
                    {sessionEndReason === 'data_cleared'
                      ? t('auth.dataCleared')
                      : sessionEndReason === 'factory_reset'
                        ? t('auth.factoryReset')
                        : t('auth.sessionExpired')}
                  </p>
                  <p className="text-[11.5px] text-[var(--color-muted)]">
                    {sessionEndReason === 'data_cleared'
                      ? t('auth.dataClearedBody')
                      : sessionEndReason === 'factory_reset'
                        ? t('auth.factoryResetBody')
                        : t('auth.sessionExpiredBody')}
                  </p>
                </div>
              </div>
            )}

            {errorMessage && (
              <div
                role="alert"
                className="mt-5 rounded-xl border border-[color-mix(in_srgb,var(--color-danger)_45%,transparent)] bg-[color-mix(in_srgb,var(--color-danger)_12%,transparent)] p-3 text-[12.5px] text-[var(--color-ink)]"
              >
                {error?.seconds
                  ? t('errors.ACCOUNT_LOCKED', { seconds: Math.ceil(error.seconds / 60) })
                  : errorMessage}
              </div>
            )}

            <form onSubmit={submit} className="mt-6 flex flex-col gap-4">
              <Input
                label={t('auth.username')}
                placeholder={t('auth.usernamePlaceholder')}
                icon={null}
                autoComplete="username"
                autoFocus
                value={username}
                error={fieldErrors.username ? t(fieldErrors.username) : null}
                onChange={(e) => setUsername(e.target.value)}
              />
              <PasswordInput
                label={t('auth.password')}
                placeholder={t('auth.passwordPlaceholder')}
                autoComplete="current-password"
                value={password}
                error={fieldErrors.password ? t(fieldErrors.password) : null}
                onChange={(e) => setPassword(e.target.value)}
              />

              <Button type="submit" variant="primary" size="lg" loading={loading} className="mt-1 w-full">
                {loading ? t('auth.signingIn') : t('auth.signIn')}
                {!loading && <LogIn size={16} />}
              </Button>
            </form>

          </div>
        </div>
      </div>
    </div>
  );
}

export default LoginPage;