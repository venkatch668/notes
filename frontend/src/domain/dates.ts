/** Day-key helpers. Every date in the system is a local ISO day string. */

export function toKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function fromKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function todayKey(): string {
  return toKey(new Date());
}

export function addDays(key: string, n: number): string {
  const d = fromKey(key);
  d.setDate(d.getDate() + n);
  return toKey(d);
}

/** Monday-based start of week. */
export function startOfWeek(key: string): string {
  const d = fromKey(key);
  const offset = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - offset);
  return toKey(d);
}

export function startOfMonth(key: string): string {
  const d = fromKey(key);
  return toKey(new Date(d.getFullYear(), d.getMonth(), 1));
}

export function endOfMonth(key: string): string {
  const d = fromKey(key);
  return toKey(new Date(d.getFullYear(), d.getMonth() + 1, 0));
}

export function rangeDays(from: string, to: string): string[] {
  const out: string[] = [];
  let cur = from;
  while (cur <= to) {
    out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}

const LONG = new Intl.DateTimeFormat(undefined, {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
  year: 'numeric',
});

const SHORT = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });

export function formatLong(key: string): string {
  return LONG.format(fromKey(key));
}

export function formatShort(key: string): string {
  return SHORT.format(fromKey(key));
}

export function formatTime(ts: number): string {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(ts);
}

export function relativeLabel(key: string): string | null {
  const t = todayKey();
  if (key === t) return 'Today';
  if (key === addDays(t, -1)) return 'Yesterday';
  if (key === addDays(t, 1)) return 'Tomorrow';
  return null;
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/**
 * Resolve the `@…` due-date token. Supports `@today`, `@tomorrow`, `@mon`…`@sun`
 * (next occurrence), and an explicit `@YYYY-MM-DD`. Returns null if unparseable,
 * which leaves the raw token in the text rather than guessing.
 */
export function resolveDueToken(raw: string, base = todayKey()): string | null {
  const v = raw.toLowerCase();
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  if (v === 'today') return base;
  if (v === 'tomorrow' || v === 'tmw') return addDays(base, 1);
  if (v === 'yesterday') return addDays(base, -1);

  const idx = WEEKDAYS.findIndex((w) => w === v || w.slice(0, 3) === v);
  if (idx >= 0) {
    const cur = fromKey(base).getDay();
    const delta = (idx - cur + 7) % 7 || 7;
    return addDays(base, delta);
  }
  return null;
}

/** `2h`, `30m`, `1h30m` → minutes. */
export function parseDuration(raw: string): number | null {
  const m = /^(?:(\d+(?:\.\d+)?)h)?(?:(\d+)m)?$/.exec(raw.toLowerCase());
  if (!m || (!m[1] && !m[2])) return null;
  return Math.round((Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0)));
}

export function formatDuration(min: number): string {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const r = min % 60;
  return r ? `${h}h${r}m` : `${h}h`;
}
