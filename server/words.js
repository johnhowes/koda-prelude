/**
 * Times and text as the words pages show. Imports nothing, so any part may
 * use it.
 */

/** "just now", "4 minutes ago", "yesterday", "2 months ago". */
export function ago(iso, now = Date.now()) {
  const minutes = Math.floor(Math.max(0, now - Date.parse(iso)) / 60000);
  const count = (n, unit) => `${n} ${unit}${n === 1 ? '' : 's'} ago`;
  if (!Number.isFinite(minutes)) return 'a while ago';
  if (minutes < 1) return 'just now';
  if (minutes < 60) return count(minutes, 'minute');
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return count(hours, 'hour');
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  if (days < 30) return count(days, 'day');
  if (days < 365) return count(Math.floor(days / 30), 'month');
  return count(Math.floor(days / 365), 'year');
}
