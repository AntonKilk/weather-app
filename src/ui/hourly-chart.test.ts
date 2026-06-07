// Pure-function tests for the hourly-chart projection.
//
// Covers Acceptance Criterion: «расчёт точек кривой (нормализация температур в
// координаты) покрыт unit-тестами» (STORY-003).

import { describe, expect, it } from 'vitest';
import type { OpenMeteoHourly } from '../weather/types';
import {
  projectHourlyChart,
  renderHourlyChart,
  renderPrecipRow,
  selectHourlySamples,
  type HourlySample,
} from './hourly-chart';

function makeHourly(
  times: ReadonlyArray<string>,
  temps: ReadonlyArray<number>,
  precip: ReadonlyArray<number> = [],
  precipProb: ReadonlyArray<number> = [],
  codes: ReadonlyArray<number> = [],
): OpenMeteoHourly {
  return {
    time: times,
    temperature_2m: temps,
    precipitation: precip.length > 0 ? precip : times.map(() => 0),
    precipitation_probability:
      precipProb.length > 0 ? precipProb : times.map(() => 0),
    weather_code: codes.length > 0 ? codes : times.map(() => 0),
  };
}

function makeIsoSequence(count: number): ReadonlyArray<string> {
  const out: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const hh = String(i).padStart(2, '0');
    out.push(`2026-06-07T${hh}:00`);
  }
  return out;
}

describe('selectHourlySamples', () => {
  it('picks 8 evenly-spaced entries from a 24-length input (step ≈ 3)', () => {
    const times = makeIsoSequence(24);
    const temps = times.map((_, i) => i);
    const samples = selectHourlySamples(makeHourly(times, temps), 8);
    expect(samples.length).toBe(8);
    // First and last samples anchor to index 0 and index 23.
    expect(samples[0]?.time).toBe('2026-06-07T00:00');
    expect(samples[7]?.time).toBe('2026-06-07T23:00');
    // Spacing should be roughly 3 hours (round((i * 23) / 7)).
    const indices = samples.map((s) => Number(s.time.slice(11, 13)));
    expect(indices).toEqual([0, 3, 7, 10, 13, 16, 20, 23]);
  });

  it('returns at most `count` samples when input is shorter', () => {
    const times = makeIsoSequence(4);
    const temps = [10, 11, 12, 13];
    const samples = selectHourlySamples(makeHourly(times, temps), 8);
    expect(samples.length).toBe(4);
    expect(samples[0]?.tempC).toBe(10);
    expect(samples[3]?.tempC).toBe(13);
  });

  it('returns an empty array on empty hourly input', () => {
    const samples = selectHourlySamples(makeHourly([], []), 8);
    expect(samples).toEqual([]);
  });

  it('carries precipitation fields onto samples', () => {
    const times = makeIsoSequence(4);
    const temps = [10, 11, 12, 13];
    const precip = [0, 0.5, 1.2, 0];
    const prob = [0, 25, 60, 10];
    const samples = selectHourlySamples(
      makeHourly(times, temps, precip, prob),
      4,
    );
    expect(samples.map((s) => s.precipMm)).toEqual([0, 0.5, 1.2, 0]);
    expect(samples.map((s) => s.precipProb)).toEqual([0, 25, 60, 10]);
  });
});

describe('projectHourlyChart — normalisation', () => {
  it('returns empty geometry for fewer than 2 valid points', () => {
    const geo = projectHourlyChart([]);
    expect(geo.points).toEqual([]);
    expect(geo.pathD).toBe('');
    expect(geo.areaPathD).toBe('');
  });

  it('treats flat data as a 2°C span (all y equal within epsilon)', () => {
    const samples: HourlySample[] = [
      { time: 't1', tempC: 20 },
      { time: 't2', tempC: 20 },
      { time: 't3', tempC: 20 },
    ];
    const geo = projectHourlyChart(samples);
    expect(geo.points.length).toBe(3);
    const ys = geo.points.map((p) => p.y);
    const allEqual = ys.every((y) => Math.abs(y - (ys[0] ?? 0)) < 1e-6);
    expect(allEqual).toBe(true);
    // Span around the value, midline at half the usable height.
    expect(geo.minTemp).toBeCloseTo(19, 5);
    expect(geo.maxTemp).toBeCloseTo(21, 5);
  });

  it('places min-temp point at the largest y (SVG y grows downward)', () => {
    const samples: HourlySample[] = [
      { time: 't1', tempC: 15 },
      { time: 't2', tempC: 25 },
      { time: 't3', tempC: 10 }, // min
      { time: 't4', tempC: 22 },
    ];
    const geo = projectHourlyChart(samples);
    const ys = geo.points.map((p) => p.y);
    const minIdx = samples.findIndex((s) => s.tempC === 10);
    const maxIdx = samples.findIndex((s) => s.tempC === 25);
    const yMin = ys[minIdx];
    const yMax = ys[maxIdx];
    if (yMin === undefined || yMax === undefined) throw new Error('missing y');
    // Higher y = visually lower position = colder temperature.
    expect(yMin).toBeGreaterThan(yMax);
    expect(yMin).toBe(Math.max(...ys));
    expect(yMax).toBe(Math.min(...ys));
  });

  it('keeps x coordinates inside paddingX bounds and monotonically non-decreasing', () => {
    const samples: HourlySample[] = Array.from({ length: 6 }, (_, i) => ({
      time: `t${i}`,
      tempC: 10 + i,
    }));
    const geo = projectHourlyChart(samples, { width: 600, paddingX: 24 });
    const xs = geo.points.map((p) => p.x);
    // First and last anchor exactly to the padding bounds.
    expect(xs[0]).toBeCloseTo(24, 5);
    expect(xs[xs.length - 1]).toBeCloseTo(576, 5);
    for (const x of xs) {
      expect(x).toBeGreaterThanOrEqual(24);
      expect(x).toBeLessThanOrEqual(576);
    }
    for (let i = 1; i < xs.length; i += 1) {
      const prev = xs[i - 1];
      const curr = xs[i];
      if (prev === undefined || curr === undefined) throw new Error('missing x');
      expect(curr).toBeGreaterThanOrEqual(prev);
    }
  });

  it('pathD starts with "M" and includes one cubic segment per remaining point', () => {
    const samples: HourlySample[] = [
      { time: 't1', tempC: 15 },
      { time: 't2', tempC: 17 },
      { time: 't3', tempC: 14 },
      { time: 't4', tempC: 16 },
    ];
    const geo = projectHourlyChart(samples);
    expect(geo.pathD.startsWith('M ')).toBe(true);
    const cSegments = geo.pathD.match(/ C /g) ?? [];
    expect(cSegments.length).toBe(samples.length - 1);
  });

  it('filters non-finite temps before projecting (degrades to empty if too few remain)', () => {
    const samples: HourlySample[] = [
      { time: 't1', tempC: Number.NaN },
      { time: 't2', tempC: 18 },
      { time: 't3', tempC: Number.POSITIVE_INFINITY },
    ];
    const geo = projectHourlyChart(samples);
    expect(geo.points.length).toBe(0);
    expect(geo.pathD).toBe('');
  });

  it('respects custom width/height/padding options', () => {
    const samples: HourlySample[] = [
      { time: 't1', tempC: 10 },
      { time: 't2', tempC: 12 },
    ];
    const geo = projectHourlyChart(samples, {
      width: 400,
      height: 100,
      paddingTop: 10,
      paddingBottom: 10,
      paddingX: 20,
    });
    expect(geo.width).toBe(400);
    expect(geo.height).toBe(100);
    expect(geo.points[0]?.x).toBeCloseTo(20, 5);
    expect(geo.points[1]?.x).toBeCloseTo(380, 5);
    // y values land within the usable vertical band.
    for (const p of geo.points) {
      expect(p.y).toBeGreaterThanOrEqual(10);
      expect(p.y).toBeLessThanOrEqual(90);
    }
  });
});

describe('renderHourlyChart (DOM)', () => {
  it('returns an <svg> with viewBox matching geometry', () => {
    const samples: HourlySample[] = [
      { time: '2026-06-07T14:00', tempC: 19 },
      { time: '2026-06-07T17:00', tempC: 21 },
      { time: '2026-06-07T20:00', tempC: 18 },
    ];
    const svg = renderHourlyChart(projectHourlyChart(samples), {
      ariaLabel: 'Hourly temperature for Lahti',
    });
    expect(svg.tagName.toLowerCase()).toBe('svg');
    expect(svg.getAttribute('viewBox')).toMatch(/^0 0 \d+ \d+$/);
    expect(svg.getAttribute('aria-label')).toBe('Hourly temperature for Lahti');
    expect(svg.querySelector('.detail-chart-line')).not.toBeNull();
    expect(svg.querySelector('.detail-chart-area')).not.toBeNull();
    expect(svg.querySelectorAll('.detail-chart-label-temp').length).toBe(3);
    expect(svg.querySelectorAll('.detail-chart-label-time').length).toBe(3);
  });

  it('renders an empty (aria-hidden) svg when the geometry has no valid points', () => {
    const svg = renderHourlyChart(projectHourlyChart([]));
    expect(svg.tagName.toLowerCase()).toBe('svg');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.querySelector('path')).toBeNull();
  });
});

describe('renderPrecipRow (DOM)', () => {
  it('renders one cell per point and surfaces mm + % only where present', () => {
    const samples: HourlySample[] = [
      { time: 't1', tempC: 15, precipMm: 0, precipProb: 0 },
      { time: 't2', tempC: 17, precipMm: 0.3, precipProb: 60 },
      { time: 't3', tempC: 14, precipMm: 0, precipProb: 25 },
      { time: 't4', tempC: 16, precipMm: 1.2, precipProb: 0 },
    ];
    const row = renderPrecipRow(projectHourlyChart(samples));
    const cells = row.querySelectorAll('.detail-precip-cell');
    expect(cells.length).toBe(4);
    expect(cells[0]?.classList.contains('detail-precip-cell--empty')).toBe(true);

    const cell2Mm = cells[1]?.querySelector('.detail-precip-mm');
    expect(cell2Mm?.textContent).toBe('0.3 mm');
    expect(cells[1]?.querySelector('.detail-precip-prob')?.textContent).toBe('60%');

    expect(cells[2]?.querySelector('.detail-precip-mm')).toBeNull();
    expect(cells[2]?.querySelector('.detail-precip-prob')?.textContent).toBe('25%');

    expect(cells[3]?.querySelector('.detail-precip-mm')?.textContent).toBe('1.2 mm');
    expect(cells[3]?.querySelector('.detail-precip-prob')).toBeNull();
  });
});
