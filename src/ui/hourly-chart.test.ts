import { describe, expect, it } from 'vitest';
import { MOCK_FORECASTS } from '../weather/mock-forecasts';
import type { HourlyForecast } from '../weather/types';
import {
  buildChartGeometry,
  DEFAULT_CHART_OPTIONS,
  type ChartOptions,
} from './hourly-chart';

function emptyHourly(): HourlyForecast {
  return {
    time: [],
    temperature_2m: [],
    precipitation: [],
    precipitation_probability: [],
    weather_code: [],
  };
}

function flatHourly(tempC: number): HourlyForecast {
  const time: string[] = [];
  for (let i = 0; i < 24; i++) {
    time.push(`2026-06-07T${String(i).padStart(2, '0')}:00:00`);
  }
  return {
    time,
    temperature_2m: time.map(() => tempC),
    precipitation: time.map(() => 0),
    precipitation_probability: time.map(() => 0),
    weather_code: time.map(() => 0),
  };
}

describe('buildChartGeometry', () => {
  it('returns 8 points sampled at 3-h cadence from a 24-h mock', () => {
    const hourly = MOCK_FORECASTS['mock-1']!.hourly;
    const geom = buildChartGeometry(hourly);
    expect(geom.points).toHaveLength(8);
  });

  it('places first and last points at the horizontal padding bounds', () => {
    const hourly = MOCK_FORECASTS['mock-1']!.hourly;
    const geom = buildChartGeometry(hourly);
    const { paddingX, width } = DEFAULT_CHART_OPTIONS;
    expect(geom.points[0]!.x).toBeCloseTo(paddingX, 5);
    expect(geom.points[geom.points.length - 1]!.x).toBeCloseTo(width - paddingX, 5);
  });

  it('keeps all y values inside [paddingTop, height - paddingBottom]', () => {
    const hourly = MOCK_FORECASTS['mock-1']!.hourly;
    const geom = buildChartGeometry(hourly);
    const { paddingTop, paddingBottom, height } = DEFAULT_CHART_OPTIONS;
    for (const p of geom.points) {
      expect(p.y).toBeGreaterThanOrEqual(paddingTop);
      expect(p.y).toBeLessThanOrEqual(height - paddingBottom);
    }
  });

  it('inverts the temperature axis (warmest → smallest y, coldest → largest y)', () => {
    const hourly = MOCK_FORECASTS['mock-1']!.hourly;
    const geom = buildChartGeometry(hourly);
    const sortedByTemp = [...geom.points].sort((a, b) => a.tempC - b.tempC);
    const coldest = sortedByTemp[0]!;
    const warmest = sortedByTemp[sortedByTemp.length - 1]!;
    expect(warmest.y).toBeLessThan(coldest.y);
  });

  it('flat-day: all points land on the vertical midline', () => {
    const geom = buildChartGeometry(flatHourly(15));
    const { paddingTop, paddingBottom, height } = DEFAULT_CHART_OPTIONS;
    const midY = paddingTop + (height - paddingTop - paddingBottom) / 2;
    for (const p of geom.points) {
      expect(p.y).toBeCloseTo(midY, 5);
    }
    expect(geom.minTempC).toBe(15);
    expect(geom.maxTempC).toBe(15);
  });

  it('drops samples whose temperature is NaN at the sampled index', () => {
    const hourly = MOCK_FORECASTS['mock-1']!.hourly;
    // Sampled indices are 0, 3, 6, 9, 12, 15, 18, 21. Corrupt index 6.
    const corrupted: HourlyForecast = {
      ...hourly,
      temperature_2m: hourly.temperature_2m.map((v, i) => (i === 6 ? Number.NaN : v)),
    };
    const geom = buildChartGeometry(corrupted);
    expect(geom.points).toHaveLength(7);
  });

  it('returns empty points and empty path for empty hourly input', () => {
    const geom = buildChartGeometry(emptyHourly());
    expect(geom.points).toEqual([]);
    expect(geom.pathD).toBe('');
  });

  it('honours custom options (width, height, paddingX)', () => {
    const opts: Partial<ChartOptions> = { width: 200, height: 80, paddingX: 10 };
    const geom = buildChartGeometry(MOCK_FORECASTS['mock-1']!.hourly, opts);
    expect(geom.width).toBe(200);
    expect(geom.height).toBe(80);
    expect(geom.points[0]!.x).toBeCloseTo(10, 5);
    expect(geom.points[geom.points.length - 1]!.x).toBeCloseTo(190, 5);
  });

  it('pathD starts with M at the first point and chains L per remaining point', () => {
    const geom = buildChartGeometry(MOCK_FORECASTS['mock-1']!.hourly);
    const tokens = geom.pathD.split(/\s+/);
    // 1 'M' + 2 numbers per point + (n-1) 'L' commands = 3 * n tokens.
    expect(tokens).toHaveLength(3 * geom.points.length);
    expect(tokens[0]).toBe('M');
    expect(Number(tokens[1])).toBeCloseTo(geom.points[0]!.x, 5);
    expect(Number(tokens[2])).toBeCloseTo(geom.points[0]!.y, 5);
    expect(tokens[3]).toBe('L');
  });
});
