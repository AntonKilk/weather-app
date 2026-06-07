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
