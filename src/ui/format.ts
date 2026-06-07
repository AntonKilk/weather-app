// Display formatters for the weather UI.
//
// Pure functions, no I/O. All inputs come from the Open-Meteo response shape;
// we still defensively handle NaN / out-of-range values so a single bad number
// can't blank out the card.

export function formatTemperature(celsius: number): string {
  if (!Number.isFinite(celsius)) return '--°';
  return `${Math.round(celsius)}°`;
}

export function formatHumidity(percent: number): string {
  if (!Number.isFinite(percent)) return '--%';
  const clamped = Math.max(0, Math.min(100, percent));
  return `${Math.round(clamped)}%`;
}

export function formatWind(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '-- m/s';
  // Match the reference image style: integer for wind ≥ 10, one decimal below.
  const value = ms < 10 ? Math.round(ms * 10) / 10 : Math.round(ms);
  return `${value} m/s`;
}

/**
 * Open-Meteo timestamps come back as "YYYY-MM-DDTHH:MM" without a timezone
 * suffix (timezone is provided as a separate field). We just need the wall-clock
 * "HH:MM" portion for display — parse defensively and fall back to "--:--".
 */
export function formatTime(iso: string): string {
  if (typeof iso !== 'string') return '--:--';
  const match = /T(\d{2}):(\d{2})/.exec(iso);
  if (match === null) return '--:--';
  return `${match[1]}:${match[2]}`;
}

/**
 * Precipitation in millimetres → "0.4 mm" / "12 mm".
 * One decimal for < 10 mm, integer above. Negative or non-finite → "-- mm".
 */
export function formatPrecipMm(mm: number): string {
  if (!Number.isFinite(mm) || mm < 0) return '-- mm';
  const value = mm < 10 ? Math.round(mm * 10) / 10 : Math.round(mm);
  return `${value} mm`;
}

/**
 * Generic percent formatter: rounds and clamps 0..100, sentinel on bad input.
 * Used for precipitation probability and (later) any other percent display.
 */
export function formatPercent(percent: number): string {
  if (!Number.isFinite(percent)) return '--%';
  const clamped = Math.max(0, Math.min(100, percent));
  return `${Math.round(clamped)}%`;
}

const WEEKDAY_LABELS: ReadonlyArray<string> = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Extract a short weekday label from an Open-Meteo date string ("YYYY-MM-DD").
 *
 * Uses a fixed lookup table over `Date#getDay()` so behaviour is deterministic
 * across browsers and easy to unit-test (no `Intl.DateTimeFormat` locale drift).
 * When `opts.todayIso` matches the input (same `YYYY-MM-DD` prefix), returns
 * "Today" — the daily strip uses that to emphasise the current cell.
 */
export function formatWeekday(iso: string, opts?: { readonly todayIso?: string }): string {
  if (typeof iso !== 'string') return '--';
  const datePart = iso.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return '--';
  if (opts?.todayIso !== undefined && opts.todayIso.slice(0, 10) === datePart) {
    return 'Today';
  }
  // `Date(iso)` parses YYYY-MM-DD as UTC midnight; using getUTCDay keeps the
  // weekday stable regardless of the host timezone.
  const t = new Date(datePart);
  const dayIndex = t.getUTCDay();
  if (!Number.isInteger(dayIndex) || dayIndex < 0 || dayIndex > 6) return '--';
  return WEEKDAY_LABELS[dayIndex] ?? '--';
}
