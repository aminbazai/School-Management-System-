import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/ur';

dayjs.extend(relativeTime);

export { dayjs };

/** Locale-aware short date, e.g. 09 Oct 2026 / 09 اکتوبر 2026 */
export function formatDate(value, lang = 'en') {
  if (!value) return '-';
  const locale = lang === 'ur' ? 'ur' : 'en-gb';
  return dayjs(value).locale(locale).format(locale === 'ur' ? 'D MMM YYYY' : 'DD MMM YYYY');
}

export function formatDateTime(value, lang = 'en') {
  if (!value) return '-';
  const locale = lang === 'ur' ? 'ur' : 'en-gb';
  return dayjs(value).locale(locale).format(locale === 'ur' ? 'D MMM YYYY, h:mm A' : 'DD MMM YYYY, hh:mm A');
}

export function formatMonth(month) {
  if (!month) return '-';
  return dayjs(`${month}-01`).format('MMMM YYYY');
}

export function formatNumber(value, locale = 'en-US') {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '-';
  return new Intl.NumberFormat(locale).format(Number(value));
}

export function formatCurrency(value, symbol = 'Rs') {
  const amount = Number(value || 0);
  return `${symbol} ${formatNumber(Math.round(amount * 100) / 100)}`;
}

export function formatPercent(value, digits = 1) {
  if (value === null || value === undefined) return '-';
  return `${Number(value).toFixed(digits)}%`;
}

/** "3 min ago" style label, translated through the time.* keys. */
export function formatRelative(value, t) {
  if (!value) return '-';
  const diffMinutes = dayjs(value).diff(dayjs(), 'minute');
  if (diffMinutes < 1) return t('time.justNow');
  if (diffMinutes < 60) return t('time.minutesAgo', { count: diffMinutes });
  const diffHours = dayjs(value).diff(dayjs(), 'hour');
  if (diffHours < 24) return t('time.hoursAgo', { count: diffHours });
  return t('time.daysAgo', { count: dayjs(value).diff(dayjs(), 'day') });
}

export function initialsOf(name = '') {
  return (
    name
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase())
      .join('') || '?'
  );
}

export default { formatDate, formatDateTime, formatMonth, formatNumber, formatCurrency, formatPercent };