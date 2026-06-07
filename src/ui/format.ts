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
