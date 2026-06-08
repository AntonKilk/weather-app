export function formatTemperature(celsius: number): string {
  return `${Math.round(celsius)}°`;
}

export function formatHumidity(percent: number): string {
  return `${Math.round(percent)}%`;
}

export function formatWind(metersPerSecond: number): string {
  const rounded = Math.round(metersPerSecond * 10) / 10;
  const display = Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1);
  return `${display} m/s`;
}

export function formatHourLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return `${String(date.getHours()).padStart(2, '0')}:00`;
}

const WEEKDAY_FORMATTER = new Intl.DateTimeFormat('en-US', { weekday: 'short' });

function calendarDate(iso: string): string | null {
  // Accept both 'YYYY-MM-DD' and full ISO; collapse to the calendar-date prefix.
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatWeekdayShort(iso: string, todayIso?: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  if (todayIso !== undefined) {
    const target = calendarDate(iso);
    const today = calendarDate(todayIso);
    if (target !== null && today !== null && target === today) {
      return 'Today';
    }
  }
  return WEEKDAY_FORMATTER.format(date);
}
