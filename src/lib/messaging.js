import i18n from 'i18next';

/**
 * Free messaging deep links (WhatsApp / email / SMS).
 *
 * These links are opened by the main process through `api.messaging.openLink`.
 * Nothing here needs an API key or a paid gateway - the device's own apps do
 * the delivery.
 */

/** Strips formatting and adds Pakistan's country code to local 03xx numbers. */
export function phoneForLink(raw) {
  let digits = String(raw || '').replace(/[^\d]/g, '');
  if (!digits) return '';
  if (digits.startsWith('00')) digits = digits.slice(2);
  else if (digits.startsWith('0')) digits = `92${digits.slice(1)}`;
  else if (digits.length === 10 && digits.startsWith('3')) digits = `92${digits}`;
  return digits;
}

export function whatsappUrl(phone, text) {
  const number = phoneForLink(phone);
  if (!number) return null;
  return `https://wa.me/${number}?text=${encodeURIComponent(text || '')}`;
}

export function smsUrl(phone, text) {
  const number = phoneForLink(phone);
  if (!number) return null;
  return `sms:+${number}?body=${encodeURIComponent(text || '')}`;
}

export function mailtoUrl({ to, bcc, subject, body }) {
  const parts = [];
  if (subject) parts.push(`subject=${encodeURIComponent(subject)}`);
  if (body) parts.push(`body=${encodeURIComponent(body)}`);
  if (bcc) parts.push(`bcc=${encodeURIComponent(bcc)}`);
  const query = parts.length ? `?${parts.join('&')}` : '';
  return `mailto:${to || ''}${query}`;
}

/** Replaces {{placeholders}} with values; unknown placeholders are kept. */
export function renderTemplate(template, vars = {}) {
  return String(template || '').replace(/\{\{\s*([a-zA-Z_]+)\s*\}\}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(vars, key) && vars[key] !== undefined && vars[key] !== null
      ? String(vars[key])
      : match,
  );
}

/**
 * Renders a message for a group (bulk email / printed checks) where a single
 * value cannot be known, then removes placeholders that stayed unresolved so
 * recipients never see "{{student}}" in the text.
 */
export function cleanTemplate(template, vars = {}) {
  return renderTemplate(template, vars)
    .replace(/\{\{\s*[a-zA-Z_]+\s*\}\}/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/** Locale-aware "November 2026" label for a stored YYYY-MM month. */
export function monthLabel(month) {
  if (!month) return '';
  const [year, index] = String(month).split('-');
  const date = new Date(Number(year), Math.max(0, Number(index) - 1), 1);
  if (Number.isNaN(date.getTime())) return month;
  return date.toLocaleString(i18n.resolvedLanguage === 'ur' ? 'ur-PK' : 'en-US', {
    month: 'long',
    year: 'numeric',
  });
}

/**
 * Opens links one at a time so WhatsApp / the mail client is not flooded and
 * the user can follow the chat list. Resolves when the loop finishes.
 */
export async function openSequentially(items, open, gap = 650) {
  for (const item of items) {
    // eslint-disable-next-line no-await-in-loop
    await open(item);
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, gap));
  }
}
